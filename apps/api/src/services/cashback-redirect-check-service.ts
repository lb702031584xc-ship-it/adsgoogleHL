/**
 * Feature 4 — 跳转链检测（redirect-check）: business logic.
 *
 * - followRedirectChain: SSRF-safe manual redirect following (max 10 hops,
 *   10s per-hop timeout, per-hop DNS + isBlockedIp check from
 *   ai/fetch-page.ts). Injectable fetch/resolveHost so unit tests run with
 *   zero network access.
 * - checkRedirectChain: follow + final-domain comparison against the
 *   expected destination domain → issues + status (ok|warning|error).
 * - checkAllRedirectChains: scan every ACTIVE TrackingLink (tenant-isolated),
 *   write a RedirectChainCheck row per link, and raise a
 *   `redirect_chain_issue` alert (severity warning, 24h dedupe per link)
 *   whenever issues are non-empty. Per-link failures never throw.
 * - getRedirectCheckHistory: paginated check history (tenant-isolated).
 *
 * Prisma note: the RedirectChainCheck model (table redirect_chain_checks) is
 * added by the parent orchestrator's migration step, so it is not in the
 * generated client yet. Access goes through the small `chainCheck()` cast
 * below; once the model is generated, the cast resolves to the real
 * delegate without code changes.
 *
 * Issue codes (stored in `issues` JSONB string array):
 *   too_many_hops        — hopCount > 5
 *   redirect_loop         — the same URL appeared twice in the chain
 *   final_domain_mismatch — final hop domain != destination domain
 *   hop_failed            — timeout / DNS / network / HTTP 4xx/5xx on a hop
 *   target_blocked        — hop target blocked by the SSRF guard
 */
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { PrismaClient } from "@adlinklab/database";
import { isBlockedIp } from "../ai/fetch-page.js";

/** Alert metric for redirect-chain problems (severity: warning). */
export const REDIRECT_CHECK_ALERT_METRIC = "redirect_chain_issue";

/** Hard cap on followed hops. */
export const MAX_HOPS = 10;
/** Chains longer than this are flagged. */
export const FLAG_HOPS = 5;
/** Per-hop request timeout (ms). */
export const HOP_TIMEOUT_MS = 10_000;

/** Alert dedupe window: one redirect_chain_issue alert per link per 24h. */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

/** Check status: ok = clean chain, warning = flagged issues, error = could not check at all. */
export type RedirectCheckStatus = "ok" | "warning" | "error";

export interface RedirectHop {
  url: string;
  domain: string;
  /** null when the hop produced no HTTP response (timeout/blocked/dns). */
  statusCode: number | null;
}

export interface RedirectChainResult {
  hops: RedirectHop[];
  issues: string[];
  status: RedirectCheckStatus;
  finalUrl: string | null;
}

export interface FollowRedirectChainOpts {
  /** Injectable fetch for tests (no network). Defaults to global fetch. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  /** Injectable DNS resolution for tests. Defaults to dns.lookup (all). */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** Per-hop timeout in ms. Defaults to HOP_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Max hops to follow. Defaults to MAX_HOPS. */
  maxHops?: number;
}

export interface CheckRedirectChainOpts extends FollowRedirectChainOpts {
  /**
   * Expected final domain (hostname, lowercased). When provided and the
   * chain resolves, a mismatch against the final hop's domain is flagged
   * as `final_domain_mismatch`.
   */
  expectedDomain?: string;
}

export interface RedirectCheckScanOpts extends FollowRedirectChainOpts {
  /** Injectable chain evaluation for tests. */
  checkImpl?: (
    url: string,
    opts: CheckRedirectChainOpts
  ) => Promise<RedirectChainResult>;
}

export interface RedirectCheckScanSummary {
  checked: number;
  clean: number;
  warning: number;
  error: number;
  alertsCreated: number;
  /** Links skipped because no destination URL could be resolved. */
  skippedNoUrl: number;
}

const ISSUE_LABELS_ZH: Record<string, string> = {
  too_many_hops: "跳转次数过多（>5 跳）",
  redirect_loop: "存在循环重定向",
  final_domain_mismatch: "最终域名与目标域名不一致",
  hop_failed: "某跳请求失败（超时/4xx/5xx）",
  target_blocked: "跳转目标被安全策略拦截（SSRF 防护）",
};

