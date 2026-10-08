import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";

/**
 * Phase 2 Traffic Intelligence API (one tenant per user; session auth only).
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * Contract frozen: response shapes below are consumed by the Web worker —
 * do not rename fields.
 *
 * Event-chain storage is owned by Worker 1 (`apps/api/src/services/traffic-events.ts`,
 * `getEventChain(tenantId, clickId)` root→leaf, `recordTrafficEvent(input)` never
 * throws). That module may not exist yet when this file is loaded, so it is
 * resolved lazily via a dynamic import wrapped in try/catch; tests (and future
 * callers) can inject implementations through `deps`.
 */

export type TrafficEventType =
  | "AD_CLICK"
  | "LANDING_PAGE_VIEW"
  | "AFFILIATE_CLICK"
  | "MERCHANT_VISIT"
  | "CONVERSION"
  | "COMMISSION";

const TRAFFIC_EVENT_TYPES: readonly TrafficEventType[] = [
  "AD_CLICK",
  "LANDING_PAGE_VIEW",
  "AFFILIATE_CLICK",
  "MERCHANT_VISIT",
  "CONVERSION",
  "COMMISSION",
];

export interface TrafficEventDto {
  id: string;
  parentEventId: string | null;
  eventType: TrafficEventType;
  clickId: string | null;
  conversionId: string | null;
  trackingLinkId: string | null;
  timestamp: string;
  source: string | null;
  destination: string | null;
  metadata: Record<string, unknown>;
  dataQuality: "OBSERVED";
}

export interface RecordTrafficEventInput {
  tenantId: string;
  clickId: string;
  parentEventId: string | null;
  eventType: TrafficEventType;
  conversionId?: string | null;
  trackingLinkId?: string | null;
  source?: string | null;
  destination?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TrafficEventService {
  getEventChain(tenantId: string, clickId: string): Promise<TrafficEventDto[]>;
  recordTrafficEvent(input: RecordTrafficEventInput): Promise<void>;
}

export interface PolicyEvidenceDto {
  rule: string;
  matchedText: string;
  confidence: number;
}

export interface ProvenanceReport {
  conversionId: string;
  chain: TrafficEventDto[];
  summary: {
    trafficSource: string | null;
    trafficMedium: string | null;
    campaign: { id: string; name: string } | null;
    adGroup: { id: string; name: string } | null;
    ad: { id: string; name: string } | null;
    keyword: string | null;
    clickId: string;
    landingPage: { id: string; name: string; url: string } | null;
    trackingLink: { id: string; publicId: string };
    offer: { id: string; name: string } | null;
    merchant: { id: string; name: string } | null;
    conversion: {
      id: string;
      action: string;
      time: string;
      value: string | null;
      currency: string | null;
      status: string;
    };
    commission: { value: string | null; currency: string | null } | null;
  };
  policyEvidence: PolicyEvidenceDto[];
  generatedAt: string;
}

export interface AuditReport {
  merchant: { id: string; name: string } | null;
  offer: { id: string; name: string } | null;
  period: { from: string; to: string };
  totals: { clicks: number; conversions: number; commission: string };
  trafficSources: Array<{ source: string; clicks: number }>;
  policyEvidence: PolicyEvidenceDto[];
  attributions: Array<{
    conversionId: string;
    clickId: string;
    timestamp: string;
    trackingLinkPublicId: string;
    trafficSource: string | null;
    gclid: string | null;
    value: string | null;
    currency: string | null;
  }>;
  generatedAt: string;
}

export interface TrafficIntelRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests / future wiring; falls back to the traffic-events service module. */
  getEventChainImpl?: TrafficEventService["getEventChain"];
  /** Injectable for tests / future wiring; falls back to the traffic-events service module. */
  recordTrafficEventImpl?: TrafficEventService["recordTrafficEvent"];
}

