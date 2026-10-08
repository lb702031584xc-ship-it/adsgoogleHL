/**
 * Campaign remote toggle — Google Ads Script task payload + script snippet.
 *
 * The toggle is dispatched through the same Script channel as the URL sync:
 * a `campaign-toggle` task is queued server-side, the Google Ads Script
 * fetches pending tasks, applies ENABLE/PAUSE, and reports the result back.
 *
 * SAFETY IRON RULE: the script operates ONLY on the googleCampaignId carried
 * by each task, via AdsApp.campaigns().withIds([id]) — it never enumerates
 * or touches any other campaign.
 */

/** SyncJob.type value for campaign toggle tasks. */
export const CAMPAIGN_TOGGLE_TASK_TYPE = "campaign-toggle";

/** SyncJob.idempotencyScope for campaign toggle tasks. */
export const CAMPAIGN_TOGGLE_IDEMPOTENCY_SCOPE = "CAMPAIGN_TOGGLE";

/** SyncJob.provider for campaign toggle tasks (executed by the Script). */
export const CAMPAIGN_TOGGLE_PROVIDER = "google-ads-script";

/** Task payload schema version (for forward-compatible script parsing). */
export const CAMPAIGN_TOGGLE_PAYLOAD_VERSION = 1;

export type CampaignToggleAction = "ENABLE" | "PAUSE";

export const CAMPAIGN_TOGGLE_ACTIONS: readonly CampaignToggleAction[] = [
  "ENABLE",
  "PAUSE",
] as const;

export function isCampaignToggleAction(
  value: unknown
): value is CampaignToggleAction {
  return value === "ENABLE" || value === "PAUSE";
}

export interface CampaignToggleTaskPayload {
  /** Task envelope type — always "campaign-toggle". */
  type: typeof CAMPAIGN_TOGGLE_TASK_TYPE;
  /** Payload schema version. */
  version: typeof CAMPAIGN_TOGGLE_PAYLOAD_VERSION;
  /** SyncJob id of this task (for result reporting). */
  taskId: string;
  /** AdLinkLab internal Campaign UUID. */
  campaignId: string;
  /** Google Ads campaign id (numeric, as stored on Campaign.googleCampaignId). */
  googleCampaignId: string;
  /** Desired end state. */
  action: CampaignToggleAction;
  /** AdLinkLab internal GoogleAccount UUID (script-side account scoping). */
  googleAccountId: string;
  tenantId: string;
  requestedAt: string;
  requestedBy?: string;
}

export interface BuildCampaignTogglePayloadInput {
  taskId: string;
  campaignId: string;
  googleCampaignId: string;
  action: CampaignToggleAction;
  googleAccountId: string;
  tenantId: string;
  requestedBy?: string;
}

/**
 * Build the canonical payload for a `campaign-toggle` task.
 * Pure function — deterministic, no I/O. Carries no secrets.
 */
export function buildCampaignToggleTaskPayload(
  input: BuildCampaignTogglePayloadInput
): CampaignToggleTaskPayload {
  return {
    type: CAMPAIGN_TOGGLE_TASK_TYPE,
    version: CAMPAIGN_TOGGLE_PAYLOAD_VERSION,
    taskId: input.taskId,
    campaignId: input.campaignId,
    googleCampaignId: input.googleCampaignId,
    action: input.action,
    googleAccountId: input.googleAccountId,
    tenantId: input.tenantId,
    requestedAt: new Date().toISOString(),
    // Only include when defined — Prisma Json rejects undefined values.
    ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
  };
}

/**
 * Idempotency key for a toggle request: one pending task per
 * (campaign, action). Re-queueing the same action while one is pending
 * returns the existing task instead of creating a duplicate.
 */
export function campaignToggleIdempotencyKey(
  campaignId: string,
  action: CampaignToggleAction
): string {
  return `toggle:${campaignId}:${action}`;
}

export interface CampaignToggleScriptSourceParams {
  /** Absolute URL of GET /api/v1/script/campaign-toggle-tasks. */
  tasksEndpoint: string;
  /** Absolute URL of POST /api/v1/script/campaign-toggle-result. */
  resultEndpoint: string;
  /** Integration id (opaque; used for idempotency keys only). */
  integrationId: string;
  /** Authorization bearer token, embedded in-memory only (never logged). */
  token: string;
  generatorVersion?: string;
}

/** Escape a value as a JavaScript string literal (quotes included). */
function jsLit(value: string): string {
  return JSON.stringify(value);
}

/**
 * Build the Google Ads Script snippet that executes campaign-toggle tasks.
 *
 * Target runtime: Google Ads Scripts (UrlFetchApp / AdsApp), NOT Node.js.
 *
 * SAFETY:
 * - Each task is executed by single-ID lookup:
 *   AdsApp.campaigns().withIds([googleCampaignId]).get().
 * - googleCampaignId must match /^\d+$/ or the task is reported FAILED
 *   without touching anything.
 * - The snippet never calls AdsApp.campaigns() without withIds — no
 *   enumeration, no batch operation on other campaigns.
 * - action must be exactly "ENABLE" or "PAUSE"; anything else → FAILED.
 */
