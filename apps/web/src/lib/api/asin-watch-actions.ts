"use server";

/**
 * ASIN 需求异动监控（第十批）server actions.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface AsinWatchItem {
  id: string;
  asin: string;
  title: string | null;
  createdAt: string;
  latest: {
    reviewCount: number | null;
    rating: number | null;
    price: number | null;
    capturedAt: string;
  } | null;
  growthPct: number | null;
  growthAbs: number | null;
  surged: boolean;
  surgeReason: string | null;
  snapshotCount: number;
}

export interface SurgeThresholds {
  growthPct: number;
  growthAbs: number;
}

export type AsinWatchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<AsinWatchResult<T>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...authHeaders },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `${fallback}（${res.status}）`;
    try {
      const b = (await res.json()) as { message?: string; error?: string };
      message = b.message ?? b.error ?? message;
    } catch {
      // 忽略解析失败
    }
    return { ok: false, error: message };
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "响应解析失败。" };
  }
}

export async function listAsinWatchesAction(): Promise<
  AsinWatchResult<{ items: AsinWatchItem[]; thresholds: SurgeThresholds }>
> {
  return callApi(
    "/api/v1/amazon/asin-watches",
    { method: "GET" },
    "获取跟踪列表失败。"
  );
}

export async function addAsinWatchAction(
  asin: string,
  title?: string
): Promise<AsinWatchResult<{ item: { id: string; asin: string } }>> {
  return callApi(
    "/api/v1/amazon/asin-watches",
    { method: "POST", body: JSON.stringify({ asin, title }) },
    "添加跟踪失败。"
  );
}

export async function deleteAsinWatchAction(
  id: string
): Promise<AsinWatchResult<{ deleted: boolean }>> {
  return callApi(
    `/api/v1/amazon/asin-watches/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "取消跟踪失败。"
  );
}

export async function saveWatchThresholdsAction(
  thresholds: Partial<SurgeThresholds>
): Promise<AsinWatchResult<{ thresholds: SurgeThresholds }>> {
  return callApi(
    "/api/v1/amazon/asin-watches/settings",
    { method: "PUT", body: JSON.stringify(thresholds) },
    "保存阈值失败。"
  );
}

export async function checkAsinWatchAction(): Promise<
  AsinWatchResult<{ snapshots: number; surges: number; alertsCreated: number }>
> {
  return callApi(
    "/api/v1/amazon/asin-watches/check",
    { method: "POST" },
    "手动检查失败。"
  );
}
