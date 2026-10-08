/**
 * Session auth API client (server-side only).
 * Talks to /api/v1/auth/* on the API. Never logs tokens.
 */
import { cookies } from "next/headers";
import { getApiBaseUrl } from "./entities-config";
import { SESSION_COOKIE, VIEW_TENANT_COOKIE } from "./session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  tenantId: string;
  createdAt?: string;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: string;
}

/** Read the raw session token from the cookie (null when absent). */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Read the admin view-as tenant id (null when not viewing). */
export async function getViewTenant(): Promise<string | null> {
  const store = await cookies();
  return store.get(VIEW_TENANT_COOKIE)?.value ?? null;
}

/**
 * Resolve the current user via GET /api/v1/auth/me.
 * Returns null when there is no session or the session is invalid —
 * callers decide whether to redirect to /login.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/auth/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { user?: AuthUser };
    return data.user ?? null;
  } catch {
    return null;
  }
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  tenantId: string;
  createdAt: string;
}

/** Admin-only: list all users. Returns null when not authorized. */
export async function listUsers(): Promise<AdminUserRow[] | null> {
  const token = await getSessionToken();
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/auth/admin/users`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { users?: AdminUserRow[] };
    return data.users ?? [];
  } catch {
    return null;
  }
}