// ---------------------------------------------------------------------------
// Prisma delegate (RedirectChainCheck is added by the parent migration step)
// ---------------------------------------------------------------------------

interface RedirectChainCheckRow {
  id: string;
  tenantId: string;
  trackingLinkId: string;
  hopCount: number;
  hops: unknown;
  issues: unknown;
  checkedAt: Date;
  status: string;
}

interface RedirectChainCheckDelegate {
  create(args: {
    data: {
      id: string;
      tenantId: string;
      trackingLinkId: string;
      hopCount: number;
      hops: unknown;
      issues: unknown;
      checkedAt: Date;
      status: string;
    };
  }): Promise<RedirectChainCheckRow>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string>;
    skip?: number;
    take?: number;
  }): Promise<RedirectChainCheckRow[]>;
}

function chainCheck(prisma: PrismaClient): RedirectChainCheckDelegate {
  return (prisma as unknown as { redirectChainCheck: RedirectChainCheckDelegate })
    .redirectChainCheck;
}

// ---------------------------------------------------------------------------
// SSRF-safe manual redirect following
// ---------------------------------------------------------------------------

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const addrs = await lookup(hostname, { all: true });
  return addrs.map((a) => a.address);
}

function bareHostname(rawHostname: string): string {
  // WHATWG URL keeps IPv6 brackets: http://[::1]/ → hostname "[::1]".
  return rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;
}

type HopOutcome =
  | { ok: true; statusCode: number; location: string | null }
  | { ok: false; failure: "timeout" | "blocked" | "dns" | "network" };

/**
 * Fetch a single hop. NEVER follows redirects automatically — the caller
 * resolves the Location header and re-validates the next hop (DNS +
 * isBlockedIp) before touching it, so a redirect to an internal address
 * cannot bypass the SSRF guard.
 */
