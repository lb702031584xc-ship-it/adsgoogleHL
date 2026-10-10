/**
 * 选品流水线 API（第五批）。
 *
 * - POST /api/v1/amazon/pipeline/run
 *   body: { items: PipelineItemInput[]（1-10 个）, options?: PipelineOptions, name? }
 *   同步评估 5 道门（并发度 3），按 worthIndex 降序返回；落库 product_pipeline_runs。
 *   同一 tenant 10 次/分钟限流（Redis；不可用时 fail-open）。
 *   单品/单门异常 → unknown 降级，绝不 500。
 * - GET /api/v1/amazon/pipeline/runs?page=&pageSize= — 历史运行列表（tenant 隔离）
 * - GET /api/v1/amazon/pipeline/runs/:id — 单次运行详情
 */
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { evaluatePipeline } from "../pipeline/evaluate.js";
import type {
  PipelineItemInput,
  PipelineOptions,
} from "../pipeline/types.js";

interface Deps {
  prisma: PrismaClient;
  redis?: RateLimitRedis;
  chatJsonImpl?: (args: unknown) => Promise<unknown>;
  scrapeImpl?: (url: string) => Promise<never>;
}

export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

async function requireSession(
  deps: Deps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

let sharedRedis: Redis | null = null;
let sharedRedisBroken = false;

function getSharedRedis(): Redis | null {
  if (sharedRedisBroken) return null;
  if (sharedRedis) return sharedRedis;
  try {
    const client = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      }
    );
    client.on("error", () => undefined);
    sharedRedis = client;
    return client;
  } catch {
    sharedRedisBroken = true;
    return null;
  }
}

function minuteStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

