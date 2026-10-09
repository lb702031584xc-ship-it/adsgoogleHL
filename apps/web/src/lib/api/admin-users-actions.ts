"use server";

/**
 * Admin user management server actions: create / delete / change role.
 * Forwards the admin's session cookie to the API; never logs tokens or
 * passwords. Error messages are localized; the API's English messages are
 * matched by stable substrings (never shown to the user verbatim).
 */
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import { getLang } from "@/i18n/lang";
import { en, zh, type AdminUsersDict } from "@/i18n/dict/admin-users";

export type AdminUserRole = "admin" | "member" | "researcher";

export interface AdminManagedUser {
  id: string;
  email: string;
  name: string;
  role: AdminUserRole;
  tenantId: string;
  createdAt: string;
}

export type AdminUsersResult =
  | { ok: true }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES: AdminUserRole[] = ["admin", "member", "researcher"];

function dictForLang(lang: string): AdminUsersDict {
  return lang === "en" ? en : zh;
}

interface ApiFailure {
  status: number;
  message: string;
}

async function readApiFailure(res: Response): Promise<ApiFailure> {
  let message = "";
  try {
    const body = (await res.json()) as { message?: string };
    if (typeof body.message === "string") message = body.message;
  } catch {
    /* fall through */
  }
  return { status: res.status, message };
}

type AdminUsersAction = "create" | "delete" | "changeRole";

function mapError(
  action: AdminUsersAction,
  failure: ApiFailure,
  t: AdminUsersDict
): string {
  const { status, message } = failure;
  if (status === 0) return t.errors.networkError;
  if (status === 401 || status === 403) return t.errors.forbidden;
  if (status === 404) return t.errors.notFound;
  if (status === 409) {
    if (/already registered/i.test(message)) return t.errors.emailTaken;
    if (/last active admin/i.test(message)) {
      return action === "delete" ? t.errors.lastAdminDelete : t.errors.lastAdminDemote;
    }
    return action === "create" ? t.errors.emailTaken : t.errors.unknown;
  }
  // 400s — match the API's stable English messages to localized strings.
  if (/own account/i.test(message)) return t.errors.cannotDeleteSelf;
  if (/own role/i.test(message)) return t.errors.cannotChangeOwnRole;
  if (/valid email/i.test(message)) return t.errors.invalidEmail;
  if (/at least 8/i.test(message)) return t.errors.shortPassword;
  if (/one of: admin, member, researcher/i.test(message)) return t.errors.invalidRole;
  const fallback =
    action === "create"
      ? t.errors.createFailed
      : action === "delete"
        ? t.errors.deleteFailed
        : t.errors.roleChangeFailed;
  return message || fallback;
}

async function callAdminUsersApi(
  path: string,
  init: { method: string; body?: unknown }
): Promise<{ res: Response } | { failure: ApiFailure }> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: init.method,
      headers: {
        ...(await sessionHeaders()),
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    return { failure: { status: 0, message: "" } };
  }
  return { res };
}

/** Admin-only: create a user with their own tenant. */
export async function createAdminUserAction(input: {
  email: string;
  password: string;
  name?: string;
  role: string;
}): Promise<AdminUsersResult> {
  const t = dictForLang(await getLang());
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const name = (input.name ?? "").trim();
  const role = input.role.trim();
  if (!email || !password) return { ok: false, error: t.errors.required };
  if (!EMAIL_RE.test(email)) return { ok: false, error: t.errors.invalidEmail };
  if (password.length < 8) return { ok: false, error: t.errors.shortPassword };
  if (!(VALID_ROLES as string[]).includes(role)) {
    return { ok: false, error: t.errors.invalidRole };
  }

  const call = await callAdminUsersApi("/api/v1/auth/admin/users", {
    method: "POST",
    body: { email, password, name, role },
  });
  if ("failure" in call) return { ok: false, error: mapError("create", call.failure, t) };
  if (!call.res.ok) {
    return { ok: false, error: mapError("create", await readApiFailure(call.res), t) };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Admin-only: soft-delete a user and revoke all of their sessions. */
export async function deleteAdminUserAction(userId: string): Promise<AdminUsersResult> {
  const t = dictForLang(await getLang());
  const call = await callAdminUsersApi(
    `/api/v1/auth/admin/users/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
  if ("failure" in call) return { ok: false, error: mapError("delete", call.failure, t) };
  if (!call.res.ok) {
    return { ok: false, error: mapError("delete", await readApiFailure(call.res), t) };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Admin-only: change a user's role. */
export async function changeAdminUserRoleAction(
  userId: string,
  role: string
): Promise<AdminUsersResult> {
  const t = dictForLang(await getLang());
  if (!(VALID_ROLES as string[]).includes(role)) {
    return { ok: false, error: t.errors.invalidRole };
  }
  const call = await callAdminUsersApi(
    `/api/v1/auth/admin/users/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: { role } }
  );
  if ("failure" in call) {
    return { ok: false, error: mapError("changeRole", call.failure, t) };
  }
  if (!call.res.ok) {
    return {
      ok: false,
      error: mapError("changeRole", await readApiFailure(call.res), t),
    };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}
