/**
 * Feature 5 — 返利比价（rate-compare）核心逻辑：抓取 + 解析 + 比对 + 建议告警。
 *
 * NOTE on storage: the two tables (`cashback_compare_groups`,
 * `cashback_rate_snapshots`) are NOT yet in the Prisma schema — they are
 * documented in /tmp/rate-compare-models.prisma.txt and created by
 * /tmp/rate-compare-migration.sql. Until the schema/migration window opens,
 * every access to them goes through `$queryRaw` / `$executeRaw` (raw SQL),
 * so the Prisma client needs no regeneration. Column names mirror the
 * `@@map`/`@map` mappings of the models.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import { fetchPageHtml, type FetchedHtmlPage } from "../ai/fetch-page.js";

/**
 * Reused rate-extraction regex: the first percentage found on the page is
 * treated as the portal's cashback rate (e.g. "8%", "8.5%").
 */
export const RATE_RE = /(\d+(?:\.\d+)?)\s*%/;

/** Alert metric stored in Alert.metric for "better deal elsewhere" tips. */
export const CASHBACK_RATE_BETTER_DEAL_METRIC = "cashback_rate_better_deal";

/** 24h dedupe window per compare group. */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

/**
 * Switch-suggestion threshold: alert only when the best non-primary portal
 * beats the primary (portals[0]) by at least this many percentage points.
 */
export const RATE_SWITCH_THRESHOLD_PP = 1;

export interface RateComparePortal {
  name: string;
  url: string;
}

export interface CompareGroupRow {
  id: string;
  tenantId: string;
  name: string;
  merchantDomain: string;
  portals: RateComparePortal[];
  createdAt: Date;
}

export interface RateSnapshotRow {
  id: string;
  tenantId: string;
  merchantDomain: string;
  portal: string;
  /** Raw rate string as found on the page (e.g. "8.5%"); null when unfetchable/unparseable. */
  rate: string | null;
  url: string | null;
  checkedAt: Date;
  /** Numeric percent parsed from `rate`; null when parse fails (excluded from best-of). */
  rateValue: number | null;
}

export interface PortalCheckResult {
  portal: string;
  url: string;
  rate: string | null;
  rateValue: number | null;
  ok: boolean;
}

export interface GroupCheckResult {
  groupId: string;
  merchantDomain: string;
  checkedAt: Date;
  results: PortalCheckResult[];
  bestPortal: string | null;
  bestRate: string | null;
  bestRateValue: number | null;
  alertCreated: boolean;
}

export interface RateCompareLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Injectable page fetcher — defaults to the SSRF-safe fetchPageHtml. */
export type FetchPageFn = (rawUrl: string) => Promise<FetchedHtmlPage>;

/**
 * Parse a rate string like "8%" or "8.5%" into a number.
 * Returns null when no percentage can be parsed — the portal is then
 * excluded from the best-rate competition.
 */
export function parseRateNumber(rate: string | null | undefined): number | null {
  if (typeof rate !== "string") return null;
  const m = RATE_RE.exec(rate);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Extract the cashback rate from a page's text (falls back to raw HTML).
 * Returns the raw matched string (e.g. "8.5%") or null when absent.
 */
export function extractRateFromPage(page: {
  text?: string | null;
  html?: string | null;
}): string | null {
  const haystack = page.text ?? "";
  const m = RATE_RE.exec(haystack);
  if (m) return m[0];
  const html = page.html ?? "";
  const m2 = RATE_RE.exec(html);
  return m2 ? m2[0] : null;
}

/** Fetch one portal's page (SSRF-safe) and extract its rate. Never throws. */
export async function fetchPortalRate(
  url: string,
  fetchPage: FetchPageFn,
  log?: RateCompareLog
): Promise<{ rate: string | null; rateValue: number | null }> {
  try {
    const page = await fetchPage(url);
    const rate = extractRateFromPage(page);
    return { rate, rateValue: parseRateNumber(rate) };
  } catch (error) {
    log?.info("rate-compare portal fetch failed; recorded as null", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { rate: null, rateValue: null };
  }
}

// ---------------------------------------------------------------------------
// Raw-SQL access (new tables not yet in the Prisma client)
// ---------------------------------------------------------------------------

function asPortalArray(v: unknown): RateComparePortal[] {
  const raw = typeof v === "string" ? JSON.parse(v) : v;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is RateComparePortal =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as { name?: unknown }).name === "string" &&
        typeof (p as { url?: unknown }).url === "string"
    )
    .map((p) => ({
      name: (p as RateComparePortal).name,
      url: (p as RateComparePortal).url,
    }));
}

