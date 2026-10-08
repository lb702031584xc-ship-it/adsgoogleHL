"use server";

/**
 * AI analysis server actions: thin wrappers returning {ok, data} | {ok:false, error}.
 * Never logs API keys or tokens.
 */
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  AiApiError,
  analyzeOffer,
  analyzeTerms,
  checkUrls,
  getAiSettings,
  getAnalysis,
  listAnalyses,
  saveAiSettings,
  screenOffers,
  type AiAnalysis,
  type AiAnalysisSummary,
  type AiScreenItemInput,
  type AiScreenResponse,
  type AiSettings,
  type AiTermsResult,
  type AiUrlCheckResponse,
  type AnalyzeInput,
  type SaveSettingsInput,
} from "./ai";

export type AiActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export async function analyzeOfferAction(
  input: Omit<AnalyzeInput, "language">
): Promise<AiActionResult<AiAnalysis>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await analyzeOffer({ ...input, language: lang });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof AiApiError && e.code === "AI_NOT_CONFIGURED") {
      return {
        ok: false,
        error: t.ai.analyze.form.notConfigured,
        code: "AI_NOT_CONFIGURED",
      };
    }
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.analyze.form.failed,
    };
  }
}

export async function listAnalysesAction(): Promise<
  AiActionResult<AiAnalysisSummary[]>
> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    return { ok: true, data: await listAnalyses() };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.analyze.form.failed,
    };
  }
}

export async function getAnalysisAction(
  id: string
): Promise<AiActionResult<AiAnalysis>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    return { ok: true, data: await getAnalysis(id) };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.detail.loadError,
    };
  }
}

export async function getAiSettingsAction(): Promise<
  AiActionResult<AiSettings>
> {
  try {
    return { ok: true, data: await getAiSettings() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "failed",
    };
  }
}

export async function saveAiSettingsAction(
  input: SaveSettingsInput
): Promise<AiActionResult<{ ok: boolean; configured: boolean }>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    return { ok: true, data: await saveAiSettings(input) };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message
          ? e.message
          : t.ai.admin.settings.saveFailed,
    };
  }
}

function mapAiActionError(
  e: unknown,
  t: ReturnType<typeof getDictionary>,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof AiApiError && e.code === "AI_NOT_CONFIGURED") {
    return {
      ok: false,
      error: t.ai.analyze.form.notConfigured,
      code: "AI_NOT_CONFIGURED",
    };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

export async function analyzeTermsAction(
  text: string
): Promise<AiActionResult<AiTermsResult>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await analyzeTerms(text, lang);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, t.ai.terms.failed);
  }
}

export async function screenOffersAction(
  items: AiScreenItemInput[]
): Promise<AiActionResult<AiScreenResponse>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await screenOffers(items, lang);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, t.ai.terms.failed);
  }
}

export async function checkUrlsAction(
  urls: string[],
  ownedDomains?: string[]
): Promise<AiActionResult<AiUrlCheckResponse>> {
  const lang = await getLang();
  const t = getDictionary(lang);
  try {
    const data = await checkUrls(urls, ownedDomains);
    return { ok: true, data };
  } catch (e) {
    return mapAiActionError(e, t, t.ai.compliance.failed);
  }
}
