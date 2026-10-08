/**
 * 功能5 — 测试点击链路验证 (test click chain verification).
 *
 * POST /api/v1/tracking/test-click — server-side simulation of one full
 * click through the tracking chain:
 *   tracking URL → LandingPage → affiliate link → 终链 (final URL)
 *
 * Isolation guarantees:
 * - The Click row written is flagged `isTest: true` (excluded from all
 *   stats / profit / monitoring aggregations).
 * - Every outbound hop carries the test marker (query param
 *   `__adtlab_test=1` + header `x-adtlab-test: 1`), propagated through
 *   redirects, so downstream analytics can ignore the visit.
 * - Never triggers conversion postback: this module never calls any
 *   conversion / postback / traffic-event code path.
 *
 * The tracking-URL hop is resolved internally (same checks as
 * TrackingLinkResolver: ACTIVE link/offer/landing page) instead of via an
 * HTTP self-call, so no real (non-test) click is ever recorded.
 */
import { randomUUID } from "node:crypto";
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

/** Query-param test marker, propagated through every redirect hop. */
export const TEST_CLICK_MARKER_PARAM = "__adtlab_test";
export const TEST_CLICK_MARKER_VALUE = "1";
/** Header test marker sent on every outbound hop. */
export const TEST_CLICK_HEADER = "x-adtlab-test";
export const TEST_CLICK_UA = "AdLinkLab-TestClick/1.0";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hard cap on total hops (landing-page redirects + affiliate redirects). */
const MAX_HOPS = 12;
/** Per-hop fetch timeout. */
const HOP_TIMEOUT_MS = 15_000;

export interface TestClickRouteDeps {
  prisma: PrismaClient;
  /**
   * Injectable fetch for tests. Defaults to the global fetch.
   * Must NOT follow redirects automatically — the chain walker follows
   * them manually so each hop can be recorded and the test marker
   * propagated.
   */
  fetchImpl?: FetchLike;
}

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<FetchResponseLike>;

export interface TestClickHop {
  hop: number;
  /** tracking | landing-page | affiliate | final */
  label: "tracking" | "landing-page" | "affiliate" | "final";
  url: string;
  /** null when the request itself failed (DNS/timeout). */
  httpStatus: number | null;
  /** wall-clock ms for this hop. */
  ms: number;
  /** expected URL for this hop, when one is known. */
  expectedUrl?: string;
  /** true when the hop errored, returned >= 400, or missed its expectation. */
  deviated: boolean;
  error?: string;
}

export interface TestClickReport {
  ok: boolean;
  trackingLinkId: string;
  publicId: string;
  /** The Click row written (isTest=true). */
  clickId: string;
  isTestClick: true;
  hops: TestClickHop[];
  /** True when every hop completed without deviation or error. */
  chainOk: boolean;
  /** Always true — test clicks never fire conversion postbacks. */
  conversionPostbackSkipped: true;
}

