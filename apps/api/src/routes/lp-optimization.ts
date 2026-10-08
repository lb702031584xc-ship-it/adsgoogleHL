/**
 * LP optimization queue routes (automation pack, additive).
 *
 * Contract:
 * - GET    /api/v1/lp-optimization-queue?status= → { items, total }
 * - PATCH  /api/v1/lp-optimization-queue/:id { status: "IN_PROGRESS"|"DONE" }
 * - DELETE /api/v1/lp-optimization-queue/:id → { ok: true } (hard delete)
 *
 * Session auth via requireTenant (tenant isolation). No changes to any
 * existing route file; wire up from routes/index.ts with
 * `registerLpOptimizationRoutes(app, services, auth)`.
 */
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@adlinklab/shared";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import type { AppServices } from "./index.js";
import {
  archiveTask,
  listTasks,
  toPublicTaskItem,
  updateTaskStatus,
  type OptimizationTaskStatus,
} from "../services/lp-optimization-service.js";

const FILTER_STATUSES: ReadonlyArray<OptimizationTaskStatus> = [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
];
const PATCH_STATUSES: ReadonlyArray<OptimizationTaskStatus> = [
  "IN_PROGRESS",
  "DONE",
];

function parseFilterStatus(raw: string | undefined): OptimizationTaskStatus | undefined {
  if (raw === undefined || raw === "") return undefined;
  if ((FILTER_STATUSES as ReadonlyArray<string>).includes(raw)) {
    return raw as OptimizationTaskStatus;
  }
  throw new ValidationError(
    `status must be one of ${FILTER_STATUSES.join("|")}`
  );
}

function parsePatchStatus(raw: unknown): OptimizationTaskStatus {
  if (
    typeof raw === "string" &&
    (PATCH_STATUSES as ReadonlyArray<string>).includes(raw)
  ) {
    return raw as OptimizationTaskStatus;
  }
  throw new ValidationError(
    `status must be one of ${PATCH_STATUSES.join("|")}`
  );
}

export async function registerLpOptimizationRoutes(
  app: FastifyInstance,
  services: AppServices,
  auth: AuthContext
): Promise<void> {
  // Memory-persistence / unit-test mode has no DB-backed queue.
  const prisma = services.prisma;
  if (!prisma) return;

  app.get<{
    Querystring: { status?: string };
  }>("/api/v1/lp-optimization-queue", async (request) => {
    const tenantId = requireTenant(auth, request);
    const status = parseFilterStatus(request.query.status);
    return listTasks(prisma, tenantId, status);
  });

  app.patch<{
    Params: { id: string };
    Body: { status?: unknown };
  }>("/api/v1/lp-optimization-queue/:id", async (request) => {
    const tenantId = requireTenant(auth, request);
    const body = (request.body ?? {}) as { status?: unknown };
    const status = parsePatchStatus(body.status);
    const updated = await updateTaskStatus(
      prisma,
      tenantId,
      request.params.id,
      status
    );
    // Attach the landing page ref for a self-contained response.
    const pages = await prisma.landingPage.findMany({
      where: { id: updated.landingPageId, tenantId },
    });
    return toPublicTaskItem(updated, pages[0] ?? null);
  });

  app.delete<{
    Params: { id: string };
  }>("/api/v1/lp-optimization-queue/:id", async (request) => {
    const tenantId = requireTenant(auth, request);
    return archiveTask(prisma, tenantId, request.params.id);
  });
}
