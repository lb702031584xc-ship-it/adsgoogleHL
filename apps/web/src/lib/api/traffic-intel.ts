/**
 * Traffic Intelligence API clients (server-side only).
 * Event chains, conversion provenance reports, and traffic audit reports
 * (Phase 2). Talks to the API with the forwarded session cookie.
 * Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class TrafficIntelApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "TrafficIntelApiError";
    this.status = status;
    this.code = code;
  }
}

async function trafficFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — Fastify
        // rejects an empty body paired with content-type: application/json.
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new TrafficIntelApiError(0, "network failure");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
        code?: string;
      };
      message = body.message ?? body.error ?? message;
      code = body.code ?? body.error;
    } catch {
      /* ignore */
    }
    throw new TrafficIntelApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types (Phase 2 contract — field names must match the API exactly)
// ---------------------------------------------------------------------------

export type TrafficEventType =
  | "AD_CLICK"
  | "LANDING_PAGE_VIEW"
  | "AFFILIATE_CLICK"
  | "MERCHANT_VISIT"
  | "CONVERSION"
  | "COMMISSION";

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
  policyEvidence: Array<{
    rule: string;
    matchedText: string;
    confidence: number;
  }>;
  generatedAt: string;
}

export interface AuditReport {
  merchant: { id: string; name: string } | null;
  offer: { id: string; name: string } | null;
  period: { from: string; to: string };
  totals: { clicks: number; conversions: number; commission: string };
  trafficSources: Array<{ source: string; clicks: number }>;
  policyEvidence: Array<{
    rule: string;
    matchedText: string;
    confidence: number;
  }>;
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

export interface AuditReportParams {
  merchantId?: string;
  offerId?: string;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Event chain
// ---------------------------------------------------------------------------

export async function getEventChain(clickId: string): Promise<TrafficEventDto[]> {
  const data = await trafficFetch<{
    items: TrafficEventDto[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/v1/traffic/events?clickId=${encodeURIComponent(clickId)}`);
  return data.items ?? [];
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export async function getProvenance(
  conversionId: string
): Promise<ProvenanceReport> {
  return trafficFetch<ProvenanceReport>(
    `/api/v1/traffic/provenance/${encodeURIComponent(conversionId)}`
  );
}

// ---------------------------------------------------------------------------
// Audit report
// ---------------------------------------------------------------------------

export async function getAuditReport(
  params: AuditReportParams = {}
): Promise<AuditReport> {
  const qs = new URLSearchParams();
  if (params.merchantId) qs.set("merchantId", params.merchantId);
  if (params.offerId) qs.set("offerId", params.offerId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();
  return trafficFetch<AuditReport>(
    `/api/v1/traffic/audit-report${query ? `?${query}` : ""}`
  );
}
