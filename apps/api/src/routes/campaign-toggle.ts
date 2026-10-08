/**
 * Campaign remote toggle — queue a Google Ads Script task to ENABLE/PAUSE
 * a single campaign, and poll / receive its execution status.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * Task record: SyncJob with type "campaign-toggle" (the codebase's task
 * record carrying type/status/payload/idempotency). NOTE: ScriptSyncTarget is
 * deliberately NOT used — it is AD-only by domain invariant
 * (assertScriptSyncTargetAdOnly) and has no type/payload fields; schema is
 * frozen, so the SyncJob task record is the schema-safe carrier.
 *
 * Dispatch channel: the same Google Ads Script integration channel —
 * the script fetches pending tasks via the integration-token-authed
 * GET /api/v1/script/campaign-toggle-tasks and reports back via
 * POST /api/v1/script/campaign-toggle-result.
 *
 * Note: there is no zod dependency in this repo, so request validation
 * follows the existing lenient-validation convention (see offer-intel.ts),
 * not zod.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuditActions } from "@adlinklab/domain";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { PrismaGoogleAdsScriptIntegrationRepository } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { requireScriptIntegrationAuth } from "../auth/integration-auth.js";
import {
  buildCampaignToggleTaskPayload,
  campaignToggleIdempotencyKey,
  isCampaignToggleAction,
  CAMPAIGN_TOGGLE_IDEMPOTENCY_SCOPE,
  CAMPAIGN_TOGGLE_PROVIDER,
  CAMPAIGN_TOGGLE_TASK_TYPE,
  type CampaignToggleAction,
  type CampaignToggleTaskPayload,
} from "../services/campaign-toggle-script.js";

export interface CampaignToggleRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: CampaignToggleRouteDeps,
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

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

type SyncJobRow = {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  provider: string;
  externalAccountId: string | null;
  idempotencyScope: string;
  idempotencyKey: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

/** Recover the canonical task payload from the queue-time audit snapshot. */
async function resolveTaskPayload(
  deps: CampaignToggleRouteDeps,
  tenantId: string,
  task: SyncJobRow
): Promise<CampaignToggleTaskPayload | null> {
  const audit = await deps.prisma.auditLog.findFirst({
    where: {
      tenantId,
      entityType: "SyncJob",
      entityId: task.id,
      action: AuditActions.CAMPAIGN_TOGGLE_QUEUED,
    },
    orderBy: { createdAt: "desc" },
  });
  const after = audit?.after as
    | (CampaignToggleTaskPayload & { taskId?: string })
    | null
    | undefined;
  if (
    after &&
    typeof after === "object" &&
    after.type === CAMPAIGN_TOGGLE_TASK_TYPE &&
    isCampaignToggleAction(after.action) &&
    typeof after.campaignId === "string" &&
    typeof after.googleCampaignId === "string" &&
    typeof after.googleAccountId === "string"
  ) {
    return { ...after, taskId: task.id };
  }
  return null;
}

