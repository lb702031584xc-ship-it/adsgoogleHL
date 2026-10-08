/**
 * Feature 4 — 跳转链检测（redirect-check）API routes.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 * Wiring note for the parent orchestrator: register in routes/index.ts with
 *   await registerCashbackRedirectCheckRoutes(app, { prisma });
 * (do NOT edit index.ts from this task).
 *
 * - GET  /api/v1/cashback/redirect-checks          ?trackingLinkId ?page ?pageSize
 * - POST /api/v1/cashback/redirect-checks/check-all (runs the scan
 *                                                    synchronously,
 *                                                    returns the summary)
 *
 * Session auth via authenticateSessionRequest (tenant-isolated).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { UnauthorizedError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  checkAllRedirectChains,
  getRedirectCheckHistory,
} from "../services/cashback-redirect-check-service.js";

export interface CashbackRedirectCheckRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: CashbackRedirectCheckRouteDeps,
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

export async function registerCashbackRedirectCheckRoutes(
  app: FastifyInstance,
  deps: CashbackRedirectCheckRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.get<{
    Querystring: { trackingLinkId?: string; page?: string; pageSize?: string };
  }>("/api/v1/cashback/redirect-checks", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    return getRedirectCheckHistory(prisma, tenantId, {
      trackingLinkId: request.query.trackingLinkId || undefined,
      page: request.query.page ? Number(request.query.page) : undefined,
      pageSize: request.query.pageSize
        ? Number(request.query.pageSize)
        : undefined,
    });
  });

  app.post("/api/v1/cashback/redirect-checks/check-all", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    // Synchronous scan: the tenant's ACTIVE link set is small and the
    // caller gets the summary immediately. The daily worker calls the
    // same service for the scheduled run.
    const summary = await checkAllRedirectChains(prisma, tenantId);
    return { ok: true, tenantId, ...summary };
  });
}
