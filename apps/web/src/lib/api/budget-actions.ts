"use server";

/**
 * Phase 3 budget recommendation server action.
 * Thin wrapper returning {ok, data} | {ok:false, error}. Never logs secrets.
 */
import {
  BudgetApiError,
  getOfferBudget,
  type BudgetRecommendation,
} from "./budget";

export type { BudgetDataQuality, BudgetRecommendation } from "./budget";

export type BudgetActionResult =
  | { ok: true; data: BudgetRecommendation }
  | { ok: false; error: string; code?: string };

export async function getOfferBudgetAction(
  offerId: string
): Promise<BudgetActionResult> {
  try {
    const data = await getOfferBudget(offerId);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof BudgetApiError) {
      return { ok: false, error: e.message, code: e.code };
    }
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}
