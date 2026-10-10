/**
 * 教练模式 API（第十三批）。
 *
 * - GET  /api/v1/coach/settings → { enabled, dailyBudgetLimit }
 * - POST /api/v1/coach/settings { enabled?, dailyBudgetLimit? } → 更新
 * - POST /api/v1/coach/check { keywords?, brandTerms?, content?, url?, dailyBudget? }
 *   → { enabled, findings }（findings 为空 = 全通过；budgetLimit 取自设置）
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
import { runCoachChecks, type CoachCheckInput } from "../coach/checks.js";

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

async function getSettings(prisma: PrismaClient, tenantId: string) {
  const row = (await prisma.coachSetting.findUnique({
    where: { tenantId },
  })) as { enabled: boolean; dailyBudgetLimit: number | null } | null;
  return {
    enabled: row?.enabled ?? true,
    dailyBudgetLimit: row?.dailyBudgetLimit ?? null,
  };
}

export function registerCoachRoutes(app: FastifyInstance, deps: Deps): void {
  const { prisma } = deps;

  app.get("/api/v1/coach/settings", async (request) => {
    const info = await requireSession(deps, request);
    return getSettings(prisma, info.tenantId);
  });

  app.post<{
    Body: { enabled?: boolean; dailyBudgetLimit?: number | null };
  }>("/api/v1/coach/settings", async (request) => {
    const info = await requireSession(deps, request);
    const { enabled, dailyBudgetLimit } = request.body ?? {};
    const data: { enabled?: boolean; dailyBudgetLimit?: number | null } = {};
    if (enabled !== undefined) {
      if (typeof enabled !== "boolean") {
        throw new ValidationError("enabled must be a boolean");
      }
      data.enabled = enabled;
    }
    if (dailyBudgetLimit !== undefined) {
      if (
        dailyBudgetLimit !== null &&
        (typeof dailyBudgetLimit !== "number" ||
          !Number.isFinite(dailyBudgetLimit) ||
          dailyBudgetLimit <= 0)
      ) {
        throw new ValidationError("dailyBudgetLimit must be a positive number or null");
      }
      data.dailyBudgetLimit = dailyBudgetLimit;
    }
    const saved = (await prisma.coachSetting.upsert({
      where: { tenantId: info.tenantId },
      update: data,
      create: {
        tenantId: info.tenantId,
        enabled: data.enabled ?? true,
        dailyBudgetLimit: data.dailyBudgetLimit ?? null,
      },
    })) as { enabled: boolean; dailyBudgetLimit: number | null };
    return { enabled: saved.enabled, dailyBudgetLimit: saved.dailyBudgetLimit };
  });

  app.post<{
    Body: CoachCheckInput;
  }>("/api/v1/coach/check", async (request) => {
    const info = await requireSession(deps, request);
    const settings = await getSettings(prisma, info.tenantId);
    const body = request.body ?? {};
    const findings = settings.enabled
      ? runCoachChecks({ ...body, budgetLimit: settings.dailyBudgetLimit })
      : [];
    return { enabled: settings.enabled, findings };
  });
}
