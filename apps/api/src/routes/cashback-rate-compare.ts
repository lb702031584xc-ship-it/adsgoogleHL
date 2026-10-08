/**
 * Feature 5 — 返利比价（rate-compare）API.
 *
 * - GET  /api/v1/cashback/rate-compare/groups                 list groups
 * - POST /api/v1/cashback/rate-compare/groups                 create group
 *          body: { name, merchantDomain, portals: [{ name, url }] }
 * - POST /api/v1/cashback/rate-compare/groups/:id/compare-now trigger one comparison now
 * - GET  /api/v1/cashback/rate-compare/groups/:id/snapshots    latest per portal + history
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 * Session auth only (one tenant per user), tenant isolation enforced on
 * every handler. NOT wired into routes/index.ts by this file — the
 * coordinator owns registration (registerCashbackRateCompareRoutes is
 * exported for it).
 */
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
import {
  createGroup,
  getGroup,
  getGroupSnapshots,
  listGroups,
  runGroupCheck,
  validateGroupInput,
} from "../services/cashback-rate-compare-service.js";

export interface CashbackRateCompareRouteDeps {
  prisma: PrismaClient;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireSession(
  deps: CashbackRateCompareRouteDeps,
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

function assertGroupId(request: FastifyRequest): string {
  const raw = (request.params as { id?: unknown }).id;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    throw new ValidationError("group id must be a valid UUID");
  }
  return raw;
}

export async function registerCashbackRateCompareRoutes(
  app: FastifyInstance,
  deps: CashbackRateCompareRouteDeps
): Promise<void> {
  const { prisma } = deps;

  app.get("/api/v1/cashback/rate-compare/groups", async (request) => {
    const info = await requireSession(deps, request);
    const items = await listGroups(prisma, info.tenantId);
    return { items };
  });

  app.post("/api/v1/cashback/rate-compare/groups", async (request) => {
    const info = await requireSession(deps, request);
    const input = validateGroupInput(
      (request.body ?? {}) as Record<string, unknown>
    );
    const group = await createGroup(prisma, info.tenantId, input);
    return { ok: true, group };
  });

  app.post(
    "/api/v1/cashback/rate-compare/groups/:id/compare-now",
    async (request) => {
      const info = await requireSession(deps, request);
      const groupId = assertGroupId(request);
      const group = await getGroup(prisma, info.tenantId, groupId).catch(
        () => {
          throw new NotFoundError("Compare group not found");
        }
      );
      const result = await runGroupCheck(prisma, info.tenantId, group);
      return { ok: true, result };
    }
  );

  app.get(
    "/api/v1/cashback/rate-compare/groups/:id/snapshots",
    async (request) => {
      const info = await requireSession(deps, request);
      const groupId = assertGroupId(request);
      const group = await getGroup(prisma, info.tenantId, groupId).catch(
        () => {
          throw new NotFoundError("Compare group not found");
        }
      );
      const { latest, snapshots } = await getGroupSnapshots(
        prisma,
        info.tenantId,
        group
      );
      return { group, latest, snapshots };
    }
  );
}
