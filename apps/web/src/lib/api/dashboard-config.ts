/**
 * Phase 8.4.7.2 — Dashboard API config (server-side secrets only).
 * Token must NEVER use NEXT_PUBLIC_* — never ship to the browser bundle.
 */
import { getDictionary, type Lang } from "@/i18n/dictionaries";

export function getApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = (env.NEXT_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new DashboardConfigError(
      "NEXT_PUBLIC_API_BASE_URL is not configured"
    );
  }
  return raw;
}

/**
 * Server-only Integration Token for Dashboard GET calls.
 * Prefer ADLINKLAB_INTEGRATION_TOKEN; never NEXT_PUBLIC_*.
 */
export function getDashboardIntegrationToken(
  env: NodeJS.ProcessEnv = process.env
): string {
  const token = (env.ADLINKLAB_INTEGRATION_TOKEN ?? "").trim();
  if (!token) {
    throw new DashboardConfigError(
      "ADLINKLAB_INTEGRATION_TOKEN is not configured"
    );
  }
  return token;
}

export class DashboardConfigError extends Error {
  readonly code = "DASHBOARD_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "DashboardConfigError";
  }
}

export class DashboardApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "DASHBOARD_API_ERROR") {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

/** Map HTTP status to safe user-facing message (no secrets / stack). */
export function mapDashboardErrorMessage(
  error: unknown,
  lang: Lang = "en"
): string {
  const t = getDictionary(lang).dashboard.errors;
  if (error instanceof DashboardConfigError) {
    return t.notConfigured;
  }
  if (error instanceof DashboardApiError) {
    if (error.status === 401) return t.authRequired;
    if (error.status === 403) return t.forbidden;
    if (error.status === 404) return t.notFound;
    return t.loadFailed;
  }
  return t.loadFailed;
}
