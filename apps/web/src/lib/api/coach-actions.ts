"use server";

/**
 * 教练模式（第十三批）server actions.
 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface CoachFinding {
  rule: "brand_keyword" | "disclosure" | "marketplace_target" | "budget_limit";
  kind: "block" | "confirm";
  code: string;
  params: Record<string, string>;
}

export interface CoachSettings {
  enabled: boolean;
  dailyBudgetLimit: number | null;
}

export type CoachResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<CoachResult<T>> {
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

export async function getCoachSettingsAction(): Promise<
  CoachResult<CoachSettings>
> {
  return callApi<CoachSettings>("/api/v1/coach/settings", { method: "GET" }, "无法加载教练设置");
}

export async function saveCoachSettingsAction(input: {
  enabled?: boolean;
  dailyBudgetLimit?: number | null;
}): Promise<CoachResult<CoachSettings>> {
  return callApi<CoachSettings>(
    "/api/v1/coach/settings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "保存失败"
  );
}

export async function coachCheckAction(input: {
  keywords?: string[];
  brandTerms?: string[];
  content?: string;
  url?: string;
  dailyBudget?: number;
}): Promise<CoachResult<{ enabled: boolean; findings: CoachFinding[] }>> {
  return callApi<{ enabled: boolean; findings: CoachFinding[] }>(
    "/api/v1/coach/check",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "教练检查失败"
  );
}
