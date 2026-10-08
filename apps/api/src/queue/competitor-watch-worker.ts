/**
 * Lander Intel ② — competitor landing-page watch worker.
 *
 * Hourly BullMQ repeatable schedule (worker-owned, like kill-switch /
 * traffic-monitor): scans every active watch whose `now - lastCheckedAt`
 * reached its `checkInterval`, fetches the page with the SSRF-safe
 * `fetchPageHtml`, extracts key fields, and compares the SHA-256 snapshot
 * hash. On change: writes a CompetitorChange row with the field-level diff,
 * updates lastHash/lastCheckedAt, and raises an Alert (deduped 24h per
 * watch). Fetch failures never throw — they only touch lastCheckedAt, so a
 * dead page cannot wedge the hourly run.
 *
 * Compliance:
 * - Only user-added public URLs are fetched (watches are tenant-scoped rows
 *   the user created themselves).
 * - checkInterval is hard-clamped to >= 3600s in code.
 * - robots.txt is honored: before fetching, `https://{domain}/robots.txt`
 *   is read (via the same SSRF-safe fetch) and `Disallow:` lines for
 *   `User-agent: *` are prefix-matched against the path. A missing or
 *   unreadable robots.txt is treated as allowed.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { fetchPageHtml } from "../ai/fetch-page.js";
import {
  diffCompetitorSnapshots,
  diffIsEmpty,
  extractCompetitorFields,
  hashCompetitorSnapshot,
  type CompetitorDiff,
  type CompetitorSnapshot,
} from "../ai/competitor-extract.js";

/** Hard floor for checkInterval (seconds) — enforced in worker and routes. */
export const COMPETITOR_WATCH_MIN_INTERVAL_S = 3600;

/** Alert dedupe window: one open alert per watch+metric per 24h. */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

const ALERT_METRIC = "competitor_change";

export interface CompetitorWatchLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

interface WatchRow {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  checkInterval: number;
  lastHash: string | null;
  lastCheckedAt: Date | null;
}

// ---------------------------------------------------------------------------
// robots.txt (pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Parse `Disallow:` paths that apply to `User-agent: *` groups.
 * Simple implementation: strip comments, group consecutive User-agent lines
 * with their rules, prefix-match later.
 */
export function parseRobotsDisallows(robotsText: string): string[] {
  const disallows: string[] = [];
  let groupAgents: string[] = [];
  let seenRuleInGroup = false;
  for (const rawLine of (robotsText ?? "").split(/\r?\n/)) {
    const line = (rawLine.split("#", 1)[0] ?? "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      // A User-agent line after rules starts a fresh group.
      if (seenRuleInGroup) groupAgents = [];
      seenRuleInGroup = false;
      groupAgents.push(value.toLowerCase());
    } else if (field === "disallow") {
      seenRuleInGroup = true;
      // Empty Disallow: means "allow all" — nothing to record.
      if (value.length > 0 && groupAgents.includes("*")) {
        disallows.push(value);
      }
    } else {
      seenRuleInGroup = true;
    }
  }
  return disallows;
}

/** True when `path` is not covered by any applicable Disallow prefix. */
export function isRobotsPathAllowed(
  robotsText: string,
  path: string
): boolean {
  const disallows = parseRobotsDisallows(robotsText);
  return !disallows.some((d) => path.startsWith(d));
}

/**
 * Fetch `https://{domain}/robots.txt` with the SSRF-safe fetcher.
 * Returns null when the file is missing/unreadable (treated as allowed).
 */
export async function fetchRobotsText(
  domain: string,
  fetchPageHtmlImpl: typeof fetchPageHtml = fetchPageHtml
): Promise<string | null> {
  try {
    const page = await fetchPageHtmlImpl(`https://${domain}/robots.txt`);
    return page.html;
  } catch {
    return null;
  }
}

/**
 * True when the URL may be fetched (robots.txt has no applicable Disallow).
 * Never throws: unparseable URLs are reported as disallowed (fail closed).
 */
export async function isFetchAllowedByRobots(
  url: string,
  fetchPageHtmlImpl: typeof fetchPageHtml = fetchPageHtml
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const robotsText = await fetchRobotsText(
    parsed.hostname,
    fetchPageHtmlImpl
  );
  if (!robotsText) return true;
  return isRobotsPathAllowed(
    robotsText,
    `${parsed.pathname}${parsed.search}`
  );
}

// ---------------------------------------------------------------------------
// Single-watch scan (also used by the manual "check now" route)
// ---------------------------------------------------------------------------

