"use server";

/**
 * Automation pack ③ — payout watch server actions.
 * Thin wrappers returning {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import type { P1ActionResult } from "./p1-actions";
import {
  PayoutWatchApiError,
  disablePayoutWatch,
  enablePayoutWatch,
  listOfferOptions,
  listPayoutWatches,
  type OfferOptionList,
  type PayoutWatchItem,
  type PayoutWatchList,
} from "./payout-watch";

export type {
  OfferOption,
  OfferOptionList,
  PayoutChangeEntry,
  PayoutWatchItem,
  PayoutWatchList,
} from "./payout-watch";

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof PayoutWatchApiError) {
    return { ok: false, error: e.message, code: e.code };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function fallback(): Promise<string> {
  const lang = await getLang();
  return lang === "en" ? "request failed" : "请求失败";
}

export async function listPayoutWatchesAction(): Promise<
  P1ActionResult<PayoutWatchList>
> {
  try {
    const data = await listPayoutWatches();
    return { ok: true, data };
  } catch (e) {
    return mapError(e, await fallback());
  }
}

export async function listOfferOptionsAction(): Promise<
  P1ActionResult<OfferOptionList>
> {
  try {
    const data = await listOfferOptions();
    return { ok: true, data };
  } catch (e) {
    return mapError(e, await fallback());
  }
}

export async function enablePayoutWatchAction(
  offerId: string
): Promise<P1ActionResult<{ ok: true; watch: PayoutWatchItem }>> {
  try {
    const data = await enablePayoutWatch(offerId);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, await fallback());
  }
}

export async function disablePayoutWatchAction(
  offerId: string
): Promise<P1ActionResult<{ ok: true; watch: PayoutWatchItem }>> {
  try {
    const data = await disablePayoutWatch(offerId);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, await fallback());
  }
}
