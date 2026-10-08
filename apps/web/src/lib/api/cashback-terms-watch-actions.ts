"use server";

/**
 * 功能 2 — terms-watch server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import {
  en as termsWatchEn,
  zh as termsWatchZh,
} from "@/i18n/dict/cashback-terms-watch";
import {
  TermsWatchApiError,
  checkTermsWatchNow,
  createTermsWatch,
  listTermsWatches,
  type CreateTermsWatchInput,
  type TermsWatch,
  type TermsWatchCheckResult,
} from "./cashback-terms-watch";

export type TermsWatchActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof TermsWatchApiError) {
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
  return (await getLang()) === "zh" ? termsWatchZh : termsWatchEn;
}

export async function listTermsWatchesAction(): Promise<
  TermsWatchActionResult<{ items: TermsWatch[] }>
> {
  const d = await t();
  try {
    return { ok: true as const, data: await listTermsWatches() };
  } catch (e) {
    return mapError(e, d.termsWatch.loadFailed);
  }
}

export async function createTermsWatchAction(
  input: CreateTermsWatchInput
): Promise<TermsWatchActionResult<{ watch: TermsWatch }>> {
  const d = await t();
  try {
    return { ok: true as const, data: await createTermsWatch(input) };
  } catch (e) {
    return mapError(e, d.termsWatch.loadFailed);
  }
}

export async function checkTermsWatchAction(
  id: string
): Promise<TermsWatchActionResult<{ result: TermsWatchCheckResult }>> {
  const d = await t();
  try {
    return { ok: true as const, data: await checkTermsWatchNow(id) };
  } catch (e) {
    return mapError(e, d.termsWatch.loadFailed);
  }
}
