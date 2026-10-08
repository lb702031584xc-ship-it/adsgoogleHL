/**
 * Entity management API config (server-side only).
 * Uses the Tenant API Key — never expose it to the browser.
 */
import { dictionaries, type Lang } from "@/i18n/dictionaries";

export class EntityApiConfigError extends Error {
  readonly code = "ENTITY_API_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "EntityApiConfigError";
  }
}

export function getApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new EntityApiConfigError("NEXT_PUBLIC_API_BASE_URL is not configured");
  }
  return raw;
}

/** Server-only Tenant API Key for entity management APIs. */
export function getTenantApiKey(
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = (env.ADLINKLAB_API_KEY ?? "").trim();
  if (!key) {
    throw new EntityApiConfigError("ADLINKLAB_API_KEY is not configured");
  }
  return key;
}

export class EntityApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = "HTTP_ERROR") {
    super(message);
    this.name = "EntityApiError";
    this.status = status;
    this.code = code;
  }
}

export function mapEntityErrorMessage(error: unknown, lang: Lang = "en"): string {
  const t = dictionaries[lang].entities.errors;
  if (error instanceof EntityApiConfigError) {
    if (error.message.includes("NEXT_PUBLIC_API_BASE_URL"))
      return t.apiBaseUrlMissing;
    if (error.message.includes("ADLINKLAB_API_KEY")) return t.apiKeyMissing;
    return error.message;
  }
  if (error instanceof EntityApiError) {
    if (error.status === 0) return t.unreachable;
    if (error.status === 401 || error.status === 403) return t.authFailed;
    if (error.status === 404) return t.notFound;
    return error.message || t.requestFailed(error.status);
  }
  if (error instanceof Error) return error.message;
  return t.unknown;
}

/** Format an ISO date string for display; returns "—" for missing values. */
export function formatDateTime(
  value: string | null | undefined
): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Truncate a long string (ids, urls) for table display. */
export function truncate(value: string | null | undefined, max = 36): string {
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
