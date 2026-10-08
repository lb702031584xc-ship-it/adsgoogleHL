"use server";

/**
 * LP optimization queue server actions: thin wrappers returning
 * {ok, data} | {ok:false, error}. Session cookie is forwarded to the API
 * via sessionHeaders; nothing secret is logged or exposed to the browser.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface LpOptimizationTaskIssue {
  dimension?: string;
  severity?: string;
  message?: string;
}

export interface LpOptimizationTask {
  id: string;
  landingPageId: string;
  score: number;
  issues: LpOptimizationTaskIssue[];
  priority: "HIGH" | "MEDIUM" | "LOW";
  status: "PENDING" | "IN_PROGRESS" | "DONE";
  createdAt: string;
  completedAt: string | null;
  worstDimension: string;
  landingPage: {
    id: string;
    name: string;
    url: string;
    domain: string;
  } | null;
}

export type LpOptimizationActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

class LpOptimizationApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "LpOptimizationApiError";
    this.status = status;
    this.code = code;
  }
}

async function lpOptFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new LpOptimizationApiError(0, "无法连接到 API 服务");
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
    throw new LpOptimizationApiError(res.status, message);
  }
  return (await res.json()) as T;
}

function toActionError(e: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : "操作失败",
  };
}

export async function listLpOptimizationTasksAction(
  status?: "PENDING" | "IN_PROGRESS" | "DONE" | ""
): Promise<
  LpOptimizationActionResult<{ items: LpOptimizationTask[]; total: number }>
> {
  try {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await lpOptFetch<{ items: LpOptimizationTask[]; total: number }>(
      `/api/v1/lp-optimization-queue${qs}`
    );
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateLpOptimizationTaskStatusAction(
  id: string,
  status: "IN_PROGRESS" | "DONE"
): Promise<LpOptimizationActionResult<LpOptimizationTask>> {
  try {
    const data = await lpOptFetch<LpOptimizationTask>(
      `/api/v1/lp-optimization-queue/${id}`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
    revalidatePath("/landing-pages/optimization-queue");
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function archiveLpOptimizationTaskAction(
  id: string
): Promise<LpOptimizationActionResult<{ ok: true }>> {
  try {
    const data = await lpOptFetch<{ ok: true }>(
      `/api/v1/lp-optimization-queue/${id}`,
      { method: "DELETE" }
    );
    revalidatePath("/landing-pages/optimization-queue");
    return { ok: true, data };
  } catch (e) {
    return toActionError(e);
  }
}
