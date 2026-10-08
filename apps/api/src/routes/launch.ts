/**
 * Offer 上线一条龙向导 (launch wizard) checklist API.
 *
 * GET    /api/v1/launch                         — list tenant checklists
 * POST   /api/v1/launch                         — create (body: { offerId? })
 * GET    /api/v1/launch/:id                     — detail (+ related entities)
 * POST   /api/v1/launch/:id/complete-step       — { step, data }
 * POST   /api/v1/launch/:id/tracking-link       — create a TrackingLink for the checklist
 * POST   /api/v1/launch/:id/activate            — set TrackingLink ACTIVE +
 *                                                queue a Google Ads Script push task
 *
 * Tenant isolation: every query is scoped by the session user's tenantId
 * (requireSession, same pattern as link-swap.ts).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  createIdempotencyKey,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

export interface LaunchRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: LaunchRouteDeps,
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

const STATUSES = ["DRAFT", "IN_PROGRESS", "COMPLETED"] as const;
const TOTAL_STEPS = 6;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asUuid(v: unknown, field: string): string | undefined {
  const s = asTrimmedString(v);
  if (!s) return undefined;
  if (!UUID_RE.test(s)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }
  return s;
}

function asStepNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > TOTAL_STEPS) {
    throw new ValidationError(`step must be an integer between 1 and ${TOTAL_STEPS}`);
  }
  return n;
}

async function getChecklist(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<Record<string, unknown>> {
  const checklist = await prisma.launchChecklist.findFirst({
    where: { id, tenantId },
  });
  if (!checklist) {
    throw new NotFoundError("LaunchChecklist", id);
  }
  return checklist as Record<string, unknown>;
}

/** Generate a unique publicId like tl_<8 hex>. */
async function generatePublicId(
  prisma: PrismaClient,
  tenantId: string
): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const publicId = `tl_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const existing = await prisma.trackingLink.findFirst({
      where: { publicId, tenantId },
    });
    if (!existing) return publicId;
  }
  throw new ValidationError("Could not generate a unique tracking link publicId");
}

export async function registerLaunchRoutes(
  app: FastifyInstance,
  deps: LaunchRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * List the current tenant's checklists (newest first).
   */
  app.get("/api/v1/launch", async (request) => {
    const info = await requireSession(deps, request);
    const checklists = await prisma.launchChecklist.findMany({
      where: { tenantId: info.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return { checklists };
  });

  /**
   * Create a checklist. Body: { offerId? } — the offer is verified for
   * tenant ownership when provided.
   */
  app.post<{ Body: { offerId?: unknown } }>(
    "/api/v1/launch",
    async (request) => {
      const info = await requireSession(deps, request);
      const tenantId = info.tenantId;
      const offerId = asUuid((request.body as { offerId?: unknown })?.offerId, "offerId");

      if (offerId) {
        const offer = await prisma.offer.findFirst({
          where: { id: offerId, tenantId, deletedAt: null },
        });
        if (!offer) {
          throw new NotFoundError("Offer", offerId);
        }
      }

      const checklist = await prisma.launchChecklist.create({
        data: {
          id: randomUUID(),
          tenantId,
          offerId: offerId ?? null,
          currentStep: 1,
          status: "DRAFT",
          stepsData: {},
        },
      });
      return { checklist };
    }
  );

  /**
   * Checklist detail, with the linked offer / tracking link / landing page
   * fetched separately (keeps the fake-prisma test harness simple).
   */
  app.get<{ Params: { id: string } }>(
    "/api/v1/launch/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const tenantId = info.tenantId;
      const checklist = await getChecklist(prisma, tenantId, request.params.id);
      const [offer, trackingLink, landingPage] = await Promise.all([
        checklist.offerId
          ? prisma.offer.findFirst({
              where: { id: checklist.offerId as string, tenantId },
            })
          : null,
        checklist.trackingLinkId
          ? prisma.trackingLink.findFirst({
              where: { id: checklist.trackingLinkId as string, tenantId },
            })
          : null,
        checklist.landingPageId
          ? prisma.landingPage.findFirst({
              where: { id: checklist.landingPageId as string, tenantId },
            })
          : null,
      ]);
      return { checklist, offer, trackingLink, landingPage };
    }
  );

  /**
   * Mark a step complete and persist its payload.
   * Body: { step: 1..6, data: object }.
   * Completing step 6 flips status to COMPLETED and sets completedAt.
   */
  app.post<{
    Params: { id: string };
    Body: { step?: unknown; data?: unknown };
  }>("/api/v1/launch/:id/complete-step", async (request) => {
    const info = await requireSession(deps, request);
    const tenantId = info.tenantId;
    const checklist = await getChecklist(prisma, tenantId, request.params.id);

    const step = asStepNumber((request.body ?? {}).step);
    const data = (request.body ?? {}).data;
    if (data === undefined || data === null || typeof data !== "object") {
      throw new ValidationError("data must be an object");
    }

    const prevStepsData = (checklist.stepsData ?? {}) as Record<string, unknown>;
    const stepsData = { ...prevStepsData, [`step${step}`]: data };
    const isFinal = step === TOTAL_STEPS;

    const updated = await prisma.launchChecklist.update({
      where: { id: checklist.id as string },
      data: {
        currentStep: Math.min(step + 1, TOTAL_STEPS),
        status: isFinal
          ? "COMPLETED"
          : STATUSES.includes((checklist.status as string) as (typeof STATUSES)[number]) &&
              checklist.status !== "DRAFT"
            ? (checklist.status as string)
            : "IN_PROGRESS",
        // JSON.parse returns `any`, which Prisma accepts for Json fields
        // and guarantees the payload is JSON-serializable.
        stepsData: JSON.parse(JSON.stringify(stepsData)),
        completedAt: isFinal ? new Date() : (checklist.completedAt as Date | null),
      },
    });
    return { checklist: updated };
  });

  /**
   * Create a TrackingLink bound to this checklist.
   * Body: { publicId?, status? } — offerId comes from the checklist (must exist).
   * Status defaults to DRAFT so nothing goes live until activate.
   */
  app.post<{
    Params: { id: string };
    Body: { publicId?: unknown; status?: unknown };
  }>("/api/v1/launch/:id/tracking-link", async (request) => {
    const info = await requireSession(deps, request);
    const tenantId = info.tenantId;
    const checklist = await getChecklist(prisma, tenantId, request.params.id);

    if (!checklist.offerId) {
      throw new ValidationError(
        "Checklist has no offer selected; complete step 1 first"
      );
    }

    const body = (request.body ?? {}) as { publicId?: unknown; status?: unknown };
    const rawPublicId = asTrimmedString(body.publicId);
    if (rawPublicId && !/^[A-Za-z0-9_-]{4,64}$/.test(rawPublicId)) {
      throw new ValidationError(
        "publicId must be 4-64 chars of letters, digits, - or _"
      );
    }
    const rawStatus = asTrimmedString(body.status)?.toUpperCase() ?? "DRAFT";
    if (!["DRAFT", "PAUSED", "ACTIVE"].includes(rawStatus)) {
      throw new ValidationError("status must be one of DRAFT, PAUSED, ACTIVE");
    }
    const status = rawStatus as "DRAFT" | "PAUSED" | "ACTIVE";

    const publicId = rawPublicId ?? (await generatePublicId(prisma, tenantId));
    if (rawPublicId) {
      const clash = await prisma.trackingLink.findFirst({
        where: { publicId, tenantId },
      });
      if (clash) {
        throw new ValidationError(`publicId "${publicId}" is already taken`);
      }
    }

    const trackingLink = await prisma.trackingLink.create({
      data: {
        id: randomUUID(),
        tenantId,
        publicId,
        offerId: checklist.offerId as string,
        landingPageId: (checklist.landingPageId as string) ?? null,
        status,
      },
    });

    const updated = await prisma.launchChecklist.update({
      where: { id: checklist.id as string },
      data: { trackingLinkId: trackingLink.id },
    });
    return { trackingLink, checklist: updated };
  });

  /**
   * Go live: set the checklist's TrackingLink to ACTIVE and queue a
   * Google Ads Script push task (SyncJob, idempotent per checklist).
   * When the link has an Ad bound and an ACTIVE script integration exists,
   * a ScriptSyncTarget is created as well (same mechanism as
   * link-swap.ts); otherwise the response carries a note instead of failing.
   */
  app.post<{ Params: { id: string } }>(
    "/api/v1/launch/:id/activate",
    async (request) => {
      const info = await requireSession(deps, request);
      const tenantId = info.tenantId;
      const checklist = await getChecklist(prisma, tenantId, request.params.id);

      if (!checklist.trackingLinkId) {
        throw new ValidationError(
          "Checklist has no tracking link; create one before activating"
        );
      }

      const link = await prisma.trackingLink.findFirst({
        where: { id: checklist.trackingLinkId as string, tenantId, deletedAt: null },
      });
      if (!link) {
        throw new NotFoundError("TrackingLink", checklist.trackingLinkId as string);
      }

      const activated = await prisma.trackingLink.update({
        where: { id: link.id },
        data: { status: "ACTIVE" },
      });

      // Script push task: idempotent SyncJob record per checklist.
      const syncJob = await prisma.syncJob.upsert({
        where: {
          tenantId_idempotencyScope_idempotencyKey: {
            tenantId,
            idempotencyScope: "LAUNCH_SCRIPT_PUSH",
            idempotencyKey: `launch:${checklist.id as string}`,
          },
        },
        update: {},
        create: {
          id: randomUUID(),
          tenantId,
          type: "LAUNCH_SCRIPT_PUSH",
          status: "PENDING",
          provider: "google-ads-script",
          idempotencyScope: "LAUNCH_SCRIPT_PUSH",
          idempotencyKey: `launch:${checklist.id as string}`,
        },
      });

      // Best-effort ScriptSyncTarget when an Ad is bound and an ACTIVE
      // integration exists. TODO: resolve the Ad→Account chain and push
      // automatically — today the user confirms the Script task from the
      // Script Integrations page.
      let scriptTargetId: string | null = null;
      let note: string | undefined;
      const adId = (link as Record<string, unknown>).adId as string | null;
      if (adId) {
        const integration = await prisma.googleAdsScriptIntegration.findFirst({
          where: { tenantId, status: "ACTIVE", deletedAt: null, archivedAt: null },
        });
        if (integration) {
          const target = await prisma.scriptSyncTarget.upsert({
            where: {
              tenantId_integrationId_entityType_entityId: {
                tenantId,
                integrationId: integration.id as string,
                entityType: "AD" as const,
                entityId: adId,
              },
            },
            update: { syncState: "NEVER_APPLIED", connectionHealth: "STALE" },
            create: {
              id: randomUUID(),
              tenantId,
              integrationId: integration.id as string,
              entityType: "AD",
              entityId: adId,
              syncState: "NEVER_APPLIED",
              connectionHealth: "STALE",
            },
          });
          scriptTargetId = target.id as string;
        } else {
          note =
            "No ACTIVE script integration found — link is ACTIVE but the Script push task needs manual confirmation";
        }
      } else {
        note =
          "Tracking link has no bound Ad — create ads via /ads/auto-create, then confirm the Script task";
      }

      const updated = await prisma.launchChecklist.update({
        where: { id: checklist.id as string },
        data: {
          status: "COMPLETED",
          currentStep: TOTAL_STEPS,
          completedAt: (checklist.completedAt as Date | null) ?? new Date(),
        },
      });

      return {
        checklist: updated,
        trackingLink: activated,
        scriptPush: {
          syncJobId: syncJob.id,
          scriptTargetId,
          note: note ?? null,
        },
        idempotencyKey: createIdempotencyKey(),
      };
    }
  );
}
