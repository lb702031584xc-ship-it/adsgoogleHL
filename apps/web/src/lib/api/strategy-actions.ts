"use server";

/**
 * Strategy server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import { en, zh } from "@/i18n/dict/strategy";
import {
  StrategyApiError,
  getCampaignPlan,
  runStrategy,
  type CampaignPlan,
  type StrategyOutput,
} from "./strategy";

export type StrategyActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof StrategyApiError) {
    return {
      ok: false,
      error: e.message,
      code: e.code,
    };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function t() {
  return (await getLang()) === "en" ? en : zh;
}

export async function runStrategyAction(
  offerId: string
): Promise<StrategyActionResult<StrategyOutput>> {
  const d = await t();
  try {
    return { ok: true, data: await runStrategy(offerId) };
  } catch (e) {
    return mapError(e, d.page.failed);
  }
}

export async function getCampaignPlanAction(
  offerId: string
): Promise<StrategyActionResult<CampaignPlan>> {
  const d = await t();
  try {
    return { ok: true, data: await getCampaignPlan(offerId) };
  } catch (e) {
    return mapError(e, d.page.failed);
  }
}