async function checkRateLimit(
  redis: RateLimitRedis | undefined,
  tenantId: string
): Promise<boolean> {
  const client = redis ?? getSharedRedis();
  if (!client) return true;
  try {
    const key = `amazon-pipeline:ratelimit:${tenantId}:${minuteStamp()}`;
    const count = await client.incr(key);
    if (count === 1) {
      try {
        await client.expire(key, 120);
      } catch {
        // 忽略
      }
    }
    return count <= 10;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 入参校验                                                             */
/* ------------------------------------------------------------------ */

const MAX_ITEMS = 10;

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function validateItem(raw: unknown, i: number): PipelineItemInput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const title = asNonEmptyString(o.title);
  if (!title) throw new ValidationError(`items[${i}].title 必填`);
  const item: PipelineItemInput = { title: title.slice(0, 300) };
  const asin = asNonEmptyString(o.asin);
  if (asin) item.asin = asin.slice(0, 32);
  const brand = asNonEmptyString(o.brand);
  if (brand) item.brand = brand.slice(0, 128);
  const url = asNonEmptyString(o.detailPageUrl);
  if (url) {
    if (!/^https?:\/\//i.test(url)) {
      throw new ValidationError(`items[${i}].detailPageUrl 必须是 http(s) URL`);
    }
    item.detailPageUrl = url.slice(0, 500);
  }
  const price = asFiniteNumber(o.price);
  if (price !== null && price > 0) item.price = price;
  const rating = asFiniteNumber(o.rating);
  if (rating !== null && rating >= 0 && rating <= 5) item.rating = rating;
  const reviewCount = asFiniteNumber(o.reviewCount);
  if (reviewCount !== null && reviewCount >= 0) item.reviewCount = Math.round(reviewCount);
  const mv = o.manualMonthlyVisits;
  if (mv !== undefined && mv !== null && mv !== "") {
    const n = Number(mv);
    if (!Number.isInteger(n) || n <= 0 || n > 1e12) {
      throw new ValidationError(`items[${i}].manualMonthlyVisits 必须是 1~1e12 的正整数`);
    }
    item.manualMonthlyVisits = n;
  }
  // 第八批：机会品标记（discovery 机会品模式透传）
  if (o.opportunity === true) item.opportunity = true;
  return item;
}

function validateOptions(raw: unknown): PipelineOptions {
  const o = ((raw ?? {}) as Record<string, unknown>) ?? {};
  const out: PipelineOptions = {};
  const num = (k: string): number | null => {
    const v = o[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const r = num("minRating");
  if (r !== null) {
    if (r < 0 || r > 5) throw new ValidationError("minRating 必须在 0-5 之间");
    out.minRating = r;
  }
  const rc = num("minReviews");
  if (rc !== null) {
    if (rc < 0) throw new ValidationError("minReviews 必须 ≥ 0");
    out.minReviews = Math.round(rc);
  }
  const ms = num("minMetricsScore");
  if (ms !== null) {
    if (ms < 0 || ms > 100) throw new ValidationError("minMetricsScore 必须在 0-100 之间");
    out.minMetricsScore = ms;
  }
  const cpc = num("estimatedCpc");
  if (cpc !== null) {
    if (cpc <= 0) throw new ValidationError("estimatedCpc 必须 > 0");
    out.estimatedCpc = cpc;
  }
  const cm = num("commission");
  if (cm !== null) {
    if (cm <= 0) throw new ValidationError("commission 必须 > 0");
    out.commission = cm;
  }
  const be = num("maxBreakEvenCvrPct");
  if (be !== null) {
    if (be <= 0 || be > 100) throw new ValidationError("maxBreakEvenCvrPct 必须在 0-100 之间");
    out.maxBreakEvenCvrPct = be;
  }
  if (typeof o.riskCheck === "boolean") out.riskCheck = o.riskCheck;
  // 批次5追加：否定清单内置规则开关
  if (typeof o.denyLowRating === "boolean") out.denyLowRating = o.denyLowRating;
  if (typeof o.denyBrandWord === "boolean") out.denyBrandWord = o.denyBrandWord;
  if (typeof o.denyPolicyCategory === "boolean")
    out.denyPolicyCategory = o.denyPolicyCategory;
  if (typeof o.country === "string" && o.country.trim()) {
    out.country = o.country.trim().toUpperCase().slice(0, 8);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 路由注册                                                             */
/* ------------------------------------------------------------------ */

export async function registerAmazonPipelineRoutes(
  app: FastifyInstance,
  deps: Deps
): Promise<void> {
  const { prisma } = deps;

  app.post<{
    Body: { items?: unknown; options?: unknown; name?: unknown };
  }>("/api/v1/amazon/pipeline/run", async (request) => {
    const info = await requireSession(deps, request);

    const allowed = await checkRateLimit(deps.redis, info.tenantId);
    if (!allowed) {
      throw new AppError("流水线评估频率超限（10 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }

    const rawItems = request.body?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new ValidationError("items 不能为空（1-10 个产品）");
    }
    if (rawItems.length > MAX_ITEMS) {
      throw new ValidationError(`单次最多 ${MAX_ITEMS} 个产品`);
    }
    const items = rawItems.map((x, i) => validateItem(x, i));
    const options = validateOptions(request.body?.options);
    const name = asNonEmptyString(request.body?.name)?.slice(0, 128) ?? null;

    const result = await evaluatePipeline(
      items,
      options,
      {
        prisma,
        redis: deps.redis,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chatJsonImpl: deps.chatJsonImpl as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        scrapeImpl: deps.scrapeImpl as any,
      },
      info.tenantId
    );

    const row = await prisma.productPipelineRun.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        name,
        itemCount: items.length,
        options: options as unknown as object,
        results: result as unknown as object,
      },
      select: { id: true, createdAt: true },
    });

    return { runId: row.id, createdAt: row.createdAt.toISOString(), ...result };
  });

  app.get<{
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/amazon/pipeline/runs", async (request) => {
    const info = await requireSession(deps, request);
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize) || 20));
    const [rows, total] = await Promise.all([
      prisma.productPipelineRun.findMany({
        where: { tenantId: info.tenantId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, name: true, itemCount: true, createdAt: true },
      }),
      prisma.productPipelineRun.count({ where: { tenantId: info.tenantId } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        itemCount: r.itemCount,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  });

  app.get<{
    Params: { id: string };
  }>("/api/v1/amazon/pipeline/runs/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = await prisma.productPipelineRun.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
    });
    if (!row) throw new NotFoundError("ProductPipelineRun", request.params.id);
    return {
      id: row.id,
      name: row.name,
      itemCount: row.itemCount,
      options: row.options,
      results: row.results,
      createdAt: row.createdAt.toISOString(),
    };
  });

  /* ---------------- 否定清单 CRUD（批次5追加） ---------------- */

  /** GET /api/v1/amazon/pipeline/denylist — 列出别碰清单 */
  app.get("/api/v1/amazon/pipeline/denylist", async (request) => {
    const info = await requireSession(deps, request);
    const rows = await prisma.denylistEntry.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, value: true, reason: true, createdAt: true },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        value: r.value,
        reason: r.reason,
        createdAt: (r.createdAt as Date).toISOString(),
      })),
    };
  });

  /** POST /api/v1/amazon/pipeline/denylist — 新增一条 */
  app.post<{
    Body: { type?: unknown; value?: unknown; reason?: unknown };
  }>("/api/v1/amazon/pipeline/denylist", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
    if (!["asin", "keyword", "brand", "category"].includes(type)) {
      throw new ValidationError("type 必须是 asin|keyword|brand|category");
    }
    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) throw new ValidationError("value 不能为空");
    if (value.length > 256) throw new ValidationError("value 最长 256 字符");
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 512)
        : null;
    const row = await prisma.denylistEntry.upsert({
      where: {
        tenantId_type_value: { tenantId: info.tenantId, type, value: value.slice(0, 256) },
      },
      update: { reason },
      create: {
        id: randomUUID(),
        tenantId: info.tenantId,
        type,
        value: value.slice(0, 256),
        reason,
      },
      select: { id: true, type: true, value: true, reason: true },
    });
    return { item: row };
  });

  /** DELETE /api/v1/amazon/pipeline/denylist/:id — 删除一条 */
  app.delete<{
    Params: { id: string };
  }>("/api/v1/amazon/pipeline/denylist/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = await prisma.denylistEntry.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
      select: { id: true },
    });
    if (!row) throw new NotFoundError("DenylistEntry", request.params.id);
    await prisma.denylistEntry.delete({ where: { id: row.id } });
    return { deleted: true };
  });
}
