"use server";

/**
 * Feature 5 — 返利比价（rate-compare）server actions: thin wrappers
 * returning {ok, data} | {ok:false, error}. The API fetch client lives
 * here (server-only). Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { en as rcEn, zh as rcZh } from "@/i18n/dict/cashback-rate-compare";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

class RateCompareApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "RateCompareApiError";
    this.status = status;
    this.code = code;
  }
}

async function rcFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — Fastify
        // rejects an empty body paired with content-type: application/json.
        ...(init.body != null ? { "content-type": "application/json" } : {}),
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new RateCompareApiError(0, "network failure");
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
    throw new RateCompareApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateComparePortal {
  name: string;
  url: string;
}

export interface CompareGroup {
  id: string;
  tenantId: string;
  name: string;
  merchantDomain: string;
  portals: RateComparePortal[];
  createdAt: string;
}

export interface RateSnapshot {
  id: string;
  tenantId: string;
  merchantDomain: string;
  portal: string;
  rate: string | null;
  url: string | null;
  checkedAt: string;
  rateValue: number | null;
}

export interface GroupCheckResult {
  groupId: string;
  merchantDomain: string;
  checkedAt: string;
  results: Array<{
    portal: string;
    url: string;
    rate: string | null;
    rateValue: number | null;
    ok: boolean;
  }>;
  bestPortal: string | null;
  bestRate: string | null;
  bestRateValue: number | null;
  alertCreated: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type RateCompareActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function mapError(
  e: unknown,
  fallback: string
): { ok: false; error: string; code?: string } {
  if (e instanceof RateCompareApiError) {
    return { ok: false, error: e.message, code: e.code };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function t() {
  return (await getLang()) === "zh" ? rcZh : rcEn;
}

export async function listRateCompareGroupsAction(): Promise<
  RateCompareActionResult<{ items: CompareGroup[] }>
> {
  const d = await t();
  try {
    const data = await rcFetch<{ items: CompareGroup[] }>(
      "/api/v1/cashback/rate-compare/groups"
    );
    return { ok: true as const, data };
  } catch (e) {
    return mapError(e, d.rateCompare.error);
  }
}

export async function createRateCompareGroupAction(input: {
  name: string;
  merchantDomain: string;
  portals: RateComparePortal[];
}): Promise<RateCompareActionResult<{ ok: true; group: CompareGroup }>> {
  const d = await t();
  try {
    const data = await rcFetch<{ ok: true; group: CompareGroup }>(
      "/api/v1/cashback/rate-compare/groups",
      { method: "POST", body: JSON.stringify(input) }
    );
    return { ok: true as const, data };
  } catch (e) {
    return mapError(e, d.rateCompare.error);
  }
}

export async function compareRateGroupNowAction(
  groupId: string
): Promise<RateCompareActionResult<{ ok: true; result: GroupCheckResult }>> {
  const d = await t();
  try {
    const data = await rcFetch<{ ok: true; result: GroupCheckResult }>(
      `/api/v1/cashback/rate-compare/groups/${groupId}/compare-now`,
      { method: "POST" }
    );
    return { ok: true as const, data };
  } catch (e) {
    return mapError(e, d.rateCompare.error);
  }
}

export async function getRateGroupSnapshotsAction(
  groupId: string
): Promise<
  RateCompareActionResult<{
    group: CompareGroup;
    latest: RateSnapshot[];
    snapshots: RateSnapshot[];
  }>
> {
  const d = await t();
  try {
    const data = await rcFetch<{
      group: CompareGroup;
      latest: RateSnapshot[];
      snapshots: RateSnapshot[];
    }>(`/api/v1/cashback/rate-compare/groups/${groupId}/snapshots`);
    return { ok: true as const, data };
  } catch (e) {
    return mapError(e, d.rateCompare.error);
  }
}
