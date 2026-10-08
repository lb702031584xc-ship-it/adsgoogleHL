"use server";

/**
 * LP AI rewriter server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Session cookie is forwarded to the API
 * via sessionHeaders; nothing secret is logged or exposed to the browser.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface LpRewritePair {
  element: string;
  location: string;
  before: string;
  after: string;
  reason: string;
}

export interface LpRewriteItem {
  id: string;
  landingPageId: string;
  originalScore: number;
  issues: Array<{ dimension?: string; severity?: string; message?: string }>;
  rewrittenContent: {
    rewrites: LpRewritePair[];
    aiEstimatedNewScore?: number;
    appliedCount?: number;
    skipped?: Array<{ element: string; reason: string }>;
    originalBackup?: {
      htmlContent?: string;
      name?: string;
      appliedAt?: string;
      appliedCount?: number;
    };
  };
  newScore: number | null;
  status: "DRAFT" | "APPLIED" | string;
  createdAt: string;
}

export type LpRewriteActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

class LpRewriteApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "LpRewriteApiError";
    this.status = status;
    this.code = code;
  }
}

async function lpRewriteFetch<T>(
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
    throw new LpRewriteApiError(0, "无法连接到 API 服务");
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new LpRewriteApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function toActionError(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : "操作失败",
  };
}

/** Generate a rewrite draft for a landing page (issues optional). */
export async function createLpRewriteAction(
  landingPageId: string,
  issues?: Array<{ dimension?: string; severity?: string; message?: string }>
): Promise<LpRewriteActionResult<{ rewrite: LpRewriteItem }>> {
  try {
    const data = await lpRewriteFetch<{ rewrite: LpRewriteItem }>(
      `/api/v1/landing-pages/${encodeURIComponent(landingPageId)}/rewrite`,
      {
        method: "POST",
        body: JSON.stringify(issues ? { issues } : {}),
      }
    );
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

/** List rewrite history for a landing page. */
export async function listLpRewritesAction(
  landingPageId: string
): Promise<LpRewriteActionResult<{ items: LpRewriteItem[]; total: number }>> {
  try {
    const data = await lpRewriteFetch<{
      items: LpRewriteItem[];
      total: number;
    }>(`/api/v1/landing-pages/${encodeURIComponent(landingPageId)}/rewrites`);
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

/** Apply a DRAFT rewrite to its landing page (backs up the original first). */
export async function applyLpRewriteAction(
  rewriteId: string
): Promise<
  LpRewriteActionResult<{
    rewrite: LpRewriteItem;
    applied: number;
    skipped: Array<{ element: string; reason: string }>;
  }>
> {
  try {
    const data = await lpRewriteFetch<{
      rewrite: LpRewriteItem;
      applied: number;
      skipped: Array<{ element: string; reason: string }>;
    }>(`/api/v1/landing-pages/rewrites/${encodeURIComponent(rewriteId)}/apply`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    revalidatePath("/landing-pages/optimization-queue");
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
