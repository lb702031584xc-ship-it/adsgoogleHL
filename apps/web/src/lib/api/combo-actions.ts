"use server";

/**
 * 组合测试（第九批）server actions.
 *
 * 后端契约：
 *   POST /api/v1/amazon/combo-tests → { runId, name, testDays, targetClicks, items, htmlContent, createdAt }
 *   GET  /api/v1/amazon/combo-tests → { items: [{id,name,testDays,targetClicks,status,totalClicks,itemCount,createdAt}] }
 *   GET  /api/v1/amazon/combo-tests/:id → 详情 + ranking + conclusion + htmlContent
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface ComboTestProductInput {
  asin?: string;
  title: string;
  brand?: string;
  detailPageUrl?: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
}

export interface ComboTestItem extends ComboTestProductInput {
  offerId: string;
  trackingLinkId: string;
  publicId: string;
  clickUrl: string;
}

export interface ComboTestSummary {
  id: string;
  name: string;
  testDays: number;
  targetClicks: number;
  status: "running" | "completed";
  totalClicks: number;
  itemCount: number;
  createdAt: string;
}

export interface ComboRankRow {
  asin?: string;
  title: string;
  publicId: string;
  offerId: string;
  clicks: number;
  conversions: number;
  sharePct: number;
  rank: number;
}

export interface ComboTestDetail {
  id: string;
  name: string;
  testDays: number;
  targetClicks: number;
  status: "running" | "completed";
  totalClicks: number;
  daysElapsed: number;
  ranking: ComboRankRow[];
  conclusion: string | null;
  htmlContent: string | null;
  createdAt: string;
}

export type ComboActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<ComboActionResult<T>> {
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

export async function createComboTestAction(input: {
  items: ComboTestProductInput[];
  name?: string;
  testDays?: number;
  targetClicks?: number;
}): Promise<
  ComboActionResult<{
    runId: string;
    name: string;
    testDays: number;
    targetClicks: number;
    items: ComboTestItem[];
    htmlContent: string;
    createdAt: string;
  }>
> {
  return callApi(
    "/api/v1/amazon/combo-tests",
    { method: "POST", body: JSON.stringify(input) },
    "生成组合测试页失败。"
  );
}

export async function listComboTestsAction(): Promise<
  ComboActionResult<{ items: ComboTestSummary[] }>
> {
  return callApi(
    "/api/v1/amazon/combo-tests",
    { method: "GET" },
    "获取组合测试列表失败。"
  );
}

export async function getComboTestAction(
  id: string
): Promise<ComboActionResult<ComboTestDetail>> {
  return callApi(
    `/api/v1/amazon/combo-tests/${encodeURIComponent(id)}`,
    { method: "GET" },
    "获取组合测试详情失败。"
  );
}
