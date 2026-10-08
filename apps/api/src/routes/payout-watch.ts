/**
 * Automation pack ③ — payout (commission) change monitoring routes.
 *
 * - GET  /api/v1/payout-watch                     list watches (+ offer name,
 *                                                current payout, history count)
 * - POST /api/v1/payout-watch/:offerId/enable     enable/create watch for an offer
 * - POST /api/v1/payout-watch/:offerId/disable    disable watch
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 * Session auth via requireTenant (tenant isolation); NOT wired into
 * routes/index.ts by this file — coordinator owns registration.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import {
  disableWatch,
  enableWatch,
  listWatches,
} from "../services/payout-watch-service.js";

export interface PayoutWatchRouteDeps {
  prisma: PrismaClient;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertOfferId(request: FastifyRequest): string {
  const raw = (request.params as { offerId?: unknown }).offerId;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    throw new ValidationError("offerId must be a valid UUID");
  }
  return raw;
}

export async function registerPayoutWatchRoutes(
  app: FastifyInstance,
  services: PayoutWatchRouteDeps,
  auth: AuthContext
): Promise<void> {
  const { prisma } = services;
  const tenantOf = (request: FastifyRequest) => requireTenant(auth, request);

  app.get("/api/v1/payout-watch", async (request) => {
    const tenantId = tenantOf(request);
    const items = await listWatches(prisma, tenantId);
    return { items };
  });

  app.post("/api/v1/payout-watch/:offerId/enable", async (request) => {
    const tenantId = tenantOf(request);
    const offerId = assertOfferId(request);
    const watch = await enableWatch(prisma, tenantId, offerId);
    return { ok: true, watch };
  });

  app.post("/api/v1/payout-watch/:offerId/disable", async (request) => {
    const tenantId = tenantOf(request);
    const offerId = assertOfferId(request);
    const watch = await disableWatch(prisma, tenantId, offerId);
    return { ok: true, watch };
  });
}
