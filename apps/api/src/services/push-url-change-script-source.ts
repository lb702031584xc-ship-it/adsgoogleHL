/**
 * 功能1 — push-url-change Google Ads Script source generation.
 * Target runtime: Google Ads Scripts (AdsApp), NOT Node.js.
 *
 * SAFETY (铁律):
 * - The script only touches ads whose Google Ads IDs are listed in the task
 *   payload — no cross-account access, no privilege escalation, no bulk ops.
 * - Every parameter is injected as a JSON string literal (jsStringLiteral),
 *   never concatenated as raw code — untrusted input cannot become code.
 * - Do not log tokens; this script carries no credentials at all.
 */
export const PUSH_URL_CHANGE_SCRIPT_VERSION = "1.0.0";

export type PushUrlChangeDeviceTarget = "desktop" | "mobile" | "all";

export interface PushUrlChangeTaskParams {
  /** AdLinkLab UrlChangeRequest id — correlation/logging only. */
  requestId: string;
  /** Google Ads ad IDs to update (as strings). ONLY these ads are touched. */
  googleAdIds: string[];
  /** New final URL. */
  newUrl: string;
  /**
   * Optional referral URL. Its query string is appended to the new URL
   * ("referralUrl 拼接"): e.g. referralUrl "https://r.example/?aff=1&sub=2"
   * turns "https://m.example/deal" into "https://m.example/deal?aff=1&sub=2".
   */
  referralUrl?: string | null;
  /**
   * Which URL slots to update ("deviceTarget 注释说明" — see script header):
   * - "desktop": set the standard final URL (Google Ads serves desktop
   *   traffic from it); the mobile-specific URL slot is left untouched.
   * - "mobile": set the mobile final URL only; desktop keeps its URL.
   * - "all": set both final URL and mobile final URL to the merged URL.
   */
  deviceTarget: PushUrlChangeDeviceTarget;
}

/** Escape a value as a JavaScript string literal (quotes included). */
function jsStringLiteral(value: unknown): string {
  return JSON.stringify(value);
}

function assertTaskParams(params: PushUrlChangeTaskParams): void {
  if (!params.requestId || !params.requestId.trim()) {
    throw new Error("requestId is required");
  }
  if (!Array.isArray(params.googleAdIds) || params.googleAdIds.length === 0) {
    throw new Error("googleAdIds must be a non-empty array");
  }
  for (const id of params.googleAdIds) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("googleAdIds must contain non-empty strings");
    }
  }
  assertHttpUrl(params.newUrl, "newUrl");
  if (params.referralUrl != null && params.referralUrl !== "") {
    assertHttpUrl(params.referralUrl, "referralUrl");
  }
  if (
    params.deviceTarget !== "desktop" &&
    params.deviceTarget !== "mobile" &&
    params.deviceTarget !== "all"
  ) {
    throw new Error('deviceTarget must be "desktop", "mobile" or "all"');
  }
}

