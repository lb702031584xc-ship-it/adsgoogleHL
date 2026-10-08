/**
 * Offer Intelligence API clients (server-side only).
 * Policy scan, risk score, profit model, simulation, decision, offer import,
 * merchants, and affiliate networks. Talks to the API with the forwarded
 * session cookie. Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class OfferIntelApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "OfferIntelApiError";
    this.status = status;
    this.code = code;
  }
}

async function intelFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new OfferIntelApiError(0, "network failure");
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
    throw new OfferIntelApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyVerdict = "ALLOWED" | "FORBIDDEN" | "REQUIRED" | "UNKNOWN";

export interface PolicyEvidence {
  id: string;
  rule: string;
  matchedText: string;
  confidence: number | null;
  sourceExcerpt: string | null;
}

export interface OfferPolicy {
  id: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  rules: Record<string, PolicyVerdict>;
  dataQuality: string | null;
}

export interface OfferPolicyResponse {
  policy: OfferPolicy | null;
  evidence: PolicyEvidence[];
}

export type DecisionValue = "RUN" | "TEST" | "MANUAL_REVIEW" | "DO_NOT_RUN";

export interface RiskScore {
  overallScore: number | null;
  policyScore: number | null;
  profitScore: number | null;
  merchantScore: number | null;
  trackingScore: number | null;
  decision: DecisionValue | null;
  evaluatedAt: string | null;
  dataQuality: string | null;
}

export interface ScenarioRow {
  cvr: number | null;
  cpc: number | null;
  clicks: number | null;
  profit: number | null;
}

export interface ScenarioTable {
  worst: ScenarioRow;
  base: ScenarioRow;
  best: ScenarioRow;
}

export interface ProfitModel {
  commission: number | null;
  commissionType: string | null;
  currency: string | null;
  expectedCvr: number | null;
  approvalRate: number | null;
  attributionRate: number | null;
  refundRate: number | null;
  scenarios: ScenarioTable | null;
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: string | null;
}

export interface OfferDecision {
  decision: DecisionValue;
  riskScore: number | null;
  profitScore: number | null;
  policyScore: number | null;
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  trafficMode: string;
  directLink: boolean;
  confidence: number | null;
  reason: string[];
  manualChecks: string[];
  dataQuality: string | null;
}

export interface Merchant {
  id: string;
  name: string;
  domain: string | null;
  riskScore: number | null;
  riskLevel: string | null;
  offerCount: number;
}

export interface AffiliateNetwork {
  id: string;
  name: string;
  website: string | null;
  apiConfigured: boolean;
  status: string;
}

export interface CreateMerchantInput {
  name: string;
  domain?: string;
  networkId?: string;
}

export interface CreateNetworkInput {
  name: string;
  website?: string;
}

export interface ImportOfferInput {
  name: string;
  network?: string;
  destinationUrl?: string;
  [key: string]: unknown;
}

export interface ImportOffersResult {
  created: number;
  offers: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function getOfferPolicy(
  offerId: string
): Promise<OfferPolicyResponse> {
  const data = await intelFetch<OfferPolicyResponse>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/policy`
  );
  return {
    policy: data.policy ?? null,
    evidence: data.evidence ?? [],
  };
}

export async function scanOfferPolicy(
  offerId: string
): Promise<{ policyId: string; rulesFound: number }> {
  return intelFetch<{ policyId: string; rulesFound: number }>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/scan`,
    { method: "POST" }
  );
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export async function getOfferRisk(offerId: string): Promise<RiskScore | null> {
  const data = await intelFetch<{ score: RiskScore | null }>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/risk`
  );
  return data.score ?? null;
}

// ---------------------------------------------------------------------------
// Profit
// ---------------------------------------------------------------------------

export async function getOfferProfit(
  offerId: string
): Promise<ProfitModel | null> {
  const data = await intelFetch<{ model: ProfitModel | null }>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/profit`
  );
  return data.model ?? null;
}

export interface SimulateInput {
  cpc: number;
  cvr: number;
  clicks?: number;
}

export async function simulateOffer(
  offerId: string,
  input: SimulateInput
): Promise<ScenarioTable> {
  const data = await intelFetch<{ scenarios: ScenarioTable }>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/simulate`,
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.scenarios;
}

// ---------------------------------------------------------------------------
// Decision / approve / pause
// ---------------------------------------------------------------------------

export async function requestOfferDecision(
  offerId: string
): Promise<OfferDecision> {
  return intelFetch<OfferDecision>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/decision`,
    { method: "POST" }
  );
}

export async function approveOffer(
  offerId: string,
  reason: string
): Promise<void> {
  await intelFetch<{ ok: boolean }>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/approve`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function pauseOffer(
  offerId: string,
  reason: string
): Promise<void> {
  await intelFetch<{ ok: boolean }>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/pause`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importOffers(
  body: { items: ImportOfferInput[] } | { csv: string }
): Promise<ImportOffersResult> {
  const data = await intelFetch<ImportOffersResult>(`/api/v1/offers/import`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    created: data.created ?? 0,
    offers: data.offers ?? [],
  };
}

// ---------------------------------------------------------------------------
// Merchants & networks
// ---------------------------------------------------------------------------

export async function listMerchants(): Promise<Merchant[]> {
  const data = await intelFetch<{ merchants: Merchant[] }>(`/api/v1/merchants`);
  return data.merchants ?? [];
}

export async function createMerchant(
  input: CreateMerchantInput
): Promise<Merchant> {
  const data = await intelFetch<{ merchant: Merchant }>(`/api/v1/merchants`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.merchant;
}

export async function listNetworks(): Promise<AffiliateNetwork[]> {
  const data = await intelFetch<{ networks: AffiliateNetwork[] }>(
    `/api/v1/networks`
  );
  return data.networks ?? [];
}

export async function createNetwork(
  input: CreateNetworkInput
): Promise<AffiliateNetwork> {
  const data = await intelFetch<{ network: AffiliateNetwork }>(
    `/api/v1/networks`,
    { method: "POST", body: JSON.stringify(input) }
  );
  return data.network;
}