async function requireSession(
  deps: TrafficIntelRouteDeps,
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

/* ------------------------------------------------------------------ */
/* Traffic-event service resolution (Worker 1 owns the implementation) */
/* ------------------------------------------------------------------ */

/** Module path is a non-literal so tsc does not fail when the file is absent. */
const TRAFFIC_EVENTS_MODULE_PATH = "../services/traffic-events.js";

let cachedServicePromise: Promise<TrafficEventService | undefined> | undefined;

function loadTrafficEventService(): Promise<TrafficEventService | undefined> {
  if (!cachedServicePromise) {
    cachedServicePromise = (async () => {
      try {
        const mod = (await import(
          /* @vite-ignore */ TRAFFIC_EVENTS_MODULE_PATH
        )) as unknown as Partial<TrafficEventService> | undefined;
        if (
          mod &&
          typeof mod.getEventChain === "function" &&
          typeof mod.recordTrafficEvent === "function"
        ) {
          return mod as TrafficEventService;
        }
        return undefined;
      } catch {
        return undefined;
      }
    })();
  }
  return cachedServicePromise;
}

function serviceUnavailable(which: string): AppError {
  return new AppError(`Traffic event service is not available (${which})`, {
    code: "SERVICE_UNAVAILABLE",
    statusCode: 503,
  });
}

async function resolveGetEventChain(
  deps: TrafficIntelRouteDeps
): Promise<TrafficEventService["getEventChain"]> {
  if (deps.getEventChainImpl) return deps.getEventChainImpl;
  const mod = await loadTrafficEventService();
  if (mod) return mod.getEventChain.bind(mod);
  throw serviceUnavailable("getEventChain");
}

async function resolveRecordTrafficEvent(
  deps: TrafficIntelRouteDeps
): Promise<TrafficEventService["recordTrafficEvent"]> {
  if (deps.recordTrafficEventImpl) return deps.recordTrafficEventImpl;
  const mod = await loadTrafficEventService();
  if (mod) return mod.recordTrafficEvent.bind(mod);
  throw serviceUnavailable("recordTrafficEvent");
}

/* ---------------- */
/* Small utilities  */
/* ---------------- */

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parsePagination(
  pageRaw: string | undefined,
  pageSizeRaw: string | undefined
): { page: number; pageSize: number } {
  const page = Math.max(1, Number(pageRaw) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
  return { page, pageSize };
}

function parseEventTypeFilter(v: string | undefined): TrafficEventType | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const t = v.trim().toUpperCase();
  if ((TRAFFIC_EVENT_TYPES as readonly string[]).includes(t)) {
    return t as TrafficEventType;
  }
  throw new ValidationError(`eventType must be one of: ${TRAFFIC_EVENT_TYPES.join(", ")}`);
}

function parseDateParam(v: string | undefined, name: string): Date | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${name} must be a valid ISO-8601 date`);
  }
  return d;
}

/** Prisma Decimal → string; null stays null. */
function decToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

/** Decimal(19,4)-style value → integer units of 1e-4, exact (no float). */
function decimalToUnits(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? "").padEnd(4, "0");
  const n = BigInt(`${m[2]}${frac}`);
  return m[1] === "-" ? -n : n;
}

function unitsToDecimal(n: bigint): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(5, "0");
  return `${neg ? "-" : ""}${s.slice(0, -4)}.${s.slice(-4)}`;
}

function csvEscape(v: string | null | undefined): string {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function sendCsv(
  reply: FastifyReply,
  filename: string,
  header: string[],
  rows: Array<Array<string | null | undefined>>
): Promise<void> {
  const lines = [
    header.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  await reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${filename}"`)
    .send(lines.join("\n"));
}

function requireCsvFormat(format: string | undefined): void {
  if (format !== "csv") {
    throw new ValidationError('format must be "csv"');
  }
}

/* ------------------------------ */
/* Shared report-building helpers */
/* ------------------------------ */

