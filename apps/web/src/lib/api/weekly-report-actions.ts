"use server";

/**
 * Automation round 2 — weekly report server actions.
 * Server-side only: forwards the user's session cookie to the API.
 * (Never import @/lib/api/entities here from a client component —
 * it uses next/headers and is server-only. This module IS server-only.)
 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type WeeklyReportActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface WeeklyReportTopOffer {
  offerId: string | null;
  offerName: string;
  network: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  prevRevenue: number;
}

export interface WeeklyReportData {
  spend: number | null;
  revenue: number;
  conversions: number;
  clicks: number;
  topOffers: WeeklyReportTopOffer[];
  deadLinks: number;
  newNegatives: number;
  newTasks: number;
  alerts: number;
  alertsBySeverity: Record<string, number>;
  weekStart: string;
  weekEnd: string;
}

export interface WeeklyReportRow {
  id: string;
  tenantId: string;
  weekStart: string;
  weekEnd: string;
  data: WeeklyReportData;
  aiSummary: string;
  status: string;
  createdAt: string;
}

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<WeeklyReportActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Weekly report request failed (HTTP ${res.status}) ${body}`);
  }
  return (await res.json()) as T;
}

/** List weekly reports for the current tenant (newest first). */
export async function listWeeklyReportsAction() {
  return attempt(
    () => apiFetch<{ reports: WeeklyReportRow[] }>("/api/v1/weekly-reports"),
    []
  );
}

/** Fetch one weekly report (tenant-isolated). */
export async function getWeeklyReportAction(id: string) {
  return attempt(() => apiFetch<WeeklyReportRow>(`/api/v1/weekly-reports/${id}`), []);
}

/** Manually trigger generation for the previous week (or an explicit window). */
export async function generateWeeklyReportAction(
  weekStart?: string,
  weekEnd?: string
) {
  return attempt(
    () =>
      apiFetch<WeeklyReportRow>("/api/v1/weekly-reports/generate-now", {
        method: "POST",
        body: JSON.stringify({ weekStart, weekEnd }),
      }),
    ["/reports/weekly"]
  );
}