interface GroupSqlRow {
  id: string;
  tenantId: string;
  name: string;
  merchantDomain: string;
  portals: unknown;
  createdAt: Date;
}

function rowToGroup(r: GroupSqlRow): CompareGroupRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    merchantDomain: r.merchantDomain,
    portals: asPortalArray(r.portals),
    createdAt: r.createdAt,
  };
}

export async function listGroups(
  prisma: PrismaClient,
  tenantId: string
): Promise<CompareGroupRow[]> {
  const rows = await prisma.$queryRaw<GroupSqlRow[]>`
    SELECT id, tenant_id AS "tenantId", name,
           merchant_domain AS "merchantDomain", portals,
           created_at AS "createdAt"
    FROM cashback_compare_groups
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC`;
  return rows.map(rowToGroup);
}

export async function getGroup(
  prisma: PrismaClient,
  tenantId: string,
  groupId: string
): Promise<CompareGroupRow> {
  const rows = await prisma.$queryRaw<GroupSqlRow[]>`
    SELECT id, tenant_id AS "tenantId", name,
           merchant_domain AS "merchantDomain", portals,
           created_at AS "createdAt"
    FROM cashback_compare_groups
    WHERE tenant_id = ${tenantId} AND id = ${groupId}`;
  if (rows.length === 0) {
    throw new NotFoundError("Compare group not found");
  }
  return rowToGroup(rows[0]);
}

export function validateGroupInput(input: {
  name?: unknown;
  merchantDomain?: unknown;
  portals?: unknown;
}): { name: string; merchantDomain: string; portals: RateComparePortal[] } {
  const name =
    typeof input.name === "string" && input.name.trim() ? input.name.trim() : "";
  const merchantDomain =
    typeof input.merchantDomain === "string" && input.merchantDomain.trim()
      ? input.merchantDomain.trim().toLowerCase()
      : "";
  if (!name) throw new ValidationError("name is required");
  if (!merchantDomain) throw new ValidationError("merchantDomain is required");
  if (!Array.isArray(input.portals) || input.portals.length === 0) {
    throw new ValidationError("portals must be a non-empty array");
  }
  const portals = (input.portals as Array<unknown>).map((p, i) => {
    const nm =
      typeof (p as { name?: unknown }).name === "string"
        ? ((p as { name?: string }).name as string).trim()
        : "";
    const url =
      typeof (p as { url?: unknown }).url === "string"
        ? ((p as { url?: string }).url as string).trim()
        : "";
    if (!nm || !url) {
      throw new ValidationError(`portals[${i}].name and portals[${i}].url are required`);
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new ValidationError(`portals[${i}].url must be http(s)`);
    }
    return { name: nm, url };
  });
  return { name, merchantDomain, portals };
}

export async function createGroup(
  prisma: PrismaClient,
  tenantId: string,
  input: { name: string; merchantDomain: string; portals: RateComparePortal[] }
): Promise<CompareGroupRow> {
  const id = randomUUID();
  const createdAt = new Date();
  await prisma.$executeRaw`
    INSERT INTO cashback_compare_groups
      (id, tenant_id, name, merchant_domain, portals, created_at)
    VALUES (${id}, ${tenantId}, ${input.name}, ${input.merchantDomain},
            ${JSON.stringify(input.portals)}::jsonb, ${createdAt})`;
  return {
    id,
    tenantId,
    name: input.name,
    merchantDomain: input.merchantDomain,
    portals: input.portals,
    createdAt,
  };
}

interface SnapshotSqlRow {
  id: string;
  tenantId: string;
  merchantDomain: string;
  portal: string;
  rate: string | null;
  url: string | null;
  checkedAt: Date;
}

