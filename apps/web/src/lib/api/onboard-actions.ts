"use server";

/**
 * 新手任务（第十二批）server actions.
 */
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface OnboardTaskItem {
  day: number;
  key: string;
  deepLink: string;
  done: boolean;
  autoDetected: boolean;
  manual: boolean;
  doneAt: string | null;
}

export interface OnboardTasksData {
  items: OnboardTaskItem[];
  doneCount: number;
  total: number;
  graduated: boolean;
}

export type OnboardResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<OnboardResult<T>> {
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

export async function listOnboardTasksAction(): Promise<
  OnboardResult<OnboardTasksData>
> {
  return callApi<OnboardTasksData>(
    "/api/v1/onboard/tasks",
    { method: "GET" },
    "无法加载任务列表"
  );
}

export async function markOnboardDoneAction(
  key: string
): Promise<OnboardResult<{ done: boolean }>> {
  return callApi<{ done: boolean }>(
    `/api/v1/onboard/tasks/${encodeURIComponent(key)}/done`,
    { method: "POST" },
    "标记失败"
  );
}

export interface SiteCheckItemDto {
  key: "disclosure" | "privacy" | "contact" | "articles";
  ok: boolean;
  url: string | null;
  detail: string;
}

export interface SiteCheckData {
  domain: string;
  items: SiteCheckItemDto[];
  articleCount: number;
  checkedAt: string;
}

export async function checkSiteReadinessAction(
  domain: string
): Promise<OnboardResult<SiteCheckData>> {
  return callApi<SiteCheckData>(
    "/api/v1/onboard/site-check",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    },
    "网站检查失败"
  );
}

export async function unmarkOnboardDoneAction(
  key: string
): Promise<OnboardResult<{ done: boolean }>> {
  return callApi<{ done: boolean }>(
    `/api/v1/onboard/tasks/${encodeURIComponent(key)}/undone`,
    { method: "POST" },
    "取消失败"
  );
}
