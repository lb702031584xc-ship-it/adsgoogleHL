"use server";

/**
 * 选品流水线（/amazon/pipeline）server actions.
 *
 * 后端契约：
 * - POST /api/v1/amazon/pipeline/run { items[1-10], options?, name? }
 *   → { runId, createdAt, items: [{ input, gates, worthIndex, killed }], weights, evaluatedAt }
 * - GET  /api/v1/amazon/pipeline/runs?page=&pageSize=
 * - GET  /api/v1/amazon/pipeline/runs/:id
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export type GateStatus = "pass" | "fail" | "unknown";

export interface PipelineGate {
  key: "quality" | "demand" | "metrics" | "profit" | "risk";
  status: GateStatus;
  score: number;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface PipelineItemResult {
  input: {
    asin?: string;
    title: string;
    brand?: string;
    detailPageUrl?: string;
    price?: number;
    rating?: number;
    reviewCount?: number;
    manualMonthlyVisits?: number;
    opportunity?: boolean;
  };
  gates: PipelineGate[];
  worthIndex: number;
  killed: boolean;
}

export interface PipelineRunResponse {
  runId: string;
  createdAt: string;
  items: PipelineItemResult[];
  weights: Record<string, number>;
  evaluatedAt: string;
}

export interface PipelineRunSummary {
  id: string;
  name: string | null;
  itemCount: number;
  createdAt: string;
}

export interface PipelineOptions {
  minRating?: number;
  minReviews?: number;
  minMetricsScore?: number;
  estimatedCpc?: number;
  commission?: number;
  maxBreakEvenCvrPct?: number;
  riskCheck?: boolean;
  country?: string;
  /** 否定清单内置规则开关（默认 true） */
  denyLowRating?: boolean;
  denyBrandWord?: boolean;
  denyPolicyCategory?: boolean;
}

export type PipelineActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<PipelineActionResult<T>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // 忽略
    }
    return { ok: false, error: message };
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: fallback };
  }
}

export async function runPipelineAction(
  items: Array<Record<string, unknown>>,
  options: PipelineOptions,
  name?: string
): Promise<PipelineActionResult<PipelineRunResponse>> {
  return callApi<PipelineRunResponse>(
    "/api/v1/amazon/pipeline/run",
    { method: "POST", body: JSON.stringify({ items, options, name }) },
    "流水线评估失败。"
  );
}

export async function listPipelineRunsAction(
  page = 1,
  pageSize = 20
): Promise<
  PipelineActionResult<{
    items: PipelineRunSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>
> {
  return callApi(
    `/api/v1/amazon/pipeline/runs?page=${page}&pageSize=${pageSize}`,
    { method: "GET" },
    "获取历史运行失败。"
  );
}

export async function getPipelineRunAction(
  id: string
): Promise<
  PipelineActionResult<{
    id: string;
    name: string | null;
    itemCount: number;
    options: PipelineOptions;
    results: { items: PipelineItemResult[]; weights: Record<string, number>; evaluatedAt: string };
    createdAt: string;
  }>
> {
  return callApi(
    `/api/v1/amazon/pipeline/runs/${encodeURIComponent(id)}`,
    { method: "GET" },
    "获取运行详情失败。"
  );
}

/* ---------------- 否定清单（批次5追加） ---------------- */

export interface DenylistEntry {
  id: string;
  type: "asin" | "keyword" | "brand" | "category";
  value: string;
  reason: string | null;
  createdAt: string;
}

export async function listDenylistAction(): Promise<
  PipelineActionResult<{ items: DenylistEntry[] }>
> {
  return callApi(
    "/api/v1/amazon/pipeline/denylist",
    { method: "GET" },
    "获取别碰清单失败。"
  );
}

export async function addDenylistAction(input: {
  type: string;
  value: string;
  reason?: string;
}): Promise<PipelineActionResult<{ item: DenylistEntry }>> {
  return callApi(
    "/api/v1/amazon/pipeline/denylist",
    { method: "POST", body: JSON.stringify(input) },
    "添加失败。"
  );
}

export async function deleteDenylistAction(
  id: string
): Promise<PipelineActionResult<{ deleted: boolean }>> {
  return callApi(
    `/api/v1/amazon/pipeline/denylist/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "删除失败。"
  );
}