async function fetchSingleHop(
  url: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  resolveHost: (hostname: string) => Promise<string[]>,
  timeoutMs: number
): Promise<HopOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, failure: "network" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, failure: "blocked" };
  }

  // Per-hop DNS + SSRF check (covers literal IPs too — lookup resolves them).
  let addresses: string[];
  try {
    addresses = await resolveHost(bareHostname(parsed.hostname));
  } catch {
    return { ok: false, failure: "dns" };
  }
  if (addresses.length === 0) return { ok: false, failure: "dns" };
  if (addresses.some((a) => isBlockedIp(a))) {
    return { ok: false, failure: "blocked" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const statusCode = res.status;
    const location = res.headers.get("location");
    // We never read bodies — cancel to free the socket promptly.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return { ok: true, statusCode, location };
  } catch {
    return {
      ok: false,
      failure: controller.signal.aborted ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

interface FollowedChain {
  hops: RedirectHop[];
  issues: string[];
  finalUrl: string | null;
}

/**
 * Follow a redirect chain manually (never auto-follow). Records every hop's
 * URL, domain and status code; flags too_many_hops / redirect_loop /
 * hop_failed / target_blocked. Does NOT compare domains — that is done by
 * checkRedirectChain, which knows the expected destination domain.
 */
export async function followRedirectChain(
  startUrl: string,
  opts: FollowRedirectChainOpts = {}
): Promise<FollowedChain> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const resolveHost = opts.resolveHost ?? defaultResolveHost;
  const timeoutMs = opts.timeoutMs ?? HOP_TIMEOUT_MS;
  const maxHops = opts.maxHops ?? MAX_HOPS;

  const hops: RedirectHop[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  let current = startUrl;
  let finalUrl: string | null = null;

  for (let i = 0; i < maxHops; i++) {
    let normalized: string;
    let domain: string;
    try {
      normalized = new URL(current).href;
      domain = new URL(normalized).hostname.toLowerCase();
    } catch {
      issues.push("hop_failed");
      break;
    }

    const outcome = await fetchSingleHop(
      normalized,
      fetchImpl,
      resolveHost,
      timeoutMs
    );
    if (!outcome.ok) {
      hops.push({ url: normalized, domain, statusCode: null });
      issues.push(outcome.failure === "blocked" ? "target_blocked" : "hop_failed");
      break;
    }

    const { statusCode, location } = outcome;
    hops.push({ url: normalized, domain, statusCode });
    seen.add(normalized);

    if (statusCode >= 300 && statusCode < 400 && location) {
      let next: string;
      try {
        next = new URL(location, normalized).href;
      } catch {
        issues.push("hop_failed");
        break;
      }
      if (seen.has(next)) {
        issues.push("redirect_loop");
        break;
      }
      current = next;
      continue;
    }
    if (statusCode >= 400) {
      issues.push("hop_failed");
      break;
    }
    // 2xx (or other terminal response): chain resolved.
    finalUrl = normalized;
    break;
  }

  if (hops.length > FLAG_HOPS && !issues.includes("too_many_hops")) {
    issues.push("too_many_hops");
  }

  return { hops, issues, finalUrl };
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Full evaluation: follow the chain, then compare the final hop domain
 * against the expected destination domain (strict hostname equality).
 * status: error = first hop produced no response at all; warning = issues
 * non-empty; ok = clean chain.
 */
export async function checkRedirectChain(
  startUrl: string,
  opts: CheckRedirectChainOpts = {}
): Promise<RedirectChainResult> {
  const { expectedDomain, ...followOpts } = opts;
  const { hops, issues, finalUrl } = await followRedirectChain(
    startUrl,
    followOpts
  );

  if (expectedDomain && finalUrl) {
    const finalDomain = domainOf(finalUrl);
    if (finalDomain && finalDomain !== expectedDomain.toLowerCase()) {
      issues.push("final_domain_mismatch");
    }
  }

  const firstHopFailed = hops.length === 0 || hops[0]?.statusCode == null;
  const status: RedirectCheckStatus = firstHopFailed
    ? "error"
    : issues.length > 0
      ? "warning"
      : "ok";

  return { hops, issues, status, finalUrl };
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

interface ScanLinkRow {
  id: string;
  tenantId: string;
  publicId: string;
  offer: { name: string; destinationUrl: string } | null;
  landingPage: { name: string; url: string } | null;
}

function resolveDestinationUrl(link: ScanLinkRow): string | null {
  return link.landingPage?.url ?? link.offer?.destinationUrl ?? null;
}

function linkDisplayName(link: ScanLinkRow): string {
  return link.landingPage?.name ?? link.offer?.name ?? link.publicId;
}

function issueSummaryZh(issues: string[]): string {
  return issues.map((i) => ISSUE_LABELS_ZH[i] ?? i).join("；");
}

/**
 * Create the redirect_chain_issue alert unless one was created for this
 * link in the last 24h. Never throws.
 */
async function maybeCreateRedirectChainAlert(
  prisma: PrismaClient,
  link: ScanLinkRow,
  result: RedirectChainResult
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
    const existing = await prisma.alert.findMany({
      where: {
        tenantId: link.tenantId,
        metric: REDIRECT_CHECK_ALERT_METRIC,
        trackingLinkId: link.id,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing.length > 0) return false;

    await prisma.alert.create({
      data: {
        id: randomUUID(),
        tenantId: link.tenantId,
        ruleId: null,
        trackingLinkId: link.id,
        metric: REDIRECT_CHECK_ALERT_METRIC,
        severity: "warning",
        message: `跳转链告警：跟踪链接「${linkDisplayName(link)}」（${link.publicId}）跳转链存在问题：${issueSummaryZh(result.issues)}。共 ${result.hops.length} 跳。`,
        data: JSON.parse(
          JSON.stringify({
            entityType: "TrackingLink",
            entityId: link.id,
            issues: result.issues,
            hopCount: result.hops.length,
            finalUrl: result.finalUrl,
            hops: result.hops,
          })
        ),
        status: "open",
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check the redirect chain of every ACTIVE tracking link for the tenant
 * (or all tenants when `tenantId` is omitted). Writes one
 * RedirectChainCheck row per link. Never throws: one bad link must not
 * wedge the daily run — per-link failures are swallowed after logging.
 */
export async function checkAllRedirectChains(
  prisma: PrismaClient,
  tenantId?: string,
  opts: RedirectCheckScanOpts = {}
): Promise<RedirectCheckScanSummary> {
  const check = opts.checkImpl ?? checkRedirectChain;
  const { checkImpl: _ignored, ...followOpts } = opts;
  const summary: RedirectCheckScanSummary = {
    checked: 0,
    clean: 0,
    warning: 0,
    error: 0,
    alertsCreated: 0,
    skippedNoUrl: 0,
  };

  const links = (await prisma.trackingLink.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      publicId: true,
      offer: { select: { name: true, destinationUrl: true } },
      landingPage: { select: { name: true, url: true } },
    },
    orderBy: { createdAt: "asc" },
  })) as ScanLinkRow[];

  for (const link of links) {
    try {
      const url = resolveDestinationUrl(link);
      if (!url) {
        summary.skippedNoUrl += 1;
        continue;
      }
      const expectedDomain = domainOf(url);
      if (!expectedDomain) {
        summary.skippedNoUrl += 1;
        continue;
      }

      const result = await check(url, { expectedDomain, ...followOpts });

      await chainCheck(prisma).create({
        data: {
          id: randomUUID(),
          tenantId: link.tenantId,
          trackingLinkId: link.id,
          hopCount: result.hops.length,
          hops: result.hops,
          issues: result.issues,
          checkedAt: new Date(),
          status: result.status,
        },
      });

      summary.checked += 1;
      if (result.status === "ok") {
        summary.clean += 1;
      } else {
        summary[result.status] += 1;
      }

      if (
        result.issues.length > 0 &&
        (await maybeCreateRedirectChainAlert(prisma, link, result))
      ) {
        summary.alertsCreated += 1;
      }
    } catch (error) {
      // Never throw: one bad link must not wedge the daily run.
      console.error("[redirect-check] scan failed for link", {
        linkId: link.id,
        tenantId: link.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface RedirectCheckHistoryQuery {
  trackingLinkId?: string;
  page?: number;
  pageSize?: number;
}

export interface RedirectCheckHistoryRow {
  id: string;
  trackingLinkId: string;
  hopCount: number;
  hops: RedirectHop[];
  issues: string[];
  checkedAt: Date;
  status: string;
  linkName: string | null;
  linkPublicId: string | null;
}

export interface RedirectCheckHistoryResult {
  total: number;
  page: number;
  pageSize: number;
  rows: RedirectCheckHistoryRow[];
}

/** Paginated check history, tenant-isolated, newest first. */
export async function getRedirectCheckHistory(
  prisma: PrismaClient,
  tenantId: string,
  query: RedirectCheckHistoryQuery = {}
): Promise<RedirectCheckHistoryResult> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 20)));
  const where: Record<string, unknown> = {
    tenantId,
    ...(query.trackingLinkId ? { trackingLinkId: query.trackingLinkId } : {}),
  };

  const [total, rows] = await Promise.all([
    chainCheck(prisma).count({ where }),
    chainCheck(prisma).findMany({
      where,
      orderBy: { checkedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const linkIds = [...new Set(rows.map((r) => r.trackingLinkId))];
  const links =
    linkIds.length > 0
      ? await prisma.trackingLink.findMany({
          where: { id: { in: linkIds }, tenantId },
          select: {
            id: true,
            publicId: true,
            offer: { select: { name: true } },
            landingPage: { select: { name: true } },
          },
        })
      : [];
  const linkById = new Map(
    links.map((l) => [
      l.id,
      {
        publicId: l.publicId,
        name:
          (l.landingPage as { name?: string } | null)?.name ??
          (l.offer as { name?: string } | null)?.name ??
          null,
      },
    ])
  );

  return {
    total,
    page,
    pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      trackingLinkId: r.trackingLinkId,
      hopCount: r.hopCount,
      hops: (r.hops as RedirectHop[] | null) ?? [],
      issues: (r.issues as string[] | null) ?? [],
      checkedAt: r.checkedAt,
      status: r.status,
      linkName: linkById.get(r.trackingLinkId)?.name ?? null,
      linkPublicId: linkById.get(r.trackingLinkId)?.publicId ?? null,
    })),
  };
}