export interface CompetitorWatchCheckResult {
  changed: boolean;
  /** Set on the very first successful check (baseline established). */
  baseline?: boolean;
  changeId?: string;
  diff?: CompetitorDiff;
  alertCreated?: boolean;
  skippedByRobots?: boolean;
  fetchFailed?: boolean;
}

async function touchChecked(
  prisma: PrismaClient,
  watchId: string
): Promise<void> {
  await prisma.competitorWatch.update({
    where: { id: watchId },
    data: { lastCheckedAt: new Date() },
  });
}

/** Rebuild the previous snapshot from the latest change row's `after` values. */
async function getPreviousSnapshot(
  prisma: PrismaClient,
  watchId: string
): Promise<CompetitorSnapshot | null> {
  const last = (await prisma.competitorChange.findFirst({
    where: { watchId },
    orderBy: { changedAt: "desc" },
  })) as { diffSummary?: unknown } | null;
  if (!last) return null;
  const d = (last.diffSummary ?? {}) as CompetitorDiff;
  if (!d.title || !d.price || !d.cta) return null;
  return {
    title: d.title.after ?? "",
    price: d.price.after ?? [],
    cta: d.cta.after ?? [],
    // Full previous section list is not persisted; section added/removed
    // can only be computed once a baseline change row exists with known
    // `after` sections — approximated below via the latest diff.
    sections: [
      ...(d.sectionsAdded ?? []),
    ],
  };
}

function buildAlertMessage(name: string, diff: CompetitorDiff): string {
  const parts: string[] = [];
  if (diff.title) parts.push("标题");
  if (diff.price) parts.push("价格");
  if (diff.cta) parts.push("行动号召");
  if (diff.sectionsAdded?.length || diff.sectionsRemoved?.length) {
    parts.push("页面板块");
  }
  const what = parts.length > 0 ? `（${parts.join("、")}）` : "";
  return `竞品监控「${name}」检测到落地页变化${what}，请查看变更时间线。`;
}

/** Create the competitor_change alert unless one is open within 24h. */
async function maybeCreateChangeAlert(
  prisma: PrismaClient,
  watch: WatchRow,
  changeId: string,
  diff: CompetitorDiff,
  log: CompetitorWatchLog
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
  const openAlerts = (await prisma.alert.findMany({
    where: {
      tenantId: watch.tenantId,
      ruleId: null,
      metric: ALERT_METRIC,
      status: "open",
      createdAt: { gt: since },
    },
    select: { id: true, data: true },
  })) as Array<{ id: string; data: unknown }>;
  const dup = openAlerts.some(
    (a) =>
      typeof a.data === "object" &&
      a.data !== null &&
      (a.data as { watchId?: unknown }).watchId === watch.id
  );
  if (dup) {
    log.info("competitor-watch alert deduped (24h)", {
      watchId: watch.id,
      tenantId: watch.tenantId,
    });
    return false;
  }
  await prisma.alert.create({
    data: {
      id: randomUUID(),
      tenantId: watch.tenantId,
      ruleId: null,
      metric: ALERT_METRIC,
      severity: "medium",
      message: buildAlertMessage(watch.name, diff),
      // Deep-clone to plain JSON for the Prisma Json field.
      data: JSON.parse(JSON.stringify({ watchId: watch.id, changeId })),
      status: "open",
    },
  });
  return true;
}

/**
 * Scan one watch: robots gate → SSRF-safe fetch → extract → hash compare.
 * Never throws: fetch failures and robots denials only touch lastCheckedAt.
 */