function rowToSnapshot(r: SnapshotSqlRow): RateSnapshotRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    merchantDomain: r.merchantDomain,
    portal: r.portal,
    rate: r.rate,
    url: r.url,
    checkedAt: r.checkedAt,
    rateValue: parseRateNumber(r.rate),
  };
}

/** Latest snapshot per portal plus recent history for a group. */
export async function getGroupSnapshots(
  prisma: PrismaClient,
  tenantId: string,
  group: CompareGroupRow,
  limit = 200
): Promise<{ latest: RateSnapshotRow[]; snapshots: RateSnapshotRow[] }> {
  const rows = await prisma.$queryRaw<SnapshotSqlRow[]>`
    SELECT id, tenant_id AS "tenantId", merchant_domain AS "merchantDomain",
           portal, rate, url, checked_at AS "checkedAt"
    FROM cashback_rate_snapshots
    WHERE tenant_id = ${tenantId} AND merchant_domain = ${group.merchantDomain}
    ORDER BY checked_at DESC
    LIMIT ${limit}`;
  const snapshots = rows.map(rowToSnapshot);
  const latestByPortal = new Map<string, RateSnapshotRow>();
  for (const s of snapshots) {
    if (!latestByPortal.has(s.portal)) latestByPortal.set(s.portal, s);
  }
  // Keep the group's portal order for a stable comparison table.
  const order = new Map(group.portals.map((p, i) => [p.name, i]));
  const latest = [...latestByPortal.values()].sort(
    (a, b) =>
      (order.get(a.portal) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.portal) ?? Number.MAX_SAFE_INTEGER)
  );
  return { latest, snapshots };
}

// ---------------------------------------------------------------------------
// Comparison + suggestion alert
// ---------------------------------------------------------------------------

/**
 * Persist one snapshot row per portal for this check run.
 * Portals that failed to fetch/parse are recorded with rate = null.
 */
export async function writeSnapshots(
  prisma: PrismaClient,
  tenantId: string,
  merchantDomain: string,
  results: PortalCheckResult[],
  checkedAt: Date
): Promise<void> {
  for (const r of results) {
    await prisma.$executeRaw`
      INSERT INTO cashback_rate_snapshots
        (id, tenant_id, merchant_domain, portal, rate, url, checked_at)
      VALUES (${randomUUID()}, ${tenantId}, ${merchantDomain},
              ${r.portal}, ${r.rate}, ${r.url}, ${checkedAt})`;
  }
}

/** Pick the highest-rate portal among parseable results. */
export function pickBest(results: PortalCheckResult[]): PortalCheckResult | null {
  let best: PortalCheckResult | null = null;
  for (const r of results) {
    if (r.rateValue == null) continue;
    if (best == null || r.rateValue > (best.rateValue ?? -Infinity)) best = r;
  }
  return best;
}

function buildSuggestionMessage(
  merchantDomain: string,
  portal: string,
  rate: string,
  diffPp: number
): string {
  return `${merchantDomain} 在 ${portal} 的返利为 ${rate}，比当前主推高 ${diffPp.toFixed(1)} 个百分点，可考虑切换`;
}

/**
 * Raise the "better deal" suggestion alert unless an open one exists for
 * this group within 24h. Severity is "info" — this is a tip, not a fault.
 */
export async function maybeCreateBetterDealAlert(
  prisma: PrismaClient,
  tenantId: string,
  group: CompareGroupRow,
  best: PortalCheckResult,
  primary: PortalCheckResult,
  diffPp: number,
  log?: RateCompareLog
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
  const openAlerts = (await prisma.alert.findMany({
    where: {
      tenantId,
      metric: CASHBACK_RATE_BETTER_DEAL_METRIC,
      status: "open",
      createdAt: { gt: since },
    },
    select: { id: true, data: true },
  })) as Array<{ id: string; data: unknown }>;
  const dup = openAlerts.some(
    (a) =>
      typeof a.data === "object" &&
      a.data !== null &&
      (a.data as { groupId?: unknown }).groupId === group.id
  );
  if (dup) {
    log?.info("rate-compare alert deduped (24h)", {
      groupId: group.id,
      tenantId,
    });
    return false;
  }
  await prisma.alert.create({
    data: {
      id: randomUUID(),
      tenantId,
      ruleId: null,
      metric: CASHBACK_RATE_BETTER_DEAL_METRIC,
      severity: "info",
      message: buildSuggestionMessage(
        group.merchantDomain,
        best.portal,
        best.rate ?? "",
        diffPp
      ),
      data: JSON.parse(
        JSON.stringify({
          groupId: group.id,
          merchantDomain: group.merchantDomain,
          portal: best.portal,
          rate: best.rate,
          rateValue: best.rateValue,
          primaryPortal: primary.portal,
          primaryRate: primary.rate,
          primaryRateValue: primary.rateValue,
          diff: Math.round(diffPp * 10) / 10,
        })
      ),
      status: "open",
    },
  });
  return true;
}

