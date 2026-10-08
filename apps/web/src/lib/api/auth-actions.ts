"use server";

/**
 * Auth server actions: login / register / logout / admin view-as.
 * Sets/clears the `alk_session` httpOnly cookie. Never logs tokens.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { SESSION_COOKIE, VIEW_TENANT_COOKIE } from "./session";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import type { AuthSession } from "./auth";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

type FormState = { error: string | null };

function sessionCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message && body.message.trim()) return body.message;
  } catch {
    /* fall through */
  }
  return fallback;
}

export async function loginAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const lang = await getLang();
  const t = getDictionary(lang);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: t.auth.login.required };
  }
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return { error: t.auth.login.networkError };
  }
  if (!res.ok) {
    return { error: await readErrorMessage(res, t.auth.login.failed) };
  }
  const data = (await res.json()) as AuthSession;
  if (!data.token) return { error: t.auth.login.failed };
  (await cookies()).set(SESSION_COOKIE, data.token, sessionCookieOptions());
  redirect("/dashboard");
}

export async function registerAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const lang = await getLang();
  const t = getDictionary(lang);
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !name || !password) {
    return { error: t.auth.register.required };
  }
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, password }),
      cache: "no-store",
    });
  } catch {
    return { error: t.auth.register.networkError };
  }
  if (!res.ok) {
    return { error: await readErrorMessage(res, t.auth.register.failed) };
  }
  const data = (await res.json()) as AuthSession;
  if (!data.token) return { error: t.auth.register.failed };
  (await cookies()).set(SESSION_COOKIE, data.token, sessionCookieOptions());
  redirect("/dashboard");
}

export async function logoutAction(): Promise<never> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
        cache: "no-store",
      });
    } catch {
      /* best effort — clear local cookies regardless */
    }
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(VIEW_TENANT_COOKIE);
  redirect("/login");
}

/** Admin view-as: remember which tenant's data to display. */
export async function setViewTenantAction(formData: FormData): Promise<never> {
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (tenantId) {
    (await cookies()).set(VIEW_TENANT_COOKIE, tenantId, {
      httpOnly: true,
      path: "/",
      sameSite: "lax" as const,
      maxAge: SESSION_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  }
  redirect("/dashboard");
}

/** Exit admin view-as mode. */
export async function clearViewTenantAction(): Promise<never> {
  (await cookies()).delete(VIEW_TENANT_COOKIE);
  redirect("/dashboard");
}
