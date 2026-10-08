/**
 * Feature 3 — Cashback + AdsPower + Rotation API clients (server-side only).
 * Talks to the API with the forwarded session cookie. Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class CashbackApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "CashbackApiError";
    this.status = status;
    this.code = code;
  }
}

async function cashbackFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new CashbackApiError(0, "network failure");
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
    throw new CashbackApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdsPowerProfile {
  userId: string;
  name: string;
  groupName?: string;
}

export interface TrackingLinkRef {
  id: string;
  publicId: string;
  status: string;
}

export interface CashbackOffer {
  id: string;
  cashbackNetwork: string;
  originalUrl: string;
  trackingLinkId: string | null;
  adspowerProfileId: string | null;
  status: string;
  createdAt: string;
  trackingLink?: TrackingLinkRef | null;
}

export interface CreateCashbackOfferInput {
  cashbackNetwork: string;
  originalUrl: string;
  adspowerProfileId?: string;
}

export interface RotationGroupItem {
  id: string;
  weight: number;
  sortOrder: number;
  cashbackOffer: Pick<
    CashbackOffer,
    "id" | "cashbackNetwork" | "originalUrl" | "status" | "trackingLinkId"
  > | null;
}

export interface RotationGroup {
  id: string;
  name: string;
  strategy: string;
  isActive: boolean;
  rotationIntervalMs: number;
  updatedAt: string;
  items: RotationGroupItem[];
}

export interface CreateRotationGroupInput {
  name: string;
  strategy?: string;
  rotationIntervalMs?: number;
  items: Array<{ cashbackOfferId: string; weight?: number }>;
}

export interface RotateNowResult {
  groupId: string;
  rotated: boolean;
  selectedOfferId: string | null;
  updatedTrackingLinkIds: string[];
  skipped?: string;
}

// ---------------------------------------------------------------------------
// AdsPower
// ---------------------------------------------------------------------------

export async function listAdsPowerProfiles(): Promise<{
  profiles: AdsPowerProfile[];
  baseUrl: string;
}> {
  return cashbackFetch("/api/v1/integrations/adspower/profiles");
}

export async function openAdsPowerBrowser(
  profileId: string
): Promise<{ session: { userId: string; debugPort?: number } }> {
  return cashbackFetch("/api/v1/integrations/adspower/open", {
    method: "POST",
    body: JSON.stringify({ profileId }),
  });
}

export async function closeAdsPowerBrowser(
  profileId: string
): Promise<{ ok: boolean }> {
  return cashbackFetch("/api/v1/integrations/adspower/close", {
    method: "POST",
    body: JSON.stringify({ profileId }),
  });
}

// ---------------------------------------------------------------------------
// Cashback offers
// ---------------------------------------------------------------------------

export async function createCashbackOffer(
  input: CreateCashbackOfferInput
): Promise<{ cashbackOffer: CashbackOffer; trackingLink: TrackingLinkRef }> {
  return cashbackFetch("/api/v1/cashback-offers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listCashbackOffers(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<{ items: CashbackOffer[]; total: number; page: number; pageSize: number }> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return cashbackFetch(`/api/v1/cashback-offers${suffix}`);
}

// ---------------------------------------------------------------------------
// Feature: 返利落地页合规评分 (lp-cashback-score)
// ---------------------------------------------------------------------------

export interface LpScoreEntry {
  landingPageId: string;
  score: number;
  issues: string[];
}

/**
 * Batch compliance scores for tracking links (keyed by tracking link id;
 * value is null when the link has no landing page / score available).
 */
export async function batchLpScores(
  trackingLinkIds: string[]
): Promise<{ scores: Record<string, LpScoreEntry | null> }> {
  return cashbackFetch("/api/v1/cashback/lp-scores/batch", {
    method: "POST",
    body: JSON.stringify({ trackingLinkIds }),
  });
}

export async function updateCashbackOffer(
  id: string,
  input: { status?: string; adspowerProfileId?: string | null; originalUrl?: string }
): Promise<{ cashbackOffer: CashbackOffer }> {
  return cashbackFetch(`/api/v1/cashback-offers/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteCashbackOffer(
  id: string
): Promise<{ ok: boolean }> {
  return cashbackFetch(`/api/v1/cashback-offers/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Rotation groups
// ---------------------------------------------------------------------------

export async function createRotationGroup(
  input: CreateRotationGroupInput
): Promise<{ rotationGroup: RotationGroup }> {
  return cashbackFetch("/api/v1/rotation-groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listRotationGroups(): Promise<{
  items: RotationGroup[];
  total: number;
}> {
  return cashbackFetch("/api/v1/rotation-groups");
}

export async function updateRotationGroup(
  id: string,
  input: {
    name?: string;
    strategy?: string;
    isActive?: boolean;
    items?: Array<{ cashbackOfferId: string; weight?: number }>;
  }
): Promise<{ rotationGroup: RotationGroup }> {
  return cashbackFetch(`/api/v1/rotation-groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteRotationGroup(
  id: string
): Promise<{ ok: boolean }> {
  return cashbackFetch(`/api/v1/rotation-groups/${id}`, { method: "DELETE" });
}

export async function rotateGroupNow(
  id: string
): Promise<{ result: RotateNowResult }> {
  return cashbackFetch(`/api/v1/rotation-groups/${id}/rotate-now`, {
    method: "POST",
  });
}