export async function checkCompetitorWatch(
  prisma: PrismaClient,
  watch: WatchRow,
  opts: {
    fetchPageHtmlImpl?: typeof fetchPageHtml;
    log?: CompetitorWatchLog;
  } = {}
): Promise<CompetitorWatchCheckResult> {
  const fetchImpl = opts.fetchPageHtmlImpl ?? fetchPageHtml;
  const log: CompetitorWatchLog =
    opts.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[competitor-watch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[competitor-watch] ${msg}`, meta ?? ""),
    } as CompetitorWatchLog);

  // 1. robots.txt gate (missing/unreadable → allowed).
  if (!(await isFetchAllowedByRobots(watch.url, fetchImpl))) {
    log.info("competitor-watch skipped: robots.txt disallows path", {
      watchId: watch.id,
    });
    await touchChecked(prisma, watch.id);
    return { changed: false, skippedByRobots: true };
  }

  // 2. Fetch (SSRF-safe). Failures must not throw — no retry storm.
  let html: string;
  try {
    const page = await fetchImpl(watch.url);
    html = page.html;
  } catch (error) {
    log.error("competitor-watch fetch failed", {
      watchId: watch.id,
      tenantId: watch.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    await touchChecked(prisma, watch.id);
    return { changed: false, fetchFailed: true };
  }

  // 3. Extract + hash.
  const snapshot = extractCompetitorFields(html);
  const hash = hashCompetitorSnapshot(snapshot);
  const now = new Date();

  if (!watch.lastHash) {
    await prisma.competitorWatch.update({
      where: { id: watch.id },
      data: { lastHash: hash, lastCheckedAt: now },
    });
    log.info("competitor-watch baseline established", {
      watchId: watch.id,
      tenantId: watch.tenantId,
    });
    return { changed: false, baseline: true };
  }

  if (hash === watch.lastHash) {
    await touchChecked(prisma, watch.id);
    return { changed: false };
  }

  // 4. Changed → diff, change row, alert (24h dedup), refresh hash.
  const before = await getPreviousSnapshot(prisma, watch.id);
  const diff = diffCompetitorSnapshots(before, snapshot);
  if (diffIsEmpty(diff)) {
    // Defensive: hash moved but no field diff (should not happen).
    await prisma.competitorWatch.update({
      where: { id: watch.id },
      data: { lastHash: hash, lastCheckedAt: now },
    });
    return { changed: false };
  }
  const change = await prisma.competitorChange.create({
    data: {
      id: randomUUID(),
      tenantId: watch.tenantId,
      watchId: watch.id,
      changedAt: now,
      diffSummary: JSON.parse(JSON.stringify(diff)),
    },
  });
  await prisma.competitorWatch.update({
    where: { id: watch.id },
    data: { lastHash: hash, lastCheckedAt: now },
  });
  const alertCreated = await maybeCreateChangeAlert(
    prisma,
    watch,
    change.id as string,
    diff,
    log
  );
  log.info("competitor-watch change detected", {
    watchId: watch.id,
    tenantId: watch.tenantId,
    changeId: change.id,
    alertCreated,
  });
  return {
    changed: true,
    changeId: change.id as string,
    diff,
    alertCreated,
  };
}

// ---------------------------------------------------------------------------
// Worker entry (BullMQ calls this on the hourly repeatable schedule)
// ---------------------------------------------------------------------------

export interface CompetitorWatchScanSummary {
  checked: number;
  changed: number;
  alertsCreated: number;
  skippedByRobots: number;
  fetchFailed: number;
}

export async function processCompetitorWatchJob(input: {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  fetchPageHtmlImpl?: typeof fetchPageHtml;
  log?: CompetitorWatchLog;
}): Promise<CompetitorWatchScanSummary> {
  const log: CompetitorWatchLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[competitor-watch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[competitor-watch] ${msg}`, meta ?? ""),
    } as CompetitorWatchLog);

  const now = new Date();
  const watches = (await input.prisma.competitorWatch.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    },
    orderBy: { createdAt: "asc" },
  })) as WatchRow[];

  const due = watches.filter((w) => {
    // Hard floor: never scan more often than once per hour.
    const intervalMs =
      Math.max(COMPETITOR_WATCH_MIN_INTERVAL_S, w.checkInterval) * 1000;
    return (
      !w.lastCheckedAt ||
      now.getTime() - new Date(w.lastCheckedAt).getTime() >= intervalMs
    );
  });

  const summary: CompetitorWatchScanSummary = {
    checked: 0,
    changed: 0,
    alertsCreated: 0,
    skippedByRobots: 0,
    fetchFailed: 0,
  };

  for (const watch of due) {
    try {
      const result = await checkCompetitorWatch(input.prisma, watch, {
        fetchPageHtmlImpl: input.fetchPageHtmlImpl,
        log,
      });
      summary.checked += 1;
      if (result.changed) summary.changed += 1;
      if (result.alertCreated) summary.alertsCreated += 1;
      if (result.skippedByRobots) summary.skippedByRobots += 1;
      if (result.fetchFailed) summary.fetchFailed += 1;
    } catch (error) {
      // Never throw: one bad watch must not wedge the hourly run.
      log.error("competitor-watch scan failed", {
        watchId: watch.id,
        tenantId: watch.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await touchChecked(input.prisma, watch.id);
      } catch {
        /* best effort */
      }
    }
  }

  log.info("competitor-watch scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}