function assertHttpUrl(raw: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must be a valid http(s) URL`);
  }
}

/**
 * Build the Google Ads Script source for one push-url-change task.
 * All task values are JSON-encoded into a TASK literal — no code injection.
 */
export function buildPushUrlChangeScriptSource(
  params: PushUrlChangeTaskParams
): string {
  assertTaskParams(params);
  const taskLit = jsStringLiteral({
    requestId: params.requestId,
    googleAdIds: params.googleAdIds,
    newUrl: params.newUrl,
    referralUrl: params.referralUrl ?? null,
    deviceTarget: params.deviceTarget,
    scriptVersion: PUSH_URL_CHANGE_SCRIPT_VERSION,
  });

  return `/**
 * AdLinkLab push-url-change task script
 * Script version: ${PUSH_URL_CHANGE_SCRIPT_VERSION}
 *
 * Applies a single URL-change task to the Google Ads account this script
 * runs in. SAFETY: only the ad IDs listed in PUSH_URL_CHANGE_TASK below
 * are modified; nothing else in the account is touched. No credentials are
 * embedded in this script.
 *
 * deviceTarget semantics:
 * - "desktop": update the standard final URL. Google Ads serves desktop
 *   traffic from the final URL; the mobile final URL slot is left as-is.
 * - "mobile": update the mobile final URL only; the desktop final URL slot
 *   keeps its current value.
 * - "all": update BOTH the final URL and the mobile final URL to the same
 *   merged URL.
 *
 * referralUrl 拼接: when referralUrl is set, its query string is appended
 * to newUrl before applying (e.g. newUrl "https://m.example/deal" +
 * referralUrl "https://r.example/?aff=1" -> "https://m.example/deal?aff=1").
 */
var PUSH_URL_CHANGE_TASK = ${taskLit};

function main() {
  var task = PUSH_URL_CHANGE_TASK;
  if (!task || !task.requestId) {
    Logger.log("push-url-change: missing task payload, aborting");
    return;
  }
  var finalUrl = mergeReferralUrl_(task.newUrl, task.referralUrl);
  if (!finalUrl) {
    Logger.log("push-url-change requestId=" + task.requestId + " invalid newUrl, aborting");
    return;
  }
  var updated = 0;
  var skipped = 0;
  var ids = task.googleAdIds || [];
  for (var i = 0; i < ids.length; i++) {
    if (updateAdUrl_(ids[i], finalUrl, task.deviceTarget, task.requestId)) {
      updated++;
    } else {
      skipped++;
    }
  }
  Logger.log(
    "push-url-change requestId=" +
      task.requestId +
      " done updated=" +
      updated +
      " skipped=" +
      skipped
  );
}

/**
 * Append the referral URL's query string to the base URL.
 * Returns the merged URL, or null when the base URL is not usable.
 * Both values come from the JSON task payload (never eval'd).
 */
function mergeReferralUrl_(baseUrl, referralUrl) {
  var base = String(baseUrl || "");
  if (base.indexOf("http://") !== 0 && base.indexOf("https://") !== 0) {
    return null;
  }
  var ref = String(referralUrl || "");
  if (!ref) {
    return base;
  }
  var q = ref.indexOf("?");
  if (q < 0 || q === ref.length - 1) {
    // referralUrl carries no query string — nothing to append.
    return base;
  }
  var query = ref.substring(q + 1);
  var sep = base.indexOf("?") >= 0 ? "&" : "?";
  return base + sep + query;
}

/**
 * Update one ad's URL slots. The ad is located ONLY by the given Google Ads
 * ID (quote-stripped, like the AdLinkLab sync script) — no other targeting.
 */
function updateAdUrl_(googleAdId, finalUrl, deviceTarget, requestId) {
  try {
    var safeId = String(googleAdId).replace(/"/g, "");
    if (!safeId) {
      Logger.log("push-url-change requestId=" + requestId + " empty ad id, skipping");
      return false;
    }
    var iterator = AdsApp.ads()
      .withCondition('Id = "' + safeId + '"')
      .get();
    if (!iterator.hasNext()) {
      Logger.log(
        "push-url-change requestId=" + requestId + " ad not found id=" + safeId
      );
      return false;
    }
    var urls = iterator.next().urls();
    // deviceTarget drives which slots change (see header comment):
    // - "desktop": standard final URL only (desktop traffic source);
    // - "mobile": mobile final URL only (desktop untouched);
    // - "all": both slots.
    if (deviceTarget === "mobile") {
      urls.setMobileFinalUrl(finalUrl);
    } else if (deviceTarget === "desktop") {
      urls.setFinalUrl(finalUrl);
    } else {
      urls.setFinalUrl(finalUrl);
      urls.setMobileFinalUrl(finalUrl);
    }
    Logger.log(
      "push-url-change requestId=" +
        requestId +
        " updated ad id=" +
        safeId +
        " deviceTarget=" +
        deviceTarget
    );
    return true;
  } catch (e) {
    Logger.log(
      "push-url-change requestId=" + requestId + " apply failed id=" + googleAdId
    );
    return false;
  }
}
`;
}
