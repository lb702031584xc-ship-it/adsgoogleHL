"use server";

/**
 * Research Lab API clients (server actions).
 * Talks to /api/v1/research/tests/* with the forwarded session cookie.
 * Never logs secrets.
 *
 * Contract (Phase 4 API, apps/api/src/routes/research.ts):
 *   GET  /api/v1/research/tests            -> { items, total, page, pageSize }
 *   POST /api/v1/research/tests            -> test DTO
 *   GET  /api/v1/research/tests/:id        -> { ...test, responses }
 *   POST /api/v1/research/tests/:id/run   -> { test, responses, finding }
 *   GET  /api/v1/research/tests/:id/finding -> finding DTO (404 when never ran)
 */
import { zh, en } from "@/i18n/dict/research";
import { getLang } from "@/i18n/lang";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

class ResearchApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ResearchApiError";
    this.status = status;
    this.code = code;
  }
}

export type ResearchTestStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export type ResearchBand =
  | "NORMAL"
  | "MINOR"
  | "SUSPICIOUS"
  | "HIGH_RISK"
  | "STRONG";

export type ResearchVariantPreset =
  | "DEFAULT"
  | "BOT_VS_HUMAN"
  | "GEO_VARIANTS"
  | "DEVICE_VARIANTS";

export interface ResearchRequestVariant {
  name: string;
  userAgent: string;
  acceptLanguage: string;
  headers?: Record<string, string>;
}

export interface ResearchResponseDto {
  id: string;
  researchTestId: string;
  variantName: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: Array<{ url: string; status: number }>;
  contentHash: string | null;
  textExcerpt: string | null;
  meta: Record<string, unknown>;
  fetchedAt: string | null;
}

export interface ResearchFindingDto {
  id: string;
  researchTestId: string;
  offerId: string | null;
  differentialScore: number;
  band: string;
  classification: string;
  evidence: unknown;
  aiSummary: string | null;
  createdAt: string | null;
}

export interface ResearchTestDto {
  id: string;
  tenantId: string;
  targetUrl: string;
  name: string;
  status: ResearchTestStatus;
  variants: ResearchRequestVariant[];
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Test with its latest-run responses and finding (null when never ran). */
export interface ResearchTestDetail extends ResearchTestDto {
  responses: ResearchResponseDto[];
  finding: ResearchFindingDto | null;
}

export interface ResearchTestSummary extends ResearchTestDto {
  score: number | null;
  band: ResearchBand | null;
}

export interface ResearchTestListResult {
  items: ResearchTestSummary[];
  total: number;
}

export interface CreateResearchTestInput {
  targetUrl: string;
  name?: string;
  variantPreset: ResearchVariantPreset;
  /** Raw variant configs; overrides the preset when given. */
  variants?: ResearchRequestVariant[];
}

const RESEARCH_BANDS: ResearchBand[] = [
  "NORMAL",
  "MINOR",
  "SUSPICIOUS",
  "HIGH_RISK",
  "STRONG",
];

function normBand(v: unknown): ResearchBand | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (RESEARCH_BANDS as string[]).includes(s) ? (s as ResearchBand) : null;
}

function normScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

function withFinding(
  test: ResearchTestDto,
  finding: ResearchFindingDto | null
): ResearchTestSummary {
  return {
    ...test,
    score: finding ? normScore(finding.differentialScore) : null,
    band: finding ? normBand(finding.band) : null,
  };
}

async function researchFetch<T>(
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
    throw new ResearchApiError(0, "network failure");
  }
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
    throw new ResearchApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Latest finding for a test; null when the test never ran (404). */
async function fetchFinding(
  testId: string
): Promise<ResearchFindingDto | null> {
  try {
    return await researchFetch<ResearchFindingDto>(
      `/api/v1/research/tests/${encodeURIComponent(testId)}/finding`
    );
  } catch (e) {
    if (e instanceof ResearchApiError && e.status === 404) return null;
    throw e;
  }
}

export type ResearchActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof ResearchApiError) {
    return { ok: false, error: e.message, code: e.code };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function t() {
  return (await getLang()) === "en" ? en : zh;
}

export async function listResearchTestsAction(): Promise<
  ResearchActionResult<ResearchTestListResult>
> {
  const d = await t();
  try {
    const page = await researchFetch<{
      items: ResearchTestDto[];
      total: number;
    }>("/api/v1/research/tests?pageSize=50");
    // The list DTO carries no finding; enrich per test (404 -> no finding).
    const items = await Promise.all(
      page.items.map(async (item) => {
        let finding: ResearchFindingDto | null = null;
        try {
          finding = await fetchFinding(item.id);
        } catch {
          finding = null;
        }
        return withFinding(item, finding);
      })
    );
    return { ok: true, data: { items, total: page.total } };
  } catch (e) {
    return mapError(e, d.list.loadFailed);
  }
}

export async function createResearchTestAction(
  input: CreateResearchTestInput
): Promise<ResearchActionResult<ResearchTestDetail>> {
  const d = await t();
  try {
    const body: Record<string, unknown> = {
      targetUrl: input.targetUrl,
    };
    if (input.name) body.name = input.name;
    if (input.variants) body.variants = input.variants;
    // DEFAULT preset: omit variants -> API uses its desktop/mobile x US/DE set.
    const test = await researchFetch<ResearchTestDto>(
      "/api/v1/research/tests",
      { method: "POST", body: JSON.stringify(body) }
    );
    return {
      ok: true,
      data: { ...test, responses: [], finding: null },
    };
  } catch (e) {
    return mapError(e, d.form.createFailed);
  }
}

export async function getResearchTestAction(
  id: string
): Promise<ResearchActionResult<ResearchTestDetail>> {
  const d = await t();
  try {
    const test = await researchFetch<
      ResearchTestDto & { responses: ResearchResponseDto[] }
    >(`/api/v1/research/tests/${encodeURIComponent(id)}`);
    const finding = await fetchFinding(id);
    return {
      ok: true,
      data: { ...test, finding },
    };
  } catch (e) {
    return mapError(e, d.detail.loadFailed);
  }
}

export async function rerunResearchTestAction(
  id: string
): Promise<ResearchActionResult<ResearchTestDetail>> {
  const d = await t();
  try {
    const result = await researchFetch<{
      test: ResearchTestDto;
      responses: ResearchResponseDto[];
      finding: ResearchFindingDto | null;
    }>(`/api/v1/research/tests/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
    return {
      ok: true,
      data: { ...result.test, responses: result.responses, finding: result.finding },
    };
  } catch (e) {
    return mapError(e, d.detail.rerunFailed);
  }
}
