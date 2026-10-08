/**
 * Phase 4 Research Lab — RESEARCHER role isolation.
 *
 * A user with role 'researcher' (User.role is a plain String; no schema
 * change needed) may only touch the research surface:
 *   - /api/v1/research/*            (research lab)
 *   - /api/v1/auth/me               (who am i)
 *   - /api/v1/auth/logout           (sign out)
 * Every other /api/* route returns 403 for a researcher session
 * (including /api/v1/offers, /api/v1/campaigns, /api/v1/ai/*, ...).
 * Admins and members are unaffected; unauthenticated requests pass through
 * untouched (each route still enforces its own 401).
 *
 * Wiring (coordinator): call registerResearcherIsolation(app, { prisma })
 * in routes/index.ts next to registerSessionAuthHook — same onRequest-hook
 * pattern. The hook reuses authenticateSessionRequest's request cache, so
 * per-route auth does not pay a second session lookup.
 */
import type { FastifyInstance } from "fastify";
import { ForbiddenError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { authenticateSessionRequest } from "./sessions.js";

export interface ResearcherIsolationDeps {
  prisma: PrismaClient;
}

export const RESEARCHER_ROLE = "researcher";

const RESEARCH_PREFIX = "/api/v1/research";
const AUTH_ME = "/api/v1/auth/me";
const AUTH_LOGOUT = "/api/v1/auth/logout";

/** True when a researcher session is allowed to call this pathname. */
export function isResearcherAllowedPath(pathname: string): boolean {
  if (pathname === RESEARCH_PREFIX || pathname.startsWith(`${RESEARCH_PREFIX}/`)) {
    return true;
  }
  for (const p of [AUTH_ME, AUTH_LOGOUT]) {
    if (pathname === p || pathname === `${p}/`) return true;
  }
  return false;
}

function pathnameOf(rawUrl: string | undefined): string {
  const u = rawUrl ?? "/";
  const noQuery = u.split("?")[0] ?? "/";
  return (noQuery.split("#")[0] ?? "/") || "/";
}

export function registerResearcherIsolation(
  app: FastifyInstance,
  deps: ResearcherIsolationDeps
): void {
  app.addHook("onRequest", async (request) => {
    const pathname = pathnameOf(request.raw.url);
    // Only API routes are in scope; static/web paths pass through untouched.
    if (!pathname.startsWith("/api/")) return;
    const info = await authenticateSessionRequest(deps.prisma, request);
    if (!info || info.role !== RESEARCHER_ROLE) return;
    if (!isResearcherAllowedPath(pathname)) {
      throw new ForbiddenError(
        "Researchers may only access /api/v1/research/*, /api/v1/auth/me and /api/v1/auth/logout"
      );
    }
  });
}
