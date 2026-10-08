/**
 * Phase 3 budget recommendation API client (no "use server" — safe to hold
 * the error class and fetch helper here).
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export type BudgetDataQuality = "OBSERVED" | "PREDICTED" | "UNKNOWN";

export interface BudgetRecommendation {
  dailyBudget: number | null;
  totalTestBudget: number | null;
  budgetByScenario: {
    worst: number | null;
    base: number | null;
    best: number | null;
  };
  breakEvenCpc: number | null;
  recommendedMaxCpc: number | null;
  dataQuality: BudgetDataQuality;
  reason: string[];
  currency: string | null;
}

export class BudgetApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "BudgetApiError";
    this.status = status;
    this.code = code;
  }
}

async function budgetFetch<T>(path: string): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { ...authHeaders },
      cache: "no-store",
    });
  } catch {
    throw new BudgetApiError(0, "network failure");
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
    throw new BudgetApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

/** Fetch the budget recommendation for an offer. Throws BudgetApiError. */
export async function getOfferBudget(
  offerId: string
): Promise<BudgetRecommendation> {
  return budgetFetch<BudgetRecommendation>(
    `/api/v1/offers/${encodeURIComponent(offerId)}/budget-recommendation`
  );
}