async function loadPolicyEvidence(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string | null
): Promise<PolicyEvidenceDto[]> {
  if (!offerId) return [];
  const policy = await prisma.offerPolicy.findFirst({
    where: { offerId, tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!policy) return [];
  const rows = await prisma.policyEvidence.findMany({
    where: { offerPolicyId: policy.id, tenantId, deletedAt: null },
  });
  return rows.map((r) => ({
    rule: r.rule,
    matchedText: r.matchedText,
    confidence: Number(r.confidence),
  }));
}

/** Latest ProfitModel commission for an offer, or null when unknown. */
async function loadOfferCommission(
  prisma: PrismaClient,
  tenantId: string,
  offerId: string | null
): Promise<{ value: string | null; currency: string | null } | null> {
  if (!offerId) return null;
  const pm = await prisma.profitModel.findFirst({
    where: { offerId, tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!pm || pm.commission === null || pm.commission === undefined) return null;
  return { value: decToString(pm.commission), currency: pm.currency ?? null };
}

async function buildProvenanceReport(
  prisma: PrismaClient,
  tenantId: string,
  conversionId: string,
  getEventChain: TrafficEventService["getEventChain"]
): Promise<ProvenanceReport> {
  const conversion = await prisma.conversion.findFirst({
    where: { id: conversionId, tenantId, deletedAt: null },
  });
  if (!conversion) throw new NotFoundError("Conversion", conversionId);

  const click =
    (await prisma.click.findFirst({
      where: { id: conversion.clickId, tenantId },
    })) ??
    (await prisma.click.findFirst({
      where: { clickId: conversion.clickId, tenantId },
    }));
  if (!click) throw new NotFoundError("Click", conversion.clickId);

  const trackingLink = click.trackingLinkId
    ? await prisma.trackingLink.findFirst({
        where: { id: click.trackingLinkId, tenantId },
        include: {
          campaign: true,
          adGroup: true,
          ad: true,
          landingPage: true,
          offer: true,
        },
      })
    : null;
  if (!trackingLink) {
    throw new NotFoundError("TrackingLink", click.trackingLinkId ?? "unknown");
  }

  const offer = (trackingLink as { offer?: { id: string; name: string; merchantId: string | null } | null })
    .offer ?? null;
  const merchant = offer?.merchantId
    ? await prisma.merchant.findFirst({
        where: { id: offer.merchantId, tenantId, deletedAt: null },
      })
    : null;

  // Event chain root → leaf, straight from the traffic-events service.
  const chain = await getEventChain(tenantId, click.clickId ?? click.id);

  const policyEvidence = await loadPolicyEvidence(prisma, tenantId, offer?.id ?? null);
  const commission = await loadOfferCommission(prisma, tenantId, offer?.id ?? null);

  const campaign = (trackingLink as { campaign?: { id: string; name: string } | null }).campaign ?? null;
  const adGroup = (trackingLink as { adGroup?: { id: string; name: string } | null }).adGroup ?? null;
  const ad = (trackingLink as { ad?: { id: string; name: string } | null }).ad ?? null;
  const landingPage = (
    trackingLink as { landingPage?: { id: string; name: string; url: string } | null }
  ).landingPage ?? null;

  return {
    conversionId: conversion.id,
    chain,
    summary: {
      // Traffic source/medium/keyword are the REAL stored click values — never invented.
      trafficSource: click.utmSource ?? null,
      trafficMedium: click.utmMedium ?? null,
      campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
      adGroup: adGroup ? { id: adGroup.id, name: adGroup.name } : null,
      ad: ad ? { id: ad.id, name: ad.name } : null,
      keyword: click.utmTerm ?? null,
      clickId: click.clickId ?? click.id,
      landingPage: landingPage
        ? { id: landingPage.id, name: landingPage.name, url: landingPage.url }
        : null,
      trackingLink: { id: trackingLink.id, publicId: trackingLink.publicId },
      offer: offer ? { id: offer.id, name: offer.name } : null,
      merchant: merchant ? { id: merchant.id, name: merchant.name } : null,
      conversion: {
        id: conversion.id,
        action: conversion.conversionAction,
        time: new Date(conversion.conversionTime).toISOString(),
        value: decToString(conversion.value),
        currency: conversion.currency ?? null,
        status: String(conversion.status),
      },
      commission,
    },
    policyEvidence,
    generatedAt: new Date().toISOString(),
  };
}

interface AuditScope {
  merchant: { id: string; name: string } | null;
  offer: { id: string; name: string } | null;
  offerIds: string[] | null; // null = whole tenant
  from: Date;
  to: Date;
}

async function resolveAuditScope(
  prisma: PrismaClient,
  tenantId: string,
  query: { merchantId?: string; offerId?: string; from?: string; to?: string }
): Promise<AuditScope> {
  const to = parseDateParam(query.to, "to") ?? new Date();
  const from =
    parseDateParam(query.from, "from") ??
    new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from.getTime() > to.getTime()) {
    throw new ValidationError("from must not be after to");
  }

  let merchant: { id: string; name: string } | null = null;
  const merchantId = asTrimmedString(query.merchantId);
  if (merchantId) {
    const row = await prisma.merchant.findFirst({
      where: { id: merchantId, tenantId, deletedAt: null },
    });
    if (!row) throw new NotFoundError("Merchant", merchantId);
    merchant = { id: row.id, name: row.name };
  }

  let offer: { id: string; name: string } | null = null;
  let offerIds: string[] | null = null;
  const offerId = asTrimmedString(query.offerId);
  if (offerId) {
    const row = await prisma.offer.findFirst({
      where: { id: offerId, tenantId, deletedAt: null },
    });
    if (!row) throw new NotFoundError("Offer", offerId);
    if (merchant && row.merchantId !== merchant.id) {
      throw new ValidationError("Offer does not belong to the specified merchant");
    }
    offer = { id: row.id, name: row.name };
    offerIds = [row.id];
  } else if (merchant) {
    const rows = await prisma.offer.findMany({
      where: { merchantId: merchant.id, tenantId, deletedAt: null },
    });
    offerIds = rows.map((r) => r.id);
  }

  return { merchant, offer, offerIds, from, to };
}

function dedupeEvidence(rows: PolicyEvidenceDto[]): PolicyEvidenceDto[] {
  const seen = new Set<string>();
  const out: PolicyEvidenceDto[] = [];
  for (const r of rows) {
    const key = `${r.rule}\u0000${r.matchedText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Test-only export: exercised by test-click isolation tests. */
export async function buildAuditReport(
  prisma: PrismaClient,
  tenantId: string,
  scope: AuditScope
): Promise<AuditReport> {
  const clicks = await prisma.click.findMany({
    where: {
      tenantId,
      occurredAt: { gte: scope.from, lte: scope.to },
      // Test clicks (link-chain verification) never count as real traffic.
      isTest: { not: true },
    },
    orderBy: { occurredAt: "asc" },
  });

  // Resolve each click's offer: direct offerId, else its tracking link's offer.
  const tlIds = [...new Set(clicks.map((c) => c.trackingLinkId).filter(Boolean))] as string[];
  const tls = tlIds.length
    ? await prisma.trackingLink.findMany({ where: { id: { in: tlIds }, tenantId } })
    : [];
  const tlById = new Map(tls.map((t) => [t.id, t]));
  const clickOfferId = (c: { offerId?: string | null; trackingLinkId?: string | null }): string | null =>
    c.offerId ?? (c.trackingLinkId ? tlById.get(c.trackingLinkId)?.offerId ?? null : null);

  const scopedClicks = scope.offerIds
    ? clicks.filter((c) => {
        const oid = clickOfferId(c);
        return oid !== null && scope.offerIds!.includes(oid);
      })
    : clicks;
  const scopedClickIds = new Set(scopedClicks.map((c) => c.id));
  const clickById = new Map(scopedClicks.map((c) => [c.id, c]));

  const conversions = await prisma.conversion.findMany({
    where: {
      tenantId,
      conversionTime: { gte: scope.from, lte: scope.to },
      deletedAt: null,
    },
    orderBy: { conversionTime: "asc" },
  });
  const scopedConversions = conversions.filter((c) => scopedClickIds.has(c.clickId));

  // Traffic sources: REAL utm_source values only — never invented, no beautification.
  const sourceCounts = new Map<string, number>();
  for (const c of scopedClicks) {
    const s = (c.utmSource ?? "").trim();
    if (!s) continue;
    sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }
  const trafficSources = [...sourceCounts.entries()]
    .map(([source, n]) => ({ source, clicks: n }))
    .sort((a, b) => b.clicks - a.clicks || (a.source < b.source ? -1 : 1));

  // Commission: latest ProfitModel.commission per offer × each scoped conversion.
  let commissionSum = 0n;
  const pmOfferIds =
    scope.offerIds ??
    [...new Set(scopedClicks.map(clickOfferId).filter((x): x is string => x !== null))];
  if (pmOfferIds.length > 0) {
    const pms = await prisma.profitModel.findMany({
      where: { offerId: { in: pmOfferIds }, tenantId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<string, (typeof pms)[number]>();
    for (const pm of pms) {
      if (!latest.has(pm.offerId)) latest.set(pm.offerId, pm);
    }
    for (const conv of scopedConversions) {
      const click = clickById.get(conv.clickId);
      const oid = click ? clickOfferId(click) : null;
      const units = oid ? decimalToUnits(latest.get(oid)?.commission) : null;
      if (units !== null) commissionSum += units;
    }
  }

  // Policy evidence: latest policy of each scoped offer (deduped).
  const evidenceOffers =
    scope.offerIds ??
    [...new Set(scopedClicks.map(clickOfferId).filter((x): x is string => x !== null))].slice(0, 20);
  const evidenceRows: PolicyEvidenceDto[] = [];
  for (const oid of evidenceOffers) {
    evidenceRows.push(...(await loadPolicyEvidence(prisma, tenantId, oid)));
  }

  const attributions = scopedConversions.map((conv) => {
    const click = clickById.get(conv.clickId);
    const tl = click?.trackingLinkId ? tlById.get(click.trackingLinkId) : undefined;
    return {
      conversionId: conv.id,
      clickId: conv.clickId,
      timestamp: new Date(conv.conversionTime).toISOString(),
      trackingLinkPublicId: tl?.publicId ?? "",
      trafficSource: click?.utmSource ?? null,
      gclid: click?.gclid ?? null,
      value: decToString(conv.value),
      currency: conv.currency ?? null,
    };
  });

  return {
    merchant: scope.merchant,
    offer: scope.offer,
    period: { from: scope.from.toISOString(), to: scope.to.toISOString() },
    totals: {
      clicks: scopedClicks.length,
      conversions: scopedConversions.length,
      commission: unitsToDecimal(commissionSum),
    },
    trafficSources,
    policyEvidence: dedupeEvidence(evidenceRows),
    attributions,
    generatedAt: new Date().toISOString(),
  };
}

/** Map a stored Click row to an AD_CLICK event DTO (honest fallback list, no clickId). */
function clickToAdClickEvent(click: {
  id: string;
  clickId?: string | null;
  trackingLinkId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  gclid?: string | null;
  occurredAt: Date | string;
  trackingLink?: {
    landingPage?: { url: string } | null;
    offer?: { destinationUrl: string } | null;
  } | null;
}): TrafficEventDto {
  const tl = click.trackingLink ?? null;
  return {
    id: click.id,
    parentEventId: null,
    eventType: "AD_CLICK",
    clickId: click.clickId ?? click.id,
    conversionId: null,
    trackingLinkId: click.trackingLinkId ?? null,
    timestamp: new Date(click.occurredAt).toISOString(),
    source: click.utmSource ?? null,
    destination: tl?.landingPage?.url ?? tl?.offer?.destinationUrl ?? null,
    metadata: {
      utmMedium: click.utmMedium ?? null,
      utmCampaign: click.utmCampaign ?? null,
      utmTerm: click.utmTerm ?? null,
      utmContent: click.utmContent ?? null,
      gclid: click.gclid ?? null,
    },
    dataQuality: "OBSERVED",
  };
}

/* ============ */
/* Route wiring */
/* ============ */

export async function registerTrafficIntelRoutes(
  app: FastifyInstance,
  deps: TrafficIntelRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * Event chain query. With `clickId`, the chain comes from the traffic-events
   * service (root → leaf); without it, the tenant's latest clicks are listed
   * as AD_CLICK events (real stored rows, paginated).
   */
  app.get<{
    Querystring: {
      clickId?: string;
      eventType?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/api/v1/traffic/events", async (request) => {
    const info = await requireSession(deps, request);
    const { page, pageSize } = parsePagination(request.query.page, request.query.pageSize);
    const eventType = parseEventTypeFilter(request.query.eventType);
    const clickId = asTrimmedString(request.query.clickId);

    if (clickId) {
      const getEventChain = await resolveGetEventChain(deps);
      const chain = await getEventChain(info.tenantId, clickId);
      const filtered = eventType ? chain.filter((e) => e.eventType === eventType) : chain;
      return {
        items: filtered.slice((page - 1) * pageSize, page * pageSize),
        total: filtered.length,
        page,
        pageSize,
      };
    }

    const where = { tenantId: info.tenantId };
    if (eventType && eventType !== "AD_CLICK") {
      return { items: [], total: 0, page, pageSize };
    }
    const total = await prisma.click.count({ where });
    const clicks = await prisma.click.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        trackingLink: { include: { landingPage: true, offer: true } },
      },
    });
    return {
      items: clicks.map((c) => clickToAdClickEvent(c)),
      total,
      page,
      pageSize,
    };
  });

  /**
   * Record a MERCHANT_VISIT — the one chain node that cannot be observed
   * server-side, hence the manual/postback entry point. Parent links to the
   * click's latest AFFILIATE_CLICK, falling back to its latest AD_CLICK.
   */
  app.post<{
    Body: { clickId?: unknown; destination?: unknown; metadata?: unknown };
  }>("/api/v1/traffic/events/merchant-visit", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      clickId?: unknown;
      destination?: unknown;
      metadata?: unknown;
    };
    const clickId = asTrimmedString(body.clickId);
    if (!clickId) {
      throw new ValidationError("clickId is required");
    }
    const click =
      (await prisma.click.findFirst({ where: { id: clickId, tenantId: info.tenantId } })) ??
      (await prisma.click.findFirst({ where: { clickId, tenantId: info.tenantId } }));
    if (!click) {
      throw new NotFoundError("Click", clickId);
    }
    const destination = asTrimmedString(body.destination) ?? null;
    const metadata = isRecord(body.metadata) ? body.metadata : {};

    const getEventChain = await resolveGetEventChain(deps);
    const recordTrafficEvent = await resolveRecordTrafficEvent(deps);
    const chain = await getEventChain(info.tenantId, clickId);
    const reversed = [...chain].reverse();
    const parent =
      reversed.find((e) => e.eventType === "AFFILIATE_CLICK") ??
      reversed.find((e) => e.eventType === "AD_CLICK") ??
      null;
    const parentEventId = parent?.id ?? null;

    await recordTrafficEvent({
      tenantId: info.tenantId,
      clickId,
      parentEventId,
      eventType: "MERCHANT_VISIT",
      trackingLinkId: click.trackingLinkId ?? null,
      destination,
      metadata,
    });

    return {
      ok: true,
      clickId,
      eventType: "MERCHANT_VISIT" as const,
      parentEventId,
      destination,
    };
  });

  /** §33 Conversion Provenance Report (JSON). */
  app.get<{ Params: { conversionId: string } }>(
    "/api/v1/traffic/provenance/:conversionId",
    async (request) => {
      const info = await requireSession(deps, request);
      const getEventChain = await resolveGetEventChain(deps);
      return buildProvenanceReport(
        prisma,
        info.tenantId,
        request.params.conversionId,
        getEventChain
      );
    }
  );

  /** §33 Conversion Provenance Report (CSV export). */
  app.get<{
    Params: { conversionId: string };
    Querystring: { format?: string };
  }>("/api/v1/traffic/provenance/:conversionId/export", async (request, reply) => {
    requireCsvFormat(request.query.format);
    const info = await requireSession(deps, request);
    const getEventChain = await resolveGetEventChain(deps);
    const report = await buildProvenanceReport(
      prisma,
      info.tenantId,
      request.params.conversionId,
      getEventChain
    );
    await sendCsv(
      reply,
      `provenance-${report.conversionId}.csv`,
      ["eventType", "timestamp", "source", "destination", "clickId", "conversionId", "metadataJson"],
      report.chain.map((e) => [
        e.eventType,
        e.timestamp,
        e.source,
        e.destination,
        e.clickId,
        e.conversionId,
        JSON.stringify(e.metadata ?? {}),
      ])
    );
  });

  /** §34 Merchant/Network Audit Report (JSON). */
  app.get<{
    Querystring: {
      merchantId?: string;
      offerId?: string;
      from?: string;
      to?: string;
    };
  }>("/api/v1/traffic/audit-report", async (request) => {
    const info = await requireSession(deps, request);
    const scope = await resolveAuditScope(prisma, info.tenantId, request.query);
    return buildAuditReport(prisma, info.tenantId, scope);
  });

  /** §34 Merchant/Network Audit Report (CSV export, one row per attribution). */
  app.get<{
    Querystring: {
      merchantId?: string;
      offerId?: string;
      from?: string;
      to?: string;
      format?: string;
    };
  }>("/api/v1/traffic/audit-report/export", async (request, reply) => {
    requireCsvFormat(request.query.format);
    const info = await requireSession(deps, request);
    const scope = await resolveAuditScope(prisma, info.tenantId, request.query);
    const report = await buildAuditReport(prisma, info.tenantId, scope);
    await sendCsv(
      reply,
      "audit-report.csv",
      [
        "conversionId",
        "clickId",
        "timestamp",
        "trackingLinkPublicId",
        "trafficSource",
        "gclid",
        "value",
        "currency",
      ],
      report.attributions.map((a) => [
        a.conversionId,
        a.clickId,
        a.timestamp,
        a.trackingLinkPublicId,
        a.trafficSource,
        a.gclid,
        a.value,
        a.currency,
      ])
    );
  });
}
