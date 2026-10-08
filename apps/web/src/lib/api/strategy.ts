/**
 * Strategy API clients (server-side only).
 * Full-chain orchestration output and the campaign plan document.
 * Talks to the API with the forwarded session cookie. Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class StrategyApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "StrategyApiError";
    this.status = status;
    this.code = code;
  }
}

async function strategyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new StrategyApiError(0, "network failure");
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
    throw new StrategyApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types (mirror apps/api/src/ai/orchestrator.ts)
// ---------------------------------------------------------------------------

export type StrategyDecisionValue =
  | "RUN"
  | "TEST"
  | "MANUAL_REVIEW"
  | "DO_NOT_RUN";

export interface StrategyDecision {
  decision: StrategyDecisionValue;
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
  dataQuality: string;
}

export interface ResearchResult {
  status: "OK" | "NO_DATA";
  score: number | null;
  band: string | null;
  classification: string | null;
  summary: string;
  findingId?: string;
}

export interface StrategyTraffic {
  clicks: number;
  conversions: number;
  cvrPct: number | null;
  epc: number;
  windowDays: number;
  topGeo: Array<{ value: string; count: number }>;
  topDevice: Array<{ value: string; count: number }>;
  dataQuality: string;
}

export interface StrategyExperiment {
  id: string;
  name: string;
  status: string;
  winner: string | null;
}

export interface StrategyKillSwitch {
  config: {
    enabled: boolean;
    maxSpend: number | null;
    minExpectedProfit: number | null;
    minCvr: number | null;
    maxPolicyRisk: number | null;
  } | null;
  recentEvents: Array<{
    id: string;
    triggeredBy: string;
    actionTaken: string;
    linksPaused: number;
    createdAt: string | null;
  }>;
}

export interface PlanKeyword {
  text: string;
  matchType: "EXACT" | "PHRASE";
  suggestedBid: number | null;
  dataQuality: string;
}

export interface PlanAdGroup {
  name: string;
  matchType: "EXACT" | "PHRASE";
  keywords: PlanKeyword[];
}

export interface PlanCampaign {
  name: string;
  trafficMode: string;
  adGroups: PlanAdGroup[];
}

export interface CampaignPlan {
  offerId: string;
  offerName: string;
  trafficMode: string;
  campaigns: PlanCampaign[];
  negatives: { exact: string[]; phrase: string[]; dataQuality: string };
  budget: {
    dailyBudget: number | null;
    totalTestBudget: number | null;
    budgetByScenario: {
      worst: number | null;
      base: number | null;
      best: number | null;
    };
    breakEvenCpc: number | null;
    recommendedMaxCpc: number | null;
    dataQuality: string;
    reason: string[];
    currency: string | null;
  };
  notes: string[];
  dataQuality: string;
  generatedAt: string;
}

export interface ScaleRecommendation {
  eligible: boolean;
  multiplier: number | null;
  currentDailyBudget: number | null;
  suggestedDailyBudget: number | null;
  reason: string[];
  dataQuality: string;
  note: string;
}

export interface StrategyOutput {
  offerId: string;
  offerName: string;
  decision: StrategyDecision;
  research: ResearchResult;
  traffic: StrategyTraffic;
  experiments: StrategyExperiment[];
  killSwitch: StrategyKillSwitch;
  campaignPlan: CampaignPlan;
  scaleRecommendation: ScaleRecommendation | null;
  generatedAt: string;
}

/** POST /api/v1/offers/:id/strategy — full-chain orchestration. */
export async function runStrategy(offerId: string): Promise<StrategyOutput> {
  return strategyFetch<StrategyOutput>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/strategy`,
    { method: "POST" }
  );
}

/** GET /api/v1/offers/:id/campaign-plan — plan document JSON. */
export async function getCampaignPlan(offerId: string): Promise<CampaignPlan> {
  return strategyFetch<CampaignPlan>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/campaign-plan`
  );
}