function serializeTask(
  task: SyncJobRow,
  payload: CampaignToggleTaskPayload | null
) {
  return {
    taskId: task.id,
    type: task.type,
    status: task.status,
    campaignId: payload?.campaignId ?? null,
    googleCampaignId: payload?.googleCampaignId ?? null,
    action: payload?.action ?? null,
    googleAccountId: payload?.googleAccountId ?? task.externalAccountId,
    error: task.error,
    attempts: task.attempts,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
}

export async function registerCampaignToggleRoutes(
  app: FastifyInstance,
  deps: CampaignToggleRouteDeps
): Promise<void> {
  const scriptIntegrations = new PrismaGoogleAdsScriptIntegrationRepository(
    deps.prisma
  );

  /**
   * Queue a remote ENABLE/PAUSE for one campaign.
   * Session auth. Tenant-scoped: the campaign must belong to the caller's tenant.
   */
  app.post<{
    Params: { id: string };
    Body: { action?: unknown; googleAccountId?: unknown; reason?: unknown };
  }>("/api/v1/google-ads/campaigns/:id/toggle", async (request) => {
    const session = await requireSession(deps, request);
    const tenantId = session.tenantId;
    const campaignId = request.params.id;
    if (!UUID_RE.test(campaignId)) {
      throw new NotFoundError("Campaign", campaignId);
    }

    const body = request.body ?? {};
    const action = body.action;
    if (!isCampaignToggleAction(action)) {
      throw new ValidationError('action must be "ENABLE" or "PAUSE"', {
        action: typeof action === "string" ? action : typeof action,
      });
    }
    const googleAccountId = asTrimmedString(body.googleAccountId);
    if (!googleAccountId) {
      throw new ValidationError("googleAccountId is required");
    }
    const reason = asTrimmedString(body.reason);

    // 1) Campaign ownership (tenantId) — 404 for other tenants' campaigns.
    const campaign = await deps.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId, deletedAt: null },
    });
    if (!campaign) {
      throw new NotFoundError("Campaign", campaignId);
    }

    // 2) The googleAccountId in the body must be this campaign's account,
    //    and the account must belong to the tenant.
    if (campaign.googleAccountId !== googleAccountId) {
      throw new ValidationError(
        "googleAccountId does not match the campaign's Google account",
        { campaignId }
      );
    }
    const googleAccount = await deps.prisma.googleAccount.findFirst({
      where: { id: googleAccountId, tenantId },
    });
    if (!googleAccount) {
      throw new ValidationError("GoogleAccount not found for tenant", {
        googleAccountId,
      });
    }

    // 3) Idempotent queueing: an already-pending task for the same
    //    (campaign, action) is returned instead of duplicated.
    const idempotencyKey = campaignToggleIdempotencyKey(
      campaignId,
      action as CampaignToggleAction
    );
    const existing = await deps.prisma.syncJob.findUnique({
      where: {
        tenantId_idempotencyScope_idempotencyKey: {
          tenantId,
          idempotencyScope: CAMPAIGN_TOGGLE_IDEMPOTENCY_SCOPE,
          idempotencyKey,
        },
      },
    });
    if (
      existing &&
      existing.type === CAMPAIGN_TOGGLE_TASK_TYPE &&
      (existing.status === "PENDING" || existing.status === "RUNNING")
    ) {
      const payload = await resolveTaskPayload(
        deps,
        tenantId,
        existing as SyncJobRow
      );
      return {
        deduped: true,
        taskId: existing.id,
        task: serializeTask(existing as SyncJobRow, payload),
      };
    }

    // 4) Create the task record (SyncJob = the codebase's task mechanism).
    const taskId = randomUUID();
    const payload = buildCampaignToggleTaskPayload({
      taskId,
      campaignId,
      googleCampaignId: campaign.googleCampaignId,
      action: action as CampaignToggleAction,
      googleAccountId,
      tenantId,
      requestedBy: session.id,
    });
    const created = (await deps.prisma.syncJob.create({
      data: {
        id: taskId,
        tenantId,
        type: CAMPAIGN_TOGGLE_TASK_TYPE,
        status: "PENDING",
        provider: CAMPAIGN_TOGGLE_PROVIDER,
        externalAccountId: googleAccountId,
        idempotencyScope: CAMPAIGN_TOGGLE_IDEMPOTENCY_SCOPE,
        idempotencyKey,
        attempts: 0,
      },
    })) as SyncJobRow;

    // 5) Audit log (action + reason). The `after` snapshot is also the
    //    durable source of the task payload for the script fetch endpoint.
    await deps.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorId: session.id,
        action: AuditActions.CAMPAIGN_TOGGLE_QUEUED,
        entityType: "SyncJob",
        entityId: taskId,
        after: JSON.parse(JSON.stringify(payload)) as never,
        reason: reason ?? `campaign ${action} requested from campaigns page`,
      },
    });

    return {
      deduped: false,
      taskId,
      task: serializeTask(created, payload),
    };
  });

  /**
   * Poll a toggle task's status (session auth). Frontend polls this after
   * queueing until status is COMPLETED / FAILED.
   */
  app.get<{ Params: { taskId: string } }>(
    "/api/v1/google-ads/campaign-toggle-tasks/:taskId",
    async (request) => {
      const session = await requireSession(deps, request);
      const taskId = request.params.taskId;
      if (!UUID_RE.test(taskId)) {
        throw new NotFoundError("CampaignToggleTask", taskId);
      }
      const task = (await deps.prisma.syncJob.findFirst({
        where: {
          id: taskId,
          tenantId: session.tenantId,
          type: CAMPAIGN_TOGGLE_TASK_TYPE,
        },
      })) as SyncJobRow | null;
      if (!task) {
        throw new NotFoundError("CampaignToggleTask", taskId);
      }
      const payload = await resolveTaskPayload(
        deps,
        session.tenantId,
        task
      );
      return serializeTask(task, payload);
    }
  );

  /**
   * Script fetch channel (Integration Token auth): pending toggle tasks for
   * this integration's tenant + Google account. Same auth as the URL-sync
   * config/result endpoints — the toggle rides the same dispatch channel.
   */
  app.get("/api/v1/script/campaign-toggle-tasks", async (request) => {
    const ctx = await requireScriptIntegrationAuth(
      { scriptIntegrations },
      request
    );
    const rows = (await deps.prisma.syncJob.findMany({
      where: {
        tenantId: ctx.tenantId,
        type: CAMPAIGN_TOGGLE_TASK_TYPE,
        status: "PENDING",
        externalAccountId: ctx.googleAccountId,
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    })) as SyncJobRow[];
    const tasks: CampaignToggleTaskPayload[] = [];
    for (const row of rows) {
      const payload = await resolveTaskPayload(deps, ctx.tenantId, row);
      if (payload) tasks.push(payload);
    }
    return { tasks };
  });

  /**
   * Script result writeback (Integration Token auth): mark a toggle task
   * COMPLETED / FAILED. Idempotent — replays of an already-terminal task
   * are acknowledged without side effects.
   */
  app.post<{
    Body: {
      taskId?: unknown;
      result?: unknown;
      errorCode?: unknown;
      errorMessage?: unknown;
      idempotencyKey?: unknown;
    };
  }>("/api/v1/script/campaign-toggle-result", async (request) => {
    const ctx = await requireScriptIntegrationAuth(
      { scriptIntegrations },
      request
    );
    const body = request.body ?? {};
    const taskId = asTrimmedString(body.taskId);
    if (!taskId || !UUID_RE.test(taskId)) {
      throw new ValidationError("taskId must be a UUID");
    }
    const result = body.result;
    if (result !== "SUCCESS" && result !== "FAILED") {
      throw new ValidationError('result must be "SUCCESS" or "FAILED"');
    }
    const task = (await deps.prisma.syncJob.findFirst({
      where: {
        id: taskId,
        tenantId: ctx.tenantId,
        type: CAMPAIGN_TOGGLE_TASK_TYPE,
      },
    })) as SyncJobRow | null;
    if (!task) {
      throw new NotFoundError("CampaignToggleTask", taskId);
    }
    if (task.status === "COMPLETED" || task.status === "FAILED") {
      return { ok: true, taskId, status: task.status, alreadyApplied: true };
    }

    const errorCode = asTrimmedString(body.errorCode);
    const errorMessage = asTrimmedString(body.errorMessage);
    const error =
      [errorCode, errorMessage].filter(Boolean).join(": ") || null;
    const updated = (await deps.prisma.syncJob.update({
      where: { id: taskId },
      data: {
        status: result === "SUCCESS" ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        error,
      },
    })) as SyncJobRow;

    await deps.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        actorId: ctx.tokenKeyId,
        action:
          result === "SUCCESS"
            ? AuditActions.CAMPAIGN_TOGGLE_SUCCEEDED
            : AuditActions.CAMPAIGN_TOGGLE_FAILED,
        entityType: "SyncJob",
        entityId: taskId,
        after: {
          taskId,
          result,
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
        },
        reason: "reported by Google Ads Script",
      },
    });

    return { ok: true, taskId, status: updated.status };
  });
}
