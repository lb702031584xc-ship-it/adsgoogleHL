"use server";

/**
 * 自动化套件 2/5 — 搜索词自动否词 server actions.
 * Thin wrappers around the search-terms API with the forwarded session
 * cookie. Never import @/lib/api/entities here (server-only module that
 * uses next/headers) — this file builds its own fetch on sessionHeaders.
 */
import { revalidatePath } from "next/cache";
import { getLang } from "@/i18n/lang";
import { en as stEn, zh as stZh } from "@/i18n/dict/search-terms";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface SearchTermSuggestionDto {
  id: string;
  searchTerm: string;
  campaignName: string | null;
  suggestedAction: "ADD_NEGATIVE_EXACT" | "ADD_NEGATIVE_PHRASE" | "IGNORE";
  reason: string | null;
  status: "PENDING" | "APPLIED" | "DISMISSED";
}

export interface SearchTermListDto {
  items: SearchTermSuggestionDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type SearchTermActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

class SearchTermApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SearchTermApiError";
    this.status = status;
  }
}

async function searchTermFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
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
    throw new SearchTermApiError(0, "无法连接到 API 服务");
  }
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new SearchTermApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function t() {
  return (await getLang()) === "zh" ? stZh : stEn;
}

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<SearchTermActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    const d = await t();
    if (error instanceof SearchTermApiError) {
      const msg =
        error.status === 400 && /AI_NOT_CONFIGURED/.test(error.message)
          ? d.panel.aiNotConfigured
          : error.message;
      return { ok: false, error: msg };
    }
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : d.list.loadFailed,
    };
  }
}

export async function analyzeSearchTermsAction(
  text: string,
  campaignName?: string
): Promise<
  SearchTermActionResult<{ analyzed: number; suggestions: SearchTermSuggestionDto[] }>
> {
  return attempt(
    () =>
      searchTermFetch<{ analyzed: number; suggestions: SearchTermSuggestionDto[] }>(
        "/api/v1/search-terms/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            text,
            ...(campaignName?.trim() ? { campaignName: campaignName.trim() } : {}),
          }),
        }
      ),
    ["/search-terms"]
  );
}

export async function applySuggestionAction(
  id: string
): Promise<
  SearchTermActionResult<{
    suggestion: SearchTermSuggestionDto;
    negativeText: string | null;
    taskId: string | null;
    deduped: boolean;
  }>
> {
  return attempt(
    () =>
      searchTermFetch<{
        suggestion: SearchTermSuggestionDto;
        negativeText: string | null;
        taskId: string | null;
        deduped: boolean;
      }>(`/api/v1/search-terms/${encodeURIComponent(id)}/apply`, {
        method: "POST",
      }),
    ["/search-terms"]
  );
}

export async function dismissSuggestionAction(
  id: string
): Promise<SearchTermActionResult<{ suggestion: SearchTermSuggestionDto }>> {
  return attempt(
    () =>
      searchTermFetch<{ suggestion: SearchTermSuggestionDto }>(
        `/api/v1/search-terms/${encodeURIComponent(id)}/dismiss`,
        { method: "POST" }
      ),
    ["/search-terms"]
  );
}

export async function listSuggestionsAction(
  status?: "PENDING" | "APPLIED" | "DISMISSED",
  page = 1,
  pageSize = 20
): Promise<SearchTermActionResult<SearchTermListDto>> {
  const d = await t();
  try {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    const data = await searchTermFetch<SearchTermListDto>(
      `/api/v1/search-terms?${qs.toString()}`
    );
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : d.list.loadFailed,
    };
  }
}
