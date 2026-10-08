/**
 * Session forwarding for server-side API clients.
 *
 * All browser traffic is authenticated via the `alk_session` httpOnly cookie
 * (set at login). Server components and server actions forward it to the API
 * as a `Cookie` header. Never log tokens.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "alk_session";
export const VIEW_TENANT_COOKIE = "alk_view_tenant";

/**
 * Build the auth headers for an API request from the user's session cookie.
 * Redirects to /login when there is no session. Also forwards the admin
 * view-as tenant header when the `alk_view_tenant` cookie is present.
 */
export async function sessionHeaders(): Promise<Record<string, string>> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const headers: Record<string, string> = {
    Cookie: `${SESSION_COOKIE}=${token}`,
  };
  const viewTenant = store.get(VIEW_TENANT_COOKIE)?.value;
  if (viewTenant) headers["x-view-tenant"] = viewTenant;
  return headers;
}
