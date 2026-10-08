"use server";

/**
 * Traffic Intelligence server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Never logs secrets.
 */
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  TrafficIntelApiError,
  getAuditReport,
  getEventChain,
  getProvenance,
  type AuditReport,
  type AuditReportParams,
  type ProvenanceReport,
  type TrafficEventDto,
} from "./traffic-intel";

export type TrafficIntelActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof TrafficIntelApiError) {
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
  return (await getDictionary(await getLang())).ai.intel.traffic;
}

export async function getEventChainAction(
  clickId: string
): Promise<TrafficIntelActionResult<TrafficEventDto[]>> {
  const d = await t();
  try {
    return { ok: true, data: await getEventChain(clickId) };
  } catch (e) {
    return mapError(e, d.chainLoadFailed);
  }
}

export async function getProvenanceAction(
  conversionId: string
): Promise<TrafficIntelActionResult<ProvenanceReport>> {
  const d = await t();
  try {
    return { ok: true, data: await getProvenance(conversionId) };
  } catch (e) {
    return mapError(e, d.provenance.loadFailed);
  }
}

export async function getAuditReportAction(
  params: AuditReportParams
): Promise<TrafficIntelActionResult<AuditReport>> {
  const d = await t();
  try {
    return { ok: true, data: await getAuditReport(params) };
  } catch (e) {
    return mapError(e, d.audit.loadFailed);
  }
}
