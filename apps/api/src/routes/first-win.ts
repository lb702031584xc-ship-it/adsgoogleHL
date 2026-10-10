/**
 * 首单仪表盘 API（第十五批）。
 *
 * - GET  /api/v1/first-win → { clicks, manualSpend, estimatedConversions,
 *     clicksToFirstOrder, progressPct }
 *   点击数来自 Click 表（排除测试点击）；花费无现有来源，走手动录入；
 *   预估转化 = 点击 × 2%（明确标注估算）；距首单进度 = 点击数 / 50（2% 转化率下首单期望点击数）。
 * - POST /api/v1/first-win/spend { total } → 保存手动累计花费。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

interface Deps {
  prisma: PrismaClient;
}

/** 预估转化率（标注为估算）。 */
const ESTIMATED_CVR = 0.02;
/** 按 2% 转化率，首单期望点击数。 */
const CLICKS_PER_FIRST_ORDER = Math.round(1 / ESTIMATED_CVR);

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

async function getFirstWin(prisma: PrismaClient, tenantId: string) {
  const [clicks, spendRow] = await Promise.all([
    (prisma.click.count({
      where: { tenantId, isTest: { not: true } },
    }) as Promise<number>).catch(() => 0),
    (prisma.manualSpend.findUnique({
      where: { tenantId },
      select: { total: true },
    }) as Promise<{ total: number } | null>).catch(() => null),
  ]);
  const manualSpend = spendRow?.total ?? 0;
  const estimatedConversions = Math.round(clicks * ESTIMATED_CVR * 100) / 100;
  const clicksToFirstOrder = Math.max(0, CLICKS_PER_FIRST_ORDER - clicks);
  const progressPct = Math.min(100, Math.round((clicks / CLICKS_PER_FIRST_ORDER) * 100));
  return {
    clicks,
    manualSpend,
    estimatedConversions,
    estimatedCvrPct: ESTIMATED_CVR * 100,
    clicksToFirstOrder,
    progressPct,
    firstOrderDone: clicks >= CLICKS_PER_FIRST_ORDER,
  };
}

export function registerFirstWinRoutes(
  app: FastifyInstance,
  deps: Deps
): void {
  const { prisma } = deps;

  app.get("/api/v1/first-win", async (request) => {
    const info = await requireSession(deps, request);
    return getFirstWin(prisma, info.tenantId);
  });

  app.post<{
    Body: { total?: number };
  }>("/api/v1/first-win/spend", async (request) => {
    const info = await requireSession(deps, request);
    const total = request.body?.total;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
      throw new ValidationError("total 必须是非负数");
    }
    if (total > 1e9) {
      throw new ValidationError("total 过大");
    }
    await prisma.manualSpend.upsert({
      where: { tenantId: info.tenantId },
      update: { total },
      create: { tenantId: info.tenantId, total },
    });
    return getFirstWin(prisma, info.tenantId);
  });
}
