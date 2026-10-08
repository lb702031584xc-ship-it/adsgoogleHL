/**
 * Automation pack ③ — payout watch API client (no "use server" — safe to
 * hold the error class and fetch helper here; client components must only
 * import from payout-watch-actions.ts, never this file or entities).
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface PayoutChangeEntry {
  oldPayout: number | null;
  newPayout: number | null;
  changedAt: string;
}

export interface PayoutWatchItem {
  id: string;
  offerId: string;
  enabled: boolean;
  lastPayout: number | null;
  lastCheckedAt: string | null;
  changeHistory: PayoutChangeEntry[];
  changeCount: number;
  offerName: string | null;
  offerNetwork: string | null;
  commissionType: string | null;
  currentPayout: number | null;
}

export interface PayoutWatchList {
  items: PayoutWatchItem[];
}

export interface OfferOption {
  id: string;
  name: string;
  network: string;
}

export interface OfferOptionList {
  items: OfferOption[];
  total: number;
}

export class PayoutWatchApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "PayoutWatchApiError";
    this.status = status;
    this.code = code;
  }
}

async function payoutWatchFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new PayoutWatchApiError(0, "network failure");
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
    throw new PayoutWatchApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

/** List payout watches for the current tenant. */
export function listPayoutWatches(): Promise<PayoutWatchList> {
  return payoutWatchFetch<PayoutWatchList>("/api/v1/payout-watch");
}

/** Offer options for the "add watch" dropdown. */
export function listOfferOptions(pageSize = 200): Promise<OfferOptionList> {
  return payoutWatchFetch<OfferOptionList>(
    `/api/v1/offers?page=1&pageSize=${pageSize}`
  );
}

/** Enable (or create) a payout watch for an offer. */
export function enablePayoutWatch(
  offerId: string
): Promise<{ ok: true; watch: PayoutWatchItem }> {
  return payoutWatchFetch<{ ok: true; watch: PayoutWatchItem }>(
    `/api/v1/payout-watch/${encodeURIComponent(offerId)}/enable`,
    { method: "POST" }
  );
}

/** Disable a payout watch for an offer. */
export function disablePayoutWatch(
  offerId: string
): Promise<{ ok: true; watch: PayoutWatchItem }> {
  return payoutWatchFetch<{ ok: true; watch: PayoutWatchItem }>(
    `/api/v1/payout-watch/${encodeURIComponent(offerId)}/disable`,
    { method: "POST" }
  );
}
