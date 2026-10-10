/**
 * Keepa 自动筛选（Day5 Keepa 验证的自动化）。
 *
 * - POST /api/v1/keepa/validate
 *   body: { asins: string[]（1–20 个）, domain?: number（Keepa domainId，默认 1=US） }
 *   串行请求 Keepa 官方 API（付费 key，token 珍贵），逐个判 pass/kill/unknown。
 *   同一 tenant 10 次/分钟限流（Redis；不可用时 fail-open）。
 *   失败降级：token 不足/429/无数据 → verdict=unknown，绝不抛 500。
 *   无 key → 400 并提示去"AI 设置 → Keepa API Key"配置。
 */
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { decryptSecret, assertAiSettingsPepperConfigured } from "../ai/crypto.js";
import {
  fetchKeepaProduct,
  keepaDomainId,
} from "../keepa/client.js";
import {
  evaluateKeepa,
  type KeepaEvaluation,
} from "../keepa/rules.js";

const SETTING_KEEPA_API_KEY_ENC = "keepa.apiKeyEnc";

interface Deps {
  prisma: PrismaClient;
  /** 注入式 Redis（测试用）；生产缺省时按需懒建共享连接。 */
  redis?: RateLimitRedis;
  /** Injectable for tests. */
  fetchKeepaImpl?: typeof fetchKeepaProduct;
}

export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
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

const RATE_LIMIT_PER_MINUTE = 10;

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
    const key = `keepa:ratelimit:${tenantId}:${minuteStamp()}`;
    const count = await client.incr(key);
    if (count === 1) {
      try {
        await client.expire(key, 120);
      } catch {
        // 忽略
      }
    }
    return count <= RATE_LIMIT_PER_MINUTE;
  } catch {
    return true; // Redis 不可用时 fail-open
  }
}

async function readKeepaApiKey(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.aiSetting.findUnique({
    where: { key: SETTING_KEEPA_API_KEY_ENC },
    select: { value: true },
  });
  if (!row?.value) return null;
  try {
    const pepper = assertAiSettingsPepperConfigured();
    const key = decryptSecret(row.value, pepper);
    return key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

const ASIN_RE = /^[A-Z0-9]{10}$/i;

export interface KeepaValidateResult {
  asin: string;
  verdict: KeepaEvaluation["verdict"];
  reasons: Array<{ code: string; detail: string }>;
  metrics: KeepaEvaluation["metrics"];
}

export function registerKeepaRoutes(app: FastifyInstance, deps: Deps): void {
  const { prisma } = deps;
  const fetchKeepaImpl = deps.fetchKeepaImpl ?? fetchKeepaProduct;

  /** Keepa API Key 是否已配置（只返回布尔值）。 */
  app.get("/api/v1/keepa/status", async (request) => {
    await requireSession(deps, request);
    const apiKey = await readKeepaApiKey(prisma);
    return { hasKey: !!apiKey };
  });

  app.post<{
    Body: { asins?: unknown; domain?: unknown; country?: unknown };
  }>("/api/v1/keepa/validate", async (request) => {
    const session = await requireSession(deps, request);

    const ok = await checkRateLimit(deps.redis, session.tenantId);
    if (!ok) {
      throw new AppError("Keepa 验证频率超限（10 次/分钟），请稍后再试", {
        statusCode: 429,
      });
    }

    const apiKey = await readKeepaApiKey(prisma);
    if (!apiKey) {
      throw new ValidationError(
        "未配置 Keepa API Key。请前往 管理 → AI 设置 → Keepa API Key 配置（keepa.com 申请付费 key）"
      );
    }

    const rawAsins = (request.body ?? {}).asins;
    if (!Array.isArray(rawAsins) || rawAsins.length === 0 || rawAsins.length > 20) {
      throw new ValidationError("asins 必须为 1–20 个 ASIN 数组");
    }
    const asins: string[] = [];
    for (const a of rawAsins) {
      if (typeof a !== "string" || !ASIN_RE.test(a.trim())) {
        throw new ValidationError(`ASIN 格式非法：${String(a).slice(0, 20)}`);
      }
      const norm = a.trim().toUpperCase();
      if (!asins.includes(norm)) asins.push(norm);
    }

    const body = request.body ?? {};
    let domain = 1;
    if (typeof body.domain === "number" && Number.isInteger(body.domain) && body.domain > 0) {
      domain = body.domain;
    } else if (typeof body.country === "string" && body.country.trim()) {
      domain = keepaDomainId(body.country.trim());
    }

    // 串行请求：Keepa token 按次消耗，避免并发烧 token。
    const results: KeepaValidateResult[] = [];
    for (const asin of asins) {
      const fetched = await fetchKeepaImpl(apiKey, asin, domain);
      if (fetched.error === "invalid_key") {
        throw new ValidationError(
          "Keepa API Key 无效（401/403），请检查 管理 → AI 设置 中的 Keepa API Key"
        );
      }
      const mappedError: "rate_limited" | "tokens_exhausted" | "no_data" | "fetch_failed" | null =
        fetched.error === "rate_limited"
          ? "rate_limited"
          : fetched.error === "tokens_exhausted"
            ? "tokens_exhausted"
            : fetched.error === "no_data"
              ? "no_data"
              : fetched.error === "network"
                ? "fetch_failed"
                : null;
      const ev = evaluateKeepa(
        fetched.product ? fetched.product.csv : null,
        fetched.product ? null : mappedError
      );
      results.push({
        asin,
        verdict: ev.verdict,
        reasons: ev.reasons,
        metrics: ev.metrics,
      });
      // token 见底就停，不再烧后面的请求
      if (fetched.error === "tokens_exhausted") break;
    }

    return { results };
  });
}
