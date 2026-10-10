"use server";

/**
 * 首单仪表盘（第十五批）server actions.
 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface FirstWinData {
  clicks: number;
  manualSpend: number;
  estimatedConversions: number;
  estimatedCvrPct: number;
  clicksToFirstOrder: number;
  progressPct: number;
  firstOrderDone: boolean;
}

export type FirstWinResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<FirstWinResult<T>> {
  try {
    const r = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers: { ...(await sessionHeaders()), ...(init.headers ?? {}) },
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, error: fallback };
  }
}

export async function getFirstWinAction(): Promise<FirstWinResult<FirstWinData>> {
  return callApi<FirstWinData>("/api/v1/first-win", { method: "GET" }, "无法加载首单数据");
}

export async function saveManualSpendAction(
  total: number
): Promise<FirstWinResult<FirstWinData>> {
  return callApi<FirstWinData>(
    "/api/v1/first-win/spend",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total }),
    },
    "保存失败"
  );
}
