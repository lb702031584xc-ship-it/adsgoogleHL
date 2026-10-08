"use server";

/**
 * Feature 4 — 跳转链检测（redirect-check）server actions.
 * Server-side only: forwards the user's session cookie to the API.
 * (Never import @/lib/api/entities here from a client component —
 * it uses next/headers and is server-only. This module IS server-only.)
 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type RedirectCheckActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<RedirectCheckActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

export interface RedirectCheckSummary {
  checked: number;
  clean: number;
  warning: number;
  error: number;
  alertsCreated: number;
  skippedNoUrl: number;
}

async function postCheckAll(): Promise<RedirectCheckSummary> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}/api/v1/cashback/redirect-checks/check-all`, {
    method: "POST",
    headers: { ...headers },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Redirect chain check failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { ok: boolean } & RedirectCheckSummary;
  return body;
}

/** Trigger a synchronous redirect-chain scan for the current tenant. */
export async function triggerRedirectCheckAllAction() {
  return attempt(() => postCheckAll(), ["/cashback/redirect-check"]);
}

export interface RedirectHopView {
  url: string;
  domain: string;
  statusCode: number | null;
}

export interface RedirectCheckHistoryRow {
  id: string;
  trackingLinkId: string;
  hopCount: number;
  hops: RedirectHopView[];
  issues: string[];
  checkedAt: string;
  status: string;
  linkName: string | null;
  linkPublicId: string | null;
}

export interface RedirectCheckHistory {
  total: number;
  page: number;
  pageSize: number;
  rows: RedirectCheckHistoryRow[];
}

/** Paginated redirect-check history for the current tenant. */
export async function listRedirectChecksAction(
  page = 1,
  pageSize = 20,
  trackingLinkId?: string
) {
  return attempt(async () => {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (trackingLinkId) params.set("trackingLinkId", trackingLinkId);
    const res = await fetch(`${base}/api/v1/cashback/redirect-checks?${params}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to load redirect checks (HTTP ${res.status})`);
    }
    return (await res.json()) as RedirectCheckHistory;
  }, []);
}