/**
 * Run a full comparison for one group: fetch every portal's rate (one
 * failure never blocks the others), write snapshots, compute the best,
 * and raise a suggestion alert when the best non-primary portal beats the
 * primary (portals[0]) by >= RATE_SWITCH_THRESHOLD_PP percentage points.
 * Never throws for per-portal failures; unexpected errors propagate to the
 * worker, which swallows them.
 */
export async function runGroupCheck(
  prisma: PrismaClient,
  tenantId: string,
  group: CompareGroupRow,
  opts: { fetchPage?: FetchPageFn; log?: RateCompareLog } = {}
): Promise<GroupCheckResult> {
  const fetchPage = opts.fetchPage ?? fetchPageHtml;
  const log = opts.log;
  const checkedAt = new Date();

  const results: PortalCheckResult[] = [];
  for (const portal of group.portals) {
    const { rate, rateValue } = await fetchPortalRate(portal.url, fetchPage, log);
    results.push({
      portal: portal.name,
      url: portal.url,
      rate,
      rateValue,
      ok: rateValue != null,
    });
  }

  await writeSnapshots(prisma, tenantId, group.merchantDomain, results, checkedAt);

  const best = pickBest(results);
  const primaryName = group.portals[0]?.name;
  const primary = results.find((r) => r.portal === primaryName) ?? null;
  let alertCreated = false;
  if (
    best &&
    primary &&
    best.portal !== primary.portal &&
    best.rateValue != null &&
    primary.rateValue != null
  ) {
    const diffPp = best.rateValue - primary.rateValue;
    if (diffPp >= RATE_SWITCH_THRESHOLD_PP) {
      alertCreated = await maybeCreateBetterDealAlert(
        prisma,
        tenantId,
        group,
        best,
        primary,
        diffPp,
        log
      );
    }
  }

  return {
    groupId: group.id,
    merchantDomain: group.merchantDomain,
    checkedAt,
    results,
    bestPortal: best?.portal ?? null,
    bestRate: best?.rate ?? null,
    bestRateValue: best?.rateValue ?? null,
    alertCreated,
  };
}

/**
 * Check every group (all tenants, or one tenant when given).
 * Returns per-group results; never throws for per-group failures.
 */
export async function runAllGroups(
  prisma: PrismaClient,
  opts: { fetchPage?: FetchPageFn; tenantId?: string; log?: RateCompareLog } = {}
): Promise<{ groups: number; checked: number; alertsCreated: number }> {
  const log = opts.log;
  const rows = opts.tenantId
    ? await prisma.$queryRaw<GroupSqlRow[]>`
        SELECT id, tenant_id AS "tenantId", name,
               merchant_domain AS "merchantDomain", portals,
               created_at AS "createdAt"
        FROM cashback_compare_groups
        WHERE tenant_id = ${opts.tenantId}
        ORDER BY created_at DESC`
    : await prisma.$queryRaw<GroupSqlRow[]>`
        SELECT id, tenant_id AS "tenantId", name,
               merchant_domain AS "merchantDomain", portals,
               created_at AS "createdAt"
        FROM cashback_compare_groups
        ORDER BY created_at DESC`;
  const groups = rows.map(rowToGroup);
  let alertsCreated = 0;
  let checked = 0;
  for (const group of groups) {
    try {
      const result = await runGroupCheck(prisma, group.tenantId, group, opts);
      checked += 1;
      if (result.alertCreated) alertsCreated += 1;
    } catch (error) {
      log?.error("rate-compare group check failed; skipped", {
        groupId: group.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { groups: groups.length, checked, alertsCreated };
}
