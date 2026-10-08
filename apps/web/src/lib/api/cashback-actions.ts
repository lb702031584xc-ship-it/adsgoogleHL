"use server";

/**
 * Feature 3 — cashback server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import { en as cashbackEn, zh as cashbackZh } from "@/i18n/dict/cashback";
import { en as lpScoreEn, zh as lpScoreZh } from "@/i18n/dict/cashback-lp-score";
import {
  CashbackApiError,
  batchLpScores,
  closeAdsPowerBrowser,
  createCashbackOffer,
  createRotationGroup,
  deleteCashbackOffer,
  deleteRotationGroup,
  listAdsPowerProfiles,
  listCashbackOffers,
  listRotationGroups,
  openAdsPowerBrowser,
  rotateGroupNow,
  updateCashbackOffer,
  updateRotationGroup,
  type CreateCashbackOfferInput,
  type CreateRotationGroupInput,
  type LpScoreEntry,
  type RotateNowResult,
} from "./cashback";

export type CashbackActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof CashbackApiError) {
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
  return (await getLang()) === "zh" ? cashbackZh : cashbackEn;
}

export async function listCashbackOffersAction() {
  const d = await t();
  try {
    return {
      ok: true as const,
      data: await listCashbackOffers({ pageSize: 100 }),
    };
  } catch (e) {
    return mapError(e, d.offers.loadFailed);
  }
}

export async function createCashbackOfferAction(input: CreateCashbackOfferInput) {
  const d = await t();
  try {
    return { ok: true as const, data: await createCashbackOffer(input) };
  } catch (e) {
    return mapError(e, d.offers.loadFailed);
  }
}

export async function updateCashbackOfferAction(
  id: string,
  input: { status?: string; adspowerProfileId?: string | null }
) {
  const d = await t();
  try {
    return { ok: true as const, data: await updateCashbackOffer(id, input) };
  } catch (e) {
    return mapError(e, d.offers.loadFailed);
  }
}

export async function deleteCashbackOfferAction(id: string) {
  const d = await t();
  try {
    return { ok: true as const, data: await deleteCashbackOffer(id) };
  } catch (e) {
    return mapError(e, d.offers.loadFailed);
  }
}

export async function listAdsPowerProfilesAction() {
  const d = await t();
  try {
    return { ok: true as const, data: await listAdsPowerProfiles() };
  } catch (e) {
    return mapError(e, d.adspower.notConfigured);
  }
}

export async function openAdsPowerBrowserAction(profileId: string) {
  const d = await t();
  try {
    return { ok: true as const, data: await openAdsPowerBrowser(profileId) };
  } catch (e) {
    return mapError(e, d.adspower.notConfigured);
  }
}

export async function closeAdsPowerBrowserAction(profileId: string) {
  const d = await t();
  try {
    return { ok: true as const, data: await closeAdsPowerBrowser(profileId) };
  } catch (e) {
    return mapError(e, d.adspower.notConfigured);
  }
}

export async function listRotationGroupsAction() {
  const d = await t();
  try {
    return { ok: true as const, data: await listRotationGroups() };
  } catch (e) {
    return mapError(e, d.rotations.loadFailed);
  }
}

export async function createRotationGroupAction(input: CreateRotationGroupInput) {
  const d = await t();
  try {
    return { ok: true as const, data: await createRotationGroup(input) };
  } catch (e) {
    return mapError(e, d.rotations.loadFailed);
  }
}

export async function updateRotationGroupAction(
  id: string,
  input: { name?: string; strategy?: string; isActive?: boolean }
) {
  const d = await t();
  try {
    return { ok: true as const, data: await updateRotationGroup(id, input) };
  } catch (e) {
    return mapError(e, d.rotations.loadFailed);
  }
}

export async function deleteRotationGroupAction(id: string) {
  const d = await t();
  try {
    return { ok: true as const, data: await deleteRotationGroup(id) };
  } catch (e) {
    return mapError(e, d.rotations.loadFailed);
  }
}

export async function rotateGroupNowAction(
  id: string
): Promise<CashbackActionResult<{ result: RotateNowResult }>> {
  const d = await t();
  try {
    return { ok: true as const, data: await rotateGroupNow(id) };
  } catch (e) {
    return mapError(e, d.rotations.loadFailed);
  }
}

/**
 * Feature: 返利落地页合规评分 (lp-cashback-score).
 * Batch compliance scores keyed by tracking link id (null = no score).
 */
export async function batchLpScoresAction(
  trackingLinkIds: string[]
): Promise<CashbackActionResult<Record<string, LpScoreEntry | null>>> {
  const sd = ((await getLang()) === "zh" ? lpScoreZh : lpScoreEn).score;
  try {
    const res = await batchLpScores(trackingLinkIds);
    return { ok: true as const, data: res.scores };
  } catch (e) {
    return mapError(e, sd.loadFailed);
  }
}
