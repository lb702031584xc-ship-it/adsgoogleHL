/**
 * 功能 2 — 返利条款监控 (terms-watch) API client (server-side only).
 * Talks to the API with the forwarded session cookie. Never logs secrets.
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export class TermsWatchApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "TermsWatchApiError";
    this.status = status;
    this.code = code;
  }
}

async function termsWatchFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new TermsWatchApiError(0, "network failure");
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
    throw new TermsWatchApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TermsWatch {
  id: string;
  tenantId: string;
  merchantName: string;
  merchantDomain: string;
  termsUrl: string;
  termsHash: string | null;
  cashbackAllowed: boolean | null;
  lastChecked: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TermsWatchCheckResult {
  watchId: string;
  status: "ok" | "changed" | "blocked";
  hashChanged: boolean;
  cashbackAllowed: boolean | null;
  prohibitedNewly: boolean;
  pausedLinks: number;
  alertCreated: boolean;
  error?: string;
}

export interface CreateTermsWatchInput {
  merchantName: string;
  merchantDomain: string;
  termsUrl: string;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function listTermsWatches(): Promise<{ items: TermsWatch[] }> {
  return termsWatchFetch<{ items: TermsWatch[] }>("/api/v1/cashback/terms-watches");
}

export async function createTermsWatch(
  input: CreateTermsWatchInput
): Promise<{ watch: TermsWatch }> {
  return termsWatchFetch<{ watch: TermsWatch }>("/api/v1/cashback/terms-watches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function checkTermsWatchNow(
  id: string
): Promise<{ result: TermsWatchCheckResult }> {
  return termsWatchFetch<{ result: TermsWatchCheckResult }>(
    `/api/v1/cashback/terms-watches/${encodeURIComponent(id)}/check`,
    { method: "POST" }
  );
}
