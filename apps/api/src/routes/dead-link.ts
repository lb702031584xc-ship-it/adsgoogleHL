/**
 * Automation pack ① — dead link monitor API routes.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 * Wiring note for the parent orchestrator: register in routes/index.ts with
 *   await registerDeadLinkRoutes(app, services, auth);
 * (do NOT edit index.ts from this task).
 *
 * - GET  /api/v1/link-health           ?trackingLinkId ?page ?pageSize
 * - POST /api/v1/link-health/check-now (runs the scan synchronously,
 *                                       returns the summary)
 *
 * Session/API-key auth via requireTenant (tenant-isolated).
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  checkAllActiveLinks,
  getHealthHistory,
} from "../services/dead-link-service.js";

export interface DeadLinkRouteServices {
  prisma: PrismaClient;
}

export async function registerDeadLinkRoutes(
  app: FastifyInstance,
  services: DeadLinkRouteServices,
  auth: AuthContext
): Promise<void> {
  const { prisma } = services;

  app.get<{
    Querystring: { trackingLinkId?: string; page?: string; pageSize?: string };
  }>("/api/v1/link-health", async (request) => {
    const tenantId = requireTenant(auth, request);
    return getHealthHistory(prisma, tenantId, {
      trackingLinkId: request.query.trackingLinkId || undefined,
      page: request.query.page ? Number(request.query.page) : undefined,
      pageSize: request.query.pageSize
        ? Number(request.query.pageSize)
        : undefined,
    });
  });

  app.post("/api/v1/link-health/check-now", async (request) => {
    const tenantId = requireTenant(auth, request);
    // Synchronous scan: the tenant's ACTIVE link set is small and the
    // caller gets the summary immediately. No queue involvement.
    const summary = await checkAllActiveLinks(prisma, tenantId);
    return { ok: true, tenantId, ...summary };
  });
}
