"use server";

/**
 * 功能 1 — 返利比例监控（rate-watch）server actions。
 * Server-side only: forwards the user's session cookie to the API.
 * (Never import @/lib/api/entities here from a client component —
 * it uses next/headers and is server-only. This module IS server-only.)
 */
import { revalidatePath } from "next/cache";
import { sessionHeaders } from "./session";
import { getApiBaseUrl, mapEntityErrorMessage } from "./entities-config";
import { getLang } from "@/i18n/lang";

export type RateWatchActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type RateCheckStatus = "ok" | "mismatch" | "unreachable";

export interface RateWatchRow {
  id: string;
  tenantId: string;
  cashbackOfferId: string;
  advertisedRate: string;
  detectedRate: string | null;
  rateUrl: string | null;
  status: RateCheckStatus;
  checkedAt: string;
  cashbackNetwork: string;
  originalUrl: string;
  offerStatus: string;
}

async function attempt<T>(
  fn: () => Promise<T>,
  revalidate: string[]
): Promise<RateWatchActionResult<T>> {
  try {
    const data = await fn();
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: mapEntityErrorMessage(error, await getLang()) };
  }
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const headers = await sessionHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body != null ? { "content-type": "application/json" } : {}),
      ...headers,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  if (!res.ok) {
    let message = `request failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** 该租户每个 offer 的最新一次比例检查。 */
export async function listRateWatchAction() {
  return attempt(async () => {
    const body = await apiJson<{ checks: RateWatchRow[] }>(
      "/api/v1/cashback/rate-checks"
    );
    return body.checks;
  }, []);
}

/** 设置宣传比例 + 抓取 URL，并立即检查一次。 */
export async function setRateAndCheckAction(
  offerId: string,
  input: { advertisedRate: string; rateUrl?: string }
) {
  return attempt(
    () =>
      apiJson<{ check: RateWatchRow; alertCreated: boolean }>(
        `/api/v1/cashback/offers/${offerId}/rate`,
        { method: "POST", body: JSON.stringify(input) }
      ),
    ["/cashback/rate-watch"]
  );
}

/** 用已保存的配置立即重新检查一次。 */
export async function checkRateNowAction(
  offerId: string,
  input: { advertisedRate: string; rateUrl?: string | null }
) {
  return attempt(
    () =>
      apiJson<{ check: RateWatchRow; alertCreated: boolean }>(
        `/api/v1/cashback/offers/${offerId}/rate`,
        {
          method: "POST",
          body: JSON.stringify({
            advertisedRate: input.advertisedRate,
            ...(input.rateUrl ? { rateUrl: input.rateUrl } : {}),
          }),
        }
      ),
    ["/cashback/rate-watch"]
  );
}
