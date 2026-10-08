"use server";

/**
 * Campaign remote toggle server actions (server-side only).
 * Forwards the user's `alk_session` cookie to the API. Never logs tokens.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export type CampaignToggleAction = "ENABLE" | "PAUSE";

export interface CampaignToggleTask {
  taskId: string;
  type: string;
  status: string;
  campaignId: string | null;
  googleCampaignId: string | null;
  action: CampaignToggleAction | null;
  googleAccountId: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type CampaignToggleActionResult =
  | { ok: true; taskId: string; deduped: boolean; task: CampaignToggleTask }
  | { ok: false; error: string };

export type CampaignToggleStatusResult =
  | { ok: true; task: CampaignToggleTask }
  | { ok: false; error: string };

class CampaignToggleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CampaignToggleApiError";
    this.status = status;
  }
}

async function toggleFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `Campaign toggle API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new CampaignToggleApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export async function toggleCampaignAction(
  campaignId: string,
  action: CampaignToggleAction,
  googleAccountId: string,
  reason?: string
): Promise<CampaignToggleActionResult> {
  try {
    const data = await toggleFetch<{
      taskId: string;
      deduped: boolean;
      task: CampaignToggleTask;
    }>(`/api/v1/google-ads/campaigns/${campaignId}/toggle`, {
      method: "POST",
      body: JSON.stringify({ action, googleAccountId, reason }),
    });
    return {
      ok: true,
      taskId: data.taskId,
      deduped: data.deduped,
      task: data.task,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "Unknown error",
    };
  }
}

export async function getCampaignToggleTaskAction(
  taskId: string
): Promise<CampaignToggleStatusResult> {
  try {
    const task = await toggleFetch<CampaignToggleTask>(
      `/api/v1/google-ads/campaign-toggle-tasks/${taskId}`
    );
    return { ok: true, task };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message : "Unknown error",
    };
  }
}
