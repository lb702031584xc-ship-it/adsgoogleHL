/**
 * AI analysis API client (server-side only).
 * Talks to /api/v1/ai/* on the API with the forwarded session cookie.
 * Never logs API keys or tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class AiApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AiApiError";
    this.status = status;
    this.code = code;
  }
}

export interface AiProfitability {
  payout: number | null;
  payoutCurrency: string | null;
  estimatedCpc: number | null;
  breakEvenCvrPct: number | null;
}

export interface AiFinding {
  area: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface AiAnalysisReport {
  overallRisk: number;
  riskLevel: "low" | "medium" | "high";
  scores: {
    merchant: number;
    policy: number;
    network: number;
  };
  findings: AiFinding[];
  suggestions: string[];
  keywords: string[];
  adAngles: string[];
}

export interface AiAnalysis {
  id: string;
  merchant: string | null;
  network: string | null;
  language: string;
  profitability: AiProfitability;
  analysis: AiAnalysisReport;
  analyzedAt: string;
}

export interface AiAnalysisSummary {
  id: string;
  merchant: string | null;
  network: string | null;
  payout: number | null;
  payoutCurrency: string | null;
  overallRisk: number;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
}

export interface AiSettings {
  configured: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  ownedDomains: string[];
}

export interface AnalyzeInput {
  url?: string;
  text?: string;
  merchant?: string;
  network?: string;
  payout?: number;
  payoutCurrency?: string;
  estimatedCpc?: number;
  language?: string;
}

export interface SaveSettingsInput {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  ownedDomains?: string[];
}

export type RestrictionValue = "allowed" | "forbidden" | "restricted" | "unknown";

export interface AiTermsTraffic {
  search: RestrictionValue;
  display: RestrictionValue;
  email: RestrictionValue;
  social: RestrictionValue;
  incentivized: RestrictionValue;
}

export interface AiTermsRedFlag {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface AiTermsResult {
  id: string;
  language: string;
  terms: {
    overallVerdict: "go" | "caution" | "stop";
    traffic: AiTermsTraffic;
    brandBidding: RestrictionValue;
    directLinking: RestrictionValue;
    geoRestrictions: string[];
    caps: string | null;
    payoutTerms: string | null;
    redFlags: AiTermsRedFlag[];
    summary: string;
  };
  analyzedAt: string;
}

export interface AiScreenItemInput {
  name?: string;
  text: string;
}

export interface AiScreenResultItem {
  name: string;
  verdict: "go" | "caution" | "stop";
  keyRisks: string[];
  summary: string;
}

export interface AiScreenResponse {
  results: AiScreenResultItem[];
  analyzedAt: string;
}

export type UrlCheckVerdict =
  | "owned"
  | "affiliate_direct"
  | "suspicious"
  | "unknown";

export interface AiUrlCheckResult {
  inputUrl: string;
  finalUrl: string;
  finalDomain: string;
  isOwnedDomain: boolean;
  affiliateParams: string[];
  verdict: UrlCheckVerdict;
}

export interface AiUrlCheckResponse {
  results: AiUrlCheckResult[];
  ownedDomains: string[];
}

async function aiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new AiApiError(0, "network failure");
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
      // API serializes AppError as {error: <code>, message}; accept both shapes.
      code = body.code ?? body.error;
    } catch {
      /* ignore */
    }
    throw new AiApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Admin-only: read AI provider settings. */
export async function getAiSettings(): Promise<AiSettings> {
  return aiFetch<AiSettings>("/api/v1/ai/settings");
}

