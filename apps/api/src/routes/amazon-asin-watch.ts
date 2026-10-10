/**
 * ASIN 跟踪 API（第十批）。
 *
 * - GET    /api/v1/amazon/asin-watches — 跟踪列表（含最新快照 + 7 天增长）
 * - POST   /api/v1/amazon/asin-watches — { asin, title? } 新增跟踪
 * - DELETE /api/v1/amazon/asin-watches/:id — 取消跟踪
 * - GET    /api/v1/amazon/asin-watches/:asin/snapshots — 快照历史
 * - GET    /api/v1/amazon/asin-watches/settings — 异动阈值
 * - PUT    /api/v1/amazon/asin-watches/settings — { growthPct?, growthAbs? }
 * - POST   /api/v1/amazon/asin-watches/check — 手动触发一次快照检查
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  detectSurge,
  DEFAULT_SURGE_THRESHOLDS,
  type SurgeThresholds,
} from "../asin-watch/surge.js";
import { processAsinWatchJob } from "../queue/asin-watch-worker.js";

interface Deps {
  prisma: PrismaClient;
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

function normalizeAsin(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";
  if (!/^[A-Z0-9]{8,16}$/.test(s)) {
    throw new ValidationError("asin 格式非法");
  }
  return s;
}

async function getThresholds(prisma: PrismaClient): Promise<SurgeThresholds> {
  try {
    const rows = (await prisma.aiSetting.findMany({
      where: { key: { in: ["asinWatch.growthPct", "asinWatch.growthAbs"] } },
      select: { key: true, value: true },
    })) as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const pct = Number(map.get("asinWatch.growthPct"));
    const abs = Number(map.get("asinWatch.growthAbs"));
    return {
      growthPct: Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_SURGE_THRESHOLDS.growthPct,
      growthAbs: Number.isFinite(abs) && abs > 0 ? abs : DEFAULT_SURGE_THRESHOLDS.growthAbs,
    };
  } catch {
    return { ...DEFAULT_SURGE_THRESHOLDS };
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export function registerAsinWatchRoutes(
  app: FastifyInstance,
  deps: Deps
): void {
  const { prisma } = deps;

  /** GET 列表（含最新快照 + 7 天增长） */
  app.get("/api/v1/amazon/asin-watches", async (request) => {
    const info = await requireSession(deps, request);
    const watches = (await prisma.asinWatch.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true, asin: true, title: true, createdAt: true },
    })) as Array<{ id: string; asin: string; title: string | null; createdAt: Date }>;
    const thresholds = await getThresholds(prisma);
    const out = [];
    for (const w of watches) {
      const snaps = (await prisma.asinSnapshot.findMany({
        where: { tenantId: info.tenantId, asin: w.asin },
        orderBy: { capturedAt: "desc" },
        take: 30,
        select: { reviewCount: true, rating: true, price: true, capturedAt: true },
      })) as Array<{
        reviewCount: number | null;
        rating: number | null;
        price: number | null;
        capturedAt: Date;
      }>;
      const latest = snaps[0] ?? null;
      // 基线：7 天前或最早
      const cutoff = Date.now() - SEVEN_DAYS_MS;
      const baseline =
        snaps.find((s) => new Date(s.capturedAt).getTime() <= cutoff) ??
        snaps[snaps.length - 1] ??
        null;
      const surge =
        latest && baseline && baseline !== latest
          ? detectSurge(baseline.reviewCount, latest.reviewCount, thresholds)
          : null;
      out.push({
        id: w.id,
        asin: w.asin,
        title: w.title,
        createdAt: w.createdAt.toISOString(),
        latest: latest
          ? {
              reviewCount: latest.reviewCount,
              rating: latest.rating,
              price: latest.price,
              capturedAt: new Date(latest.capturedAt).toISOString(),
            }
          : null,
        growthPct: surge?.growthPct ?? null,
        growthAbs: surge?.growthAbs ?? null,
        surged: surge?.surged ?? false,
        surgeReason: surge?.reason ?? null,
        snapshotCount: snaps.length,
      });
    }
    return { items: out, thresholds };
  });

  /** POST 新增跟踪 */
  app.post<{
    Body: { asin?: unknown; title?: unknown };
  }>("/api/v1/amazon/asin-watches", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const asin = normalizeAsin(body.asin);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 500)
        : null;
    const row = (await prisma.asinWatch.upsert({
      where: { tenantId_asin: { tenantId: info.tenantId, asin } },
      update: { title },
      create: { id: randomUUID(), tenantId: info.tenantId, asin, title },
      select: { id: true, asin: true, title: true },
    })) as { id: string; asin: string; title: string | null };
    return { item: row };
  });

  /** DELETE 取消跟踪 */
  app.delete<{
    Params: { id: string };
  }>("/api/v1/amazon/asin-watches/:id", async (request) => {
    const info = await requireSession(deps, request);
    const row = (await prisma.asinWatch.findFirst({
      where: { id: request.params.id, tenantId: info.tenantId },
      select: { id: true },
    })) as { id: string } | null;
    if (!row) throw new NotFoundError("AsinWatch", request.params.id);
    await prisma.asinWatch.delete({ where: { id: row.id } });
    return { deleted: true };
  });

  /** GET 快照历史 */
  app.get<{
    Params: { asin: string };
  }>("/api/v1/amazon/asin-watches/:asin/snapshots", async (request) => {
    const info = await requireSession(deps, request);
    const asin = normalizeAsin(request.params.asin);
    const snaps = (await prisma.asinSnapshot.findMany({
      where: { tenantId: info.tenantId, asin },
      orderBy: { capturedAt: "asc" },
      take: 90,
      select: { reviewCount: true, rating: true, price: true, capturedAt: true },
    })) as Array<{
      reviewCount: number | null;
      rating: number | null;
      price: number | null;
      capturedAt: Date;
    }>;
    return {
      asin,
      snapshots: snaps.map((s) => ({
        reviewCount: s.reviewCount,
        rating: s.rating,
        price: s.price,
        capturedAt: new Date(s.capturedAt).toISOString(),
      })),
    };
  });

  /** GET 阈值 */
  app.get("/api/v1/amazon/asin-watches/settings", async (request) => {
    await requireSession(deps, request);
    return { thresholds: await getThresholds(prisma) };
  });

  /** PUT 阈值 */
  app.put<{
    Body: { growthPct?: unknown; growthAbs?: unknown };
  }>("/api/v1/amazon/asin-watches/settings", async (request) => {
    await requireSession(deps, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const pct = Number(body.growthPct);
    const abs = Number(body.growthAbs);
    if (body.growthPct !== undefined) {
      if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) {
        throw new ValidationError("growthPct 必须是 >0 的数字");
      }
      await prisma.aiSetting.upsert({
        where: { key: "asinWatch.growthPct" },
        update: { value: String(pct) },
        create: { key: "asinWatch.growthPct", value: String(pct) },
      });
    }
    if (body.growthAbs !== undefined) {
      if (!Number.isFinite(abs) || abs <= 0 || abs > 1000000) {
        throw new ValidationError("growthAbs 必须是 >0 的数字");
      }
      await prisma.aiSetting.upsert({
        where: { key: "asinWatch.growthAbs" },
        update: { value: String(abs) },
        create: { key: "asinWatch.growthAbs", value: String(abs) },
      });
    }
    return { thresholds: await getThresholds(prisma) };
  });

  /** POST 手动触发一次检查（本 tenant） */
  app.post("/api/v1/amazon/asin-watches/check", async (request) => {
    const info = await requireSession(deps, request);
    const result = await processAsinWatchJob({
      prisma,
      triggeredBy: "manual",
      tenantId: info.tenantId,
    });
    return result;
  });
}
