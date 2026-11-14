/**
 * AutoAds-style 换链任务 API client（server-side，转发 session cookie）。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class UrlSwapApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "UrlSwapApiError";
    this.status = status;
    this.code = code;
  }
}

export interface UrlSwapLink {
  url: string;
  remark: string;
}

export type UrlSwapTaskStatus = "running" | "paused" | "error" | "completed";

export interface UrlSwapTask {
  id: string;
  network: string;
  campaignName: string;
  links: UrlSwapLink[];
  landingDomain: string;
  proxyType: "http" | "socks5" | "none";
  geoVerifyEnabled: boolean;
  proxyExtractUrl: string;
  backupProxyExtractUrl: string;
  targetRegions: string[];
  uaStrategy: "random" | "fixed";
  uaPlatform: "desktop" | "mobile" | "any";
  referers: string[];
  execIntervalMinutes: number;
  rotateIntervalMinutes: number;
  rotationEnabled: boolean;
  currentLinkIndex: number;
  lastRotatedAt: string | null;
  status: UrlSwapTaskStatus;
  linkChangeCount: number;
  lastExecAt: string | null;
  lastExecStatus: "success" | "failed" | null;
  lastExecMessage: string | null;
  lastProxyLine: string | null;
  activeTemplate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UrlSwapTaskInput {
  network?: string;
  campaignName: string;
  links: UrlSwapLink[];
  landingDomain: string;
  proxyType?: "http" | "socks5" | "none";
  geoVerifyEnabled?: boolean;
  proxyExtractUrl?: string;
  backupProxyExtractUrl?: string;
  targetRegions?: string[];
  uaStrategy?: "random" | "fixed";
  uaPlatform?: "desktop" | "mobile" | "any";
  referers?: string[];
  execIntervalMinutes?: number;
  rotateIntervalMinutes?: number;
  rotationEnabled?: boolean;
  status?: UrlSwapTaskStatus;
}

export interface UrlSwapSummary {
  total: number;
  running: number;
  paused: number;
  error: number;
  completed: number;
  linkChanges: number;
  successRate: number;
}

export interface UrlSwapScriptPayload {
  apiAuthCode: string;
  apiBaseUrl: string;
  script: string;
  endpoint: string;
}

async function urlSwapFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new UrlSwapApiError(0, "network failure");
  }
  if (res.status === 401) redirect("/login");
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
    throw new UrlSwapApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listUrlSwapTasks(opts?: {
  status?: string;
  summary?: boolean;
}) {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.summary) qs.set("summary", "1");
  const q = qs.toString();
  return urlSwapFetch<{
    data: { items: UrlSwapTask[]; summary?: UrlSwapSummary };
  }>(`/api/v1/url-swap/tasks${q ? `?${q}` : ""}`);
}

export async function getUrlSwapTask(id: string) {
  return urlSwapFetch<{ data: UrlSwapTask }>(`/api/v1/url-swap/tasks/${id}`);
}

export async function createUrlSwapTask(input: UrlSwapTaskInput) {
  return urlSwapFetch<{ data: UrlSwapTask }>("/api/v1/url-swap/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateUrlSwapTask(
  id: string,
  patch: Partial<UrlSwapTaskInput>
) {
  return urlSwapFetch<{ data: UrlSwapTask }>(`/api/v1/url-swap/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteUrlSwapTask(id: string) {
  return urlSwapFetch<{ data: { ok: boolean } }>(
    `/api/v1/url-swap/tasks/${id}`,
    { method: "DELETE" }
  );
}

export async function runUrlSwapTask(id: string, forceRotate = true) {
  return urlSwapFetch<{ data: { task: UrlSwapTask } }>(
    `/api/v1/url-swap/tasks/${id}/run`,
    {
      method: "POST",
      body: JSON.stringify({ forceRotate }),
    }
  );
}

export async function getUrlSwapScript() {
  return urlSwapFetch<{ data: UrlSwapScriptPayload }>("/api/v1/url-swap/script");
}

export async function regenerateUrlSwapAuth() {
  return urlSwapFetch<{ data: { apiAuthCode: string } }>(
    "/api/v1/url-swap/authcode",
    { method: "POST" }
  );
}