/** Admin-only: update AI provider settings. */
export async function saveAiSettings(
  input: SaveSettingsInput
): Promise<{ ok: boolean; configured: boolean }> {
  return aiFetch<{ ok: boolean; configured: boolean }>("/api/v1/ai/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Analyze an offer. Throws AiApiError with code "AI_NOT_CONFIGURED" (400) when unset. */
export async function analyzeOffer(input: AnalyzeInput): Promise<AiAnalysis> {
  return aiFetch<AiAnalysis>("/api/v1/ai/analyze", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** List recent analyses for the current tenant. */
export async function listAnalyses(): Promise<AiAnalysisSummary[]> {
  const data = await aiFetch<{ items: AiAnalysisSummary[] }>(
    "/api/v1/ai/analyses"
  );
  return data.items ?? [];
}

/** Fetch one full analysis record. */
export async function getAnalysis(id: string): Promise<AiAnalysis> {
  return aiFetch<AiAnalysis>(
    `/api/v1/ai/analyses/${encodeURIComponent(id)}`
  );
}

/** Parse offer terms into structured restrictions. Throws AiApiError with code "AI_NOT_CONFIGURED" (400) when unset. */
export async function analyzeTerms(
  text: string,
  language?: string
): Promise<AiTermsResult> {
  return aiFetch<AiTermsResult>("/api/v1/ai/analyze-terms", {
    method: "POST",
    body: JSON.stringify({ text, language }),
  });
}

/** Batch-screen up to 10 offers' terms, ranked go → caution → stop. */
export async function screenOffers(
  items: AiScreenItemInput[],
  language?: string
): Promise<AiScreenResponse> {
  return aiFetch<AiScreenResponse>("/api/v1/ai/screen-offers", {
    method: "POST",
    body: JSON.stringify({ items, language }),
  });
}

/** Check ad URLs for direct-link exposure. */
export async function checkUrls(
  urls: string[],
  ownedDomains?: string[]
): Promise<AiUrlCheckResponse> {
  return aiFetch<AiUrlCheckResponse>("/api/v1/ai/check-urls", {
    method: "POST",
    body: JSON.stringify({ urls, ownedDomains }),
  });
}

/** Profit analysis input: fixed commission or price × percentage ranges. */
export interface ProfitAnalysisInput {
  fixedAmount?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  commissionPctMin?: number | null;
  commissionPctMax?: number | null;
  currency?: string | null;
  assumedCvrPct?: number | null;
}

export interface BidSuggestion {
  level: "conservative" | "moderate" | "aggressive";
  maxCpc: number | null;
  fraction: number;
  note: string;
}

export interface ProfitScenario {
  cvrPct: number;
  profitPer100Clicks: number | null;
  verdict: "profit" | "loss" | "unknown";
}

export interface ProfitAnalysisResult {
  commission: {
    commissionMin: number | null;
    commissionMax: number | null;
    currency: string | null;
    method: "fixed" | "range" | "unknown";
  };
  breakEvenCpc: number | null;
  assumedCvrPct: number;
  bids: BidSuggestion[];
  scenarios: ProfitScenario[];
  currency: string | null;
}

/** Full profit analysis with bid suggestions (pure math, no LLM). */
export async function analyzeProfit(
  input: ProfitAnalysisInput
): Promise<{ analysis: ProfitAnalysisResult }> {
  return aiFetch<{ analysis: ProfitAnalysisResult }>(
    "/api/v1/ai/profit-analysis",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

/** Amazon 自动选品 */
export interface AmazonDiscoveryCriteria {
  keywords: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minRating?: number | null;
  minReviews?: number | null;
  region?: string;
  maxResults?: number;
}

import type { AmazonScoredProduct } from "./amazon-types";
export type { AmazonScoredProduct } from "./amazon-types";

export async function runAmazonDiscovery(
  criteria: AmazonDiscoveryCriteria
): Promise<{
  runId: string;
  products: AmazonScoredProduct[];
  totalFound: number;
  totalKept: number;
  errors: string[];
}> {
  return aiFetch<{
    runId: string;
    products: AmazonScoredProduct[];
    totalFound: number;
    totalKept: number;
    errors: string[];
  }>("/api/v1/amazon/discover", {
    method: "POST",
    body: JSON.stringify(criteria),
  });
}

export async function importAmazonProducts(
  runId: string,
  asins: string[]
): Promise<{ imported: Array<{ asin: string; offerId: string }>; count: number }> {
  return aiFetch<{ imported: Array<{ asin: string; offerId: string }>; count: number }>(
    `/api/v1/amazon/discoveries/${runId}/import`,
    {
      method: "POST",
      body: JSON.stringify({ asins }),
    }
  );
}