export function buildCampaignToggleScriptSource(
  params: CampaignToggleScriptSourceParams
): string {
  const generatorVersion =
    params.generatorVersion ?? "campaign-toggle/1.0.0";
  const tasksUrlLit = jsLit(params.tasksEndpoint);
  const resultUrlLit = jsLit(params.resultEndpoint);
  const integrationIdLit = jsLit(params.integrationId);
  const tokenLit = jsLit(params.token);
  const genVerLit = jsLit(generatorVersion);

  return `/**
 * AdLinkLab campaign-toggle executor
 * Generator version: ${generatorVersion}
 *
 * Fetches pending campaign-toggle tasks from AdLinkLab, applies ENABLE/PAUSE
 * to the SINGLE campaign named by each task, and reports the result back.
 *
 * SAFETY: operates ONLY on task.googleCampaignId via withIds([id]).
 * Never enumerates campaigns. Never touches other campaigns.
 * Do not log Authorization headers or tokens.
 */
var ADLINKLAB_TOGGLE = {
  generatorVersion: ${genVerLit},
  integrationId: ${integrationIdLit},
  tasksEndpoint: ${tasksUrlLit},
  resultEndpoint: ${resultUrlLit},
  token: ${tokenLit}
};

function adlinklabToggleMain() {
  var tasks = adlinklabToggleFetchTasks_();
  if (!tasks) {
    return;
  }
  for (var i = 0; i < tasks.length; i++) {
    adlinklabToggleApply_(tasks[i]);
  }
}

function adlinklabToggleFetchTasks_() {
  var options = {
    method: "get",
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ADLINKLAB_TOGGLE.token }
  };
  var response;
  try {
    response = UrlFetchApp.fetch(ADLINKLAB_TOGGLE.tasksEndpoint, options);
  } catch (e) {
    Logger.log("AdLinkLab toggle fetch transport error");
    return null;
  }
  var code = response.getResponseCode();
  if (code === 401 || code === 403) {
    Logger.log("AdLinkLab toggle fetch auth failed status=" + code);
    return null;
  }
  if (code < 200 || code >= 300) {
    Logger.log("AdLinkLab toggle fetch HTTP status=" + code);
    return null;
  }
  try {
    var body = JSON.parse(response.getContentText());
    return body.tasks || [];
  } catch (e) {
    Logger.log("AdLinkLab toggle fetch parse error");
    return null;
  }
}

function adlinklabToggleApply_(task) {
  if (!task || task.type !== "campaign-toggle" || !task.taskId) {
    return;
  }
  var action = task.action;
  if (action !== "ENABLE" && action !== "PAUSE") {
    adlinklabToggleReport_(task.taskId, "FAILED", "INVALID_ACTION");
    return;
  }
  // Strict numeric campaign id — reject anything else before touching AdsApp.
  var rawId = String(task.googleCampaignId == null ? "" : task.googleCampaignId);
  if (!/^\\d+$/.test(rawId)) {
    Logger.log("AdLinkLab toggle taskId=" + task.taskId + " invalid googleCampaignId");
    adlinklabToggleReport_(task.taskId, "FAILED", "INVALID_CAMPAIGN_ID");
    return;
  }
  try {
    // SINGLE-campaign lookup only. No enumeration. No other campaign touched.
    var iterator = AdsApp.campaigns().withIds([Number(rawId)]).get();
    if (!iterator.hasNext()) {
      Logger.log("AdLinkLab toggle taskId=" + task.taskId + " campaign not found");
      adlinklabToggleReport_(task.taskId, "FAILED", "CAMPAIGN_NOT_FOUND");
      return;
    }
    var campaign = iterator.next();
    if (action === "ENABLE") {
      campaign.enable();
    } else {
      campaign.pause();
    }
    Logger.log("AdLinkLab toggle taskId=" + task.taskId + " action=" + action + " ok");
    adlinklabToggleReport_(task.taskId, "SUCCESS", null);
  } catch (e) {
    Logger.log("AdLinkLab toggle taskId=" + task.taskId + " apply error");
    adlinklabToggleReport_(task.taskId, "FAILED", "APPLY_ERROR");
  }
}

function adlinklabToggleReport_(taskId, result, errorCode) {
  var payload = {
    taskId: taskId,
    result: result,
    errorCode: errorCode || null,
    idempotencyKey:
      ADLINKLAB_TOGGLE.integrationId + ":" + taskId + ":" + result
  };
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ADLINKLAB_TOGGLE.token }
  };
  var response;
  try {
    response = UrlFetchApp.fetch(ADLINKLAB_TOGGLE.resultEndpoint, options);
  } catch (e) {
    Logger.log("AdLinkLab toggle report transport error taskId=" + taskId);
    return;
  }
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log("AdLinkLab toggle report HTTP status=" + code + " taskId=" + taskId);
  }
}
`;
}