async function requireSession(
  deps: TestClickRouteDeps,
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

/** Append the test marker query param when absent. */
export function withTestMarker(rawUrl: string): string {
  const u = new URL(rawUrl);
  if (!u.searchParams.has(TEST_CLICK_MARKER_PARAM)) {
    u.searchParams.set(TEST_CLICK_MARKER_PARAM, TEST_CLICK_MARKER_VALUE);
  }
  return u.toString();
}

/** Normalize for URL comparison (lowercase host, no trailing slash). */
function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete(TEST_CLICK_MARKER_PARAM);
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}${u.hash}`;
    if (s.endsWith("/") && u.pathname === "/") s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl;
  }
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface ResolvedChain {
  trackingLink: { id: string; publicId: string };
  landingPageUrl: string;
}

/**
 * Resolve the tracking link the same way TrackingLinkResolver does
 * (ACTIVE link → ACTIVE offer → ACTIVE landing page of that offer).
 * Throws ValidationError/NotFoundError on any mismatch — that IS the
 * chain-verification signal for hop 1.
 */
async function resolveChainTarget(
  prisma: PrismaClient,
  tenantId: string,
  trackingLinkId: string
): Promise<ResolvedChain> {
  const link = (await prisma.trackingLink.findFirst({
    where: { id: trackingLinkId, tenantId, deletedAt: null },
    select: {
      id: true,
      publicId: true,
      status: true,
      offerId: true,
      landingPageId: true,
    },
  })) as {
    id: string;
    publicId: string;
    status: string;
    offerId: string | null;
    landingPageId: string | null;
  } | null;
  if (!link) throw new NotFoundError("TrackingLink", trackingLinkId);
  if (link.status !== "ACTIVE") {
    throw new ValidationError("TrackingLink is not active", {
      publicId: link.publicId,
      status: link.status,
    });
  }
  if (!link.offerId || !link.landingPageId) {
    throw new ValidationError("TrackingLink has no offer or landing page", {
      publicId: link.publicId,
    });
  }

  const offer = (await prisma.offer.findFirst({
    where: { id: link.offerId, tenantId },
    select: { id: true, status: true },
  })) as { id: string; status: string } | null;
  if (!offer || offer.status !== "ACTIVE") {
    throw new ValidationError("Offer is missing or inactive", {
      offerId: link.offerId,
    });
  }

  const landingPage = (await prisma.landingPage.findFirst({
    where: { id: link.landingPageId, tenantId },
    select: { id: true, status: true, url: true, offerId: true },
  })) as {
    id: string;
    status: string;
    url: string;
    offerId: string | null;
  } | null;
  if (!landingPage || landingPage.status !== "ACTIVE") {
    throw new ValidationError("LandingPage is missing or inactive", {
      landingPageId: link.landingPageId,
    });
  }
  if (landingPage.offerId !== offer.id) {
    throw new ValidationError("LandingPage does not belong to Offer", {
      landingPageId: landingPage.id,
      offerId: offer.id,
    });
  }

  return {
    trackingLink: { id: link.id, publicId: link.publicId },
    landingPageUrl: landingPage.url,
  };
}

interface FetchedHop {
  hop: TestClickHop;
  /** Next URL to fetch, when this hop was a redirect. */
  redirectTo: string | null;
  /** Final response body (only for the terminal 2xx HTML page). */
  body: string | null;
}

async function fetchOneHop(
  fetchImpl: FetchLike,
  hopNo: number,
  label: TestClickHop["label"],
  url: string,
  expectedUrl?: string
): Promise<FetchedHop> {
  const started = Date.now();
  let status: number | null = null;
  let redirectTo: string | null = null;
  let body: string | null = null;
  let error: string | undefined;

  try {
    // Timeout via Promise.race — the FetchLike surface stays minimal
    // (headers only) so tests can inject a trivial mock.
    const res = (await Promise.race([
      fetchImpl(url, { headers: { [TEST_CLICK_HEADER]: "1" } }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`hop timeout after ${HOP_TIMEOUT_MS}ms`)),
          HOP_TIMEOUT_MS
        )
      ),
    ])) as FetchResponseLike;
    status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        try {
          redirectTo = withTestMarker(new URL(loc, url).toString());
        } catch {
          redirectTo = null;
        }
      }
    } else if (status === 200) {
      try {
        body = await res.text();
      } catch {
        body = null;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ms = Date.now() - started;
  const deviated =
    status === null ||
    status >= 400 ||
    (expectedUrl !== undefined &&
      normalizeUrl(url) !== normalizeUrl(expectedUrl));

  return {
    hop: {
      hop: hopNo,
      label,
      url,
      httpStatus: status,
      ms,
      ...(expectedUrl !== undefined ? { expectedUrl } : {}),
      deviated,
      ...(error !== undefined ? { error } : {}),
    },
    redirectTo,
    body,
  };
}

/**
 * Fetch a URL and manually follow redirects, recording one hop per
 * request. The test marker is propagated to every redirect target.
 */
async function walkRedirectChain(
  fetchImpl: FetchLike,
  startUrl: string,
  label: TestClickHop["label"],
  expectedUrl: string | undefined,
  hopCounter: { n: number },
  hops: TestClickHop[]
): Promise<{ finalUrl: string; body: string | null; ok: boolean }> {
  let current = withTestMarker(startUrl);
  let body: string | null = null;
  let first = true;
  for (;;) {
    if (hopCounter.n >= MAX_HOPS) break;
    hopCounter.n += 1;
    const { hop, redirectTo, body: b } = await fetchOneHop(
      fetchImpl,
      hopCounter.n,
      label,
      current,
      first ? expectedUrl : undefined
    );
    first = false;
    hops.push(hop);
    if (redirectTo && isHttpUrl(redirectTo)) {
      current = redirectTo;
      continue;
    }
    body = b;
    // No usable redirect — the walk ends here (terminal 2xx, a 4xx/5xx,
    // a fetch error, or a 3xx without a followable Location).
    break;
  }
  return { finalUrl: current, body, ok: true };
}

const ANCHOR_HREF_RE = /<a\b[^>]*?\bhref\s*=\s*["']([^"'\s>]+)["']/gi;

/**
 * Extract the first outbound http(s) link from landing-page HTML —
 * the "affiliate" hop. Prefers a link whose host differs from the
 * landing page host; falls back to the first absolute http(s) href.
 */
export function extractAffiliateLink(
  html: string,
  landingPageUrl: string
): string | null {
  let landingHost = "";
  try {
    landingHost = new URL(landingPageUrl).host.toLowerCase();
  } catch {
    return null;
  }
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  ANCHOR_HREF_RE.lastIndex = 0;
  while ((m = ANCHOR_HREF_RE.exec(html)) !== null) {
    const href = m[1].trim();
    if (!isHttpUrl(href)) continue;
    candidates.push(href);
    if (candidates.length >= 50) break;
  }
  if (candidates.length === 0) return null;
  try {
    const offsite = candidates.find((c) => {
      try {
        return new URL(c).host.toLowerCase() !== landingHost;
      } catch {
        return false;
      }
    });
    return offsite ?? candidates[0];
  } catch {
    return candidates[0];
  }
}

async function requireUuid(value: unknown, name: string): Promise<string> {
  const v = typeof value === "string" ? value.trim() : "";
  if (!UUID_RE.test(v)) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }
  return v;
}

export async function registerTestClickRoutes(
  app: FastifyInstance,
  deps: TestClickRouteDeps
): Promise<void> {
  const { prisma } = deps;
  const fetchImpl: FetchLike =
    deps.fetchImpl ??
    ((url, init) =>
      fetch(url, {
        headers: init?.headers,
        redirect: "manual",
      }) as unknown as Promise<FetchResponseLike>);

  /**
   * Simulate one full test click through the tracking chain.
   * Writes a Click with isTest=true and returns a hop-by-hop report.
   * Never triggers conversion postback.
   */
  app.post<{
    Body: { trackingLinkId?: unknown };
  }>("/api/v1/tracking/test-click", async (request) => {
    const info = await requireSession(deps, request);
    const trackingLinkId = await requireUuid(
      (request.body as { trackingLinkId?: unknown } | null)?.trackingLinkId,
      "trackingLinkId"
    );

    // Hop 1 — tracking URL, resolved internally (no real click recorded).
    const t0 = Date.now();
    const resolved = await resolveChainTarget(
      prisma,
      info.tenantId,
      trackingLinkId
    );
    const host = request.headers.host;
    const protocol = request.protocol ?? "https";
    const trackingUrl = withTestMarker(
      `${protocol}://${host}/api/v1/t/${resolved.trackingLink.publicId}`
    );
    const landingPageUrl = resolved.landingPageUrl;
    if (!isHttpUrl(landingPageUrl)) {
      throw new ValidationError("LandingPage URL is not a valid http(s) URL");
    }

    // Record the synthetic click — isTest=true, excluded from every
    // stats/profit/monitoring aggregation. Written directly via prisma so
    // no traffic-event / conversion pipeline is ever touched.
    const clickUuid = randomUUID();
    const click = (await prisma.click.create({
      data: {
        id: clickUuid,
        clickId: clickUuid,
        tenantId: info.tenantId,
        trackingLinkId: resolved.trackingLink.id,
        occurredAt: new Date(),
        userAgent: TEST_CLICK_UA,
        queryParameters: {
          [TEST_CLICK_MARKER_PARAM]: TEST_CLICK_MARKER_VALUE,
        },
        isTest: true,
      },
      select: { id: true, clickId: true },
    })) as { id: string; clickId: string };

    const hops: TestClickHop[] = [];
    const hopCounter = { n: 0 };

    hopCounter.n += 1;
    hops.push({
      hop: hopCounter.n,
      label: "tracking",
      url: trackingUrl,
      // Internal resolution stands in for the 302 the real endpoint
      // would issue; it performs the identical ACTIVE-link/offer/LP
      // checks without recording a real click.
      httpStatus: 302,
      ms: Date.now() - t0,
      expectedUrl: landingPageUrl,
      // Internal resolution targets the landing page URL by construction;
      // a deviation here is impossible unless resolveChainTarget lied.
      deviated: false,
    });

    // Hop 2 — landing page (real fetch + manual redirect walk, marker
    // propagated to every redirect target).
    const lp = await walkRedirectChain(
      fetchImpl,
      landingPageUrl,
      "landing-page",
      landingPageUrl,
      hopCounter,
      hops
    );

    // Hop 3 — affiliate link extracted from the landing page HTML, then
    // its own redirect walk to the 终链 (final URL).
    if (lp.body) {
      const affiliateUrl = extractAffiliateLink(lp.body, lp.finalUrl);
      if (affiliateUrl) {
        const aff = await walkRedirectChain(
          fetchImpl,
          affiliateUrl,
          "affiliate",
          undefined,
          hopCounter,
          hops
        );
        if (hops.length > 0) {
          const last = hops[hops.length - 1];
          if (last.label === "affiliate") last.label = "final";
        }
        void aff;
      }
    }

    const chainOk = hops.every((h) => !h.deviated);

    const report: TestClickReport = {
      ok: true,
      trackingLinkId: resolved.trackingLink.id,
      publicId: resolved.trackingLink.publicId,
      clickId: click.clickId,
      isTestClick: true,
      hops,
      chainOk,
      conversionPostbackSkipped: true,
    };
    return report;
  });
}
