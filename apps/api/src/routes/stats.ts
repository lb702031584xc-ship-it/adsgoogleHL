import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { getOfferPerformance } from "../stats/offer-performance.js";

/**
 * P1 — profitability v2 read APIs (one tenant per user; session auth only).
 * Requires Prisma persistence; registered only when services.prisma exists.
 */

export interface StatsRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: StatsRouteDeps,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registerStatsRoutes(
  app: FastifyInstance,
  deps: StatsRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * Per-offer performance over a trailing window: clicks, conversions, CVR,
   * revenue (+dominant currency), EPC, and order refund stats.
   */
  app.get("/api/v1/stats/offer-performance", async (request) => {
    const info = await requireSession(deps, request);
    const query = (request.query ?? {}) as {
      offerId?: unknown;
      days?: unknown;
    };

    const offerId =
      typeof query.offerId === "string" ? query.offerId.trim() : "";
    if (!UUID_RE.test(offerId)) {
      throw new ValidationError("offerId must be a valid UUID");
    }
    let days = 30;
    if (query.days !== undefined) {
      const n =
        typeof query.days === "string" ? Number(query.days) : query.days;
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 365) {
        throw new ValidationError("days must be an integer between 1 and 365");
      }
      days = n as number;
    }

    const offer = await prisma.offer.findFirst({
      where: { id: offerId, tenantId: info.tenantId },
      select: { id: true },
    });
    if (!offer) {
      throw new NotFoundError("Offer", offerId);
    }

    return getOfferPerformance(prisma, info.tenantId, offerId, days);
  });
}
