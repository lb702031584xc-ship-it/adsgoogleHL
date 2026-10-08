/**
 * 功能1 — 网盟自动换链 (push-url-change).
 *
 * POST /api/v1/tracking-links/:id/swap-url
 * Flow: verify TrackingLink ownership → create DRAFT UrlVersion → create
 * UrlChangeRequest (status DRAFT, existing initial state; carries the new
 * automation fields referralUrl / deviceTarget / googleAccountId) →
 * create/update ScriptSyncTarget (the push-url-change task the Google Ads
 * Script consumes) → return request. Writes an AuditLog entry.
 *
 * Pure addition: this endpoint only, no existing route behavior changed.
 * googleAccountId is a plain UUID with no Prisma relation (matches schema
 * comment) — the account is checked manually for tenant ownership.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  createIdempotencyKey,
} from "@adlinklab/shared";
import { AuditActions } from "@adlinklab/domain";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

export interface LinkSwapRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: LinkSwapRouteDeps,
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

const DEVICE_TARGETS = ["desktop", "mobile", "all"] as const;
type DeviceTarget = (typeof DEVICE_TARGETS)[number];

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** Accepts only absolute http(s) URLs — same rule as the lander routes. */
function assertHttpUrl(raw: unknown, field: string): string {
  const trimmed = asTrimmedString(raw);
  if (!trimmed) {
    throw new ValidationError(`${field} is required`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError(`${field} must be a valid http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`${field} must be a valid http(s) URL`);
  }
  return trimmed;
}

function asOptionalHttpUrl(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return assertHttpUrl(raw, field);
}

function asDeviceTarget(raw: unknown): DeviceTarget {
  const s = asTrimmedString(raw) ?? "all";
  if ((DEVICE_TARGETS as readonly string[]).includes(s)) {
    return s as DeviceTarget;
  }
  throw new ValidationError(
    `deviceTarget must be one of: ${DEVICE_TARGETS.join(", ")}`
  );
}

function asOptionalUuid(raw: unknown, field: string): string | undefined {
  const s = asTrimmedString(raw);
  if (!s) return undefined;
  if (!UUID_RE.test(s)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }
  return s;
}

export async function registerLinkSwapRoutes(
  app: FastifyInstance,
  deps: LinkSwapRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * Create a push-url-change request for a tracking link.
   * Body: { newUrl, referralUrl?, deviceTarget?, googleAccountId? }
   */
  app.post<{
    Params: { id: string };
    Body: {
      newUrl?: unknown;
      referralUrl?: unknown;
      deviceTarget?: unknown;
      googleAccountId?: unknown;
    };
  }>("/api/v1/tracking-links/:id/swap-url", async (request) => {
    const info = await requireSession(deps, request);
    const tenantId = info.tenantId;
    const body = (request.body ?? {}) as {
      newUrl?: unknown;
      referralUrl?: unknown;
      deviceTarget?: unknown;
      googleAccountId?: unknown;
    };

    // ---- 1. Validate input ------------------------------------------------
    const newUrl = assertHttpUrl(body.newUrl, "newUrl");
    const referralUrl = asOptionalHttpUrl(body.referralUrl, "referralUrl");
    const deviceTarget = asDeviceTarget(body.deviceTarget);
    const explicitAccountId = asOptionalUuid(
      body.googleAccountId,
      "googleAccountId"
    );

    // ---- 2. Verify TrackingLink ownership ---------------------------------
    const link = await prisma.trackingLink.findFirst({
      where: { id: request.params.id, tenantId, deletedAt: null },
    });
    if (!link) {
      throw new NotFoundError("TrackingLink", request.params.id);
    }
    if (!link.adId) {
      throw new ValidationError(
        "TrackingLink has no associated Ad; cannot push a URL change",
        { trackingLinkId: link.id }
      );
    }

    // ---- 3. Resolve the Ad → AdGroup → Campaign → GoogleAccount chain -----
    const ad = await prisma.ad.findFirst({
      where: { id: link.adId, tenantId, deletedAt: null },
    });
    if (!ad) {
      throw new NotFoundError("Ad", link.adId);
    }
    const adGroup = await prisma.adGroup.findFirst({
      where: { id: ad.adGroupId, tenantId, deletedAt: null },
    });
    const campaign = adGroup
      ? await prisma.campaign.findFirst({
          where: { id: adGroup.campaignId, tenantId, deletedAt: null },
        })
      : null;
    const resolvedAccountId = explicitAccountId ?? campaign?.googleAccountId;

    if (explicitAccountId) {
      const account = await prisma.googleAccount.findFirst({
        where: { id: explicitAccountId, tenantId, deletedAt: null },
      });
      if (!account) {
        throw new NotFoundError("GoogleAccount", explicitAccountId);
      }
      if (campaign && campaign.googleAccountId !== explicitAccountId) {
        throw new ValidationError(
          "TrackingLink campaign does not belong to the given GoogleAccount",
          {
            trackingLinkId: link.id,
            campaignGoogleAccountId: campaign.googleAccountId,
            googleAccountId: explicitAccountId,
          }
        );
      }
    }
    if (!resolvedAccountId) {
      throw new ValidationError(
        "Cannot resolve a Google Ads account for this TrackingLink",
        { trackingLinkId: link.id }
      );
    }

    // ---- 4. Find an ACTIVE script integration for the account -------------
    const integration = await prisma.googleAdsScriptIntegration.findFirst({
      where: {
        tenantId,
        googleAccountId: resolvedAccountId,
        status: "ACTIVE",
        deletedAt: null,
        archivedAt: null,
      },
    });
    if (!integration) {
      throw new ValidationError(
        "No ACTIVE script integration for this Google account; create one before pushing URL changes",
        { googleAccountId: resolvedAccountId }
      );
    }

    // ---- 5. Create the DRAFT UrlVersion for the new URL -------------------
    const latest = await prisma.urlVersion.findFirst({
      where: { tenantId, entityType: "AD", entityId: ad.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    const urlVersion = await prisma.urlVersion.create({
      data: {
        id: randomUUID(),
        tenantId,
        entityType: "AD",
        entityId: ad.id,
        finalUrl: newUrl,
        // deviceTarget drives which URL slots the push touches; stored here
        // so the Script config (ACTIVE-version source) stays consistent.
        finalMobileUrl:
          deviceTarget === "mobile" || deviceTarget === "all" ? newUrl : null,
        customParameters: {},
        version: nextVersion,
        status: "DRAFT",
        createdBy: info.id,
      },
    });

    // ---- 6. Create the UrlChangeRequest (status DRAFT = existing initial) --
    const idempotencyKey = createIdempotencyKey(
      "linkSwap",
      "AD",
      ad.id,
      urlVersion.id,
      info.id
    );
    const changeRequest = await prisma.urlChangeRequest.create({
      data: {
        id: randomUUID(),
        tenantId,
        entityType: "AD",
        entityId: ad.id,
        toVersionId: urlVersion.id,
        reason: `link-swap from tracking link ${link.publicId}`,
        requestedBy: info.id,
        status: "DRAFT",
        idempotencyScope: "URL_CHANGE",
        idempotencyKey,
        referralUrl: referralUrl ?? null,
        deviceTarget,
        googleAccountId: resolvedAccountId,
      },
    });

    // ---- 7. Create (or refresh) the push-url-change ScriptSyncTarget -------
    const targetWhere = {
      tenantId_integrationId_entityType_entityId: {
        tenantId,
        integrationId: integration.id,
        entityType: "AD" as const,
        entityId: ad.id,
      },
    };
    const target = await prisma.scriptSyncTarget.upsert({
      where: targetWhere,
      update: {
        googleAdId: ad.googleAdId,
        campaignId: campaign?.id ?? null,
        adGroupId: adGroup?.id ?? null,
        desiredVersion: urlVersion.version,
        syncState: "NEVER_APPLIED",
        connectionHealth: "STALE",
        deletedAt: null,
        archivedAt: null,
      },
      create: {
        id: randomUUID(),
        tenantId,
        integrationId: integration.id,
        entityType: "AD",
        entityId: ad.id,
        googleAdId: ad.googleAdId,
        campaignId: campaign?.id ?? null,
        adGroupId: adGroup?.id ?? null,
        desiredVersion: urlVersion.version,
        syncState: "NEVER_APPLIED",
        connectionHealth: "STALE",
      },
    });

    // ---- 8. Audit ----------------------------------------------------------
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorId: info.id,
        action: AuditActions.URL_CHANGE_REQUEST_CREATED,
        entityType: "UrlChangeRequest",
        entityId: changeRequest.id,
        before: {} as never,
        after: {
          taskType: "push-url-change",
          trackingLinkId: link.id,
          entityType: "AD",
          entityId: ad.id,
          newUrl,
          referralUrl: referralUrl ?? null,
          deviceTarget,
          googleAccountId: resolvedAccountId,
          urlChangeRequestId: changeRequest.id,
          urlVersionId: urlVersion.id,
          urlVersion: urlVersion.version,
          scriptSyncTargetId: target.id,
          integrationId: integration.id,
        } as never,
        reason: `link-swap from tracking link ${link.publicId}`,
        ip: request.ip ?? null,
        userAgent: request.headers["user-agent"] ?? null,
      },
    });

    return {
      request: changeRequest,
      task: {
        type: "push-url-change",
        scriptSyncTargetId: target.id,
        integrationId: integration.id,
        entityType: "AD",
        entityId: ad.id,
        desiredVersion: urlVersion.version,
      },
    };
  });
}
