"use server";

/**
 * Offer Intelligence server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  OfferIntelApiError,
  approveOffer,
  createMerchant,
  createNetwork,
  getOfferPolicy,
  getOfferProfit,
  getOfferRisk,
  importOffers,
  listMerchants,
  listNetworks,
  pauseOffer,
  requestOfferDecision,
  scanOfferPolicy,
  simulateOffer,
  type AffiliateNetwork,
  type CreateMerchantInput,
  type CreateNetworkInput,
  type ImportOfferInput,
  type ImportOffersResult,
  type Merchant,
  type OfferDecision,
  type OfferPolicyResponse,
  type ProfitModel,
  type RiskScore,
  type ScenarioTable,
  type SimulateInput,
} from "./offer-intel";

export type OfferIntelActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof OfferIntelApiError) {
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
  return (await getDictionary(await getLang())).ai.intel;
}

export async function getOfferPolicyAction(
  offerId: string
): Promise<OfferIntelActionResult<OfferPolicyResponse>> {
  const d = await t();
  try {
    return { ok: true, data: await getOfferPolicy(offerId) };
  } catch (e) {
    return mapError(e, d.policy.loadFailed);
  }
}

export async function scanOfferPolicyAction(
  offerId: string
): Promise<OfferIntelActionResult<{ policyId: string; rulesFound: number }>> {
  const d = await t();
  try {
    return { ok: true, data: await scanOfferPolicy(offerId) };
  } catch (e) {
    return mapError(e, d.policy.rescanFailed);
  }
}

export async function getOfferRiskAction(
  offerId: string
): Promise<OfferIntelActionResult<RiskScore | null>> {
  const d = await t();
  try {
    return { ok: true, data: await getOfferRisk(offerId) };
  } catch (e) {
    return mapError(e, d.risk.loadFailed);
  }
}

export async function getOfferProfitAction(
  offerId: string
): Promise<OfferIntelActionResult<ProfitModel | null>> {
  const d = await t();
  try {
    return { ok: true, data: await getOfferProfit(offerId) };
  } catch (e) {
    return mapError(e, d.profit.loadFailed);
  }
}

export async function simulateOfferAction(
  offerId: string,
  input: SimulateInput
): Promise<OfferIntelActionResult<ScenarioTable>> {
  const d = await t();
  try {
    return { ok: true, data: await simulateOffer(offerId, input) };
  } catch (e) {
    return mapError(e, d.profit.simulateFailed);
  }
}

export async function requestOfferDecisionAction(
  offerId: string
): Promise<OfferIntelActionResult<OfferDecision>> {
  const d = await t();
  try {
    return { ok: true, data: await requestOfferDecision(offerId) };
  } catch (e) {
    return mapError(e, d.decision.failed);
  }
}

export async function approveOfferAction(
  offerId: string,
  reason: string
): Promise<OfferIntelActionResult<void>> {
  const d = await t();
  try {
    await approveOffer(offerId, reason);
    return { ok: true, data: undefined };
  } catch (e) {
    return mapError(e, d.decision.actionFailed);
  }
}

export async function pauseOfferAction(
  offerId: string,
  reason: string
): Promise<OfferIntelActionResult<void>> {
  const d = await t();
  try {
    await pauseOffer(offerId, reason);
    return { ok: true, data: undefined };
  } catch (e) {
    return mapError(e, d.decision.actionFailed);
  }
}

export async function importOffersAction(
  body: { items: ImportOfferInput[] } | { csv: string }
): Promise<OfferIntelActionResult<ImportOffersResult>> {
  const d = await t();
  try {
    return { ok: true, data: await importOffers(body) };
  } catch (e) {
    return mapError(e, d.import.importFailed);
  }
}

export async function listMerchantsAction(): Promise<
  OfferIntelActionResult<Merchant[]>
> {
  const d = await t();
  try {
    return { ok: true, data: await listMerchants() };
  } catch (e) {
    return mapError(e, d.merchants.loadFailed);
  }
}

export async function createMerchantAction(
  input: CreateMerchantInput
): Promise<OfferIntelActionResult<Merchant>> {
  const d = await t();
  try {
    return { ok: true, data: await createMerchant(input) };
  } catch (e) {
    return mapError(e, d.merchants.createFailed);
  }
}

export async function listNetworksAction(): Promise<
  OfferIntelActionResult<AffiliateNetwork[]>
> {
  const d = await t();
  try {
    return { ok: true, data: await listNetworks() };
  } catch (e) {
    return mapError(e, d.merchants.networksFailed);
  }
}

export async function createNetworkAction(
  input: CreateNetworkInput
): Promise<OfferIntelActionResult<AffiliateNetwork>> {
  const d = await t();
  try {
    return { ok: true, data: await createNetwork(input) };
  } catch (e) {
    return mapError(e, d.merchants.addNetworkFailed);
  }
}
