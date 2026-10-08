import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateApiKey,
  extractApiKeyFromHeaders,
  loadApiKeyRegistry,
  resolveAuthMode,
  type AuthMode,
  type AuthPrincipal,
  type ApiKeyRecord,
} from "./api-keys.js";
import { authenticateSessionRequest } from "./sessions.js";

export type { AuthMode, AuthPrincipal };

/** Principal attached when the request authenticated via login session. */
export interface SessionAuthPrincipal {
  kind: "session";
  userId: string;
  email: string;
  role: string;
  tenantId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthPrincipal | SessionAuthPrincipal;
  }
}

export interface AuthContext {
  mode: AuthMode;
  registry: ApiKeyRecord[];
}

export function createAuthContext(
  env: NodeJS.ProcessEnv = process.env
): AuthContext {
  return {
    mode: resolveAuthMode(env),
    registry: loadApiKeyRegistry(env),
  };
}

/**
 * Best-effort session resolution before route handlers run.
 * No-op when prisma is unavailable (memory persistence / unit tests):
 * session auth simply isn't offered and existing API-key/disabled behavior holds.
 */
export function registerSessionAuthHook(
  app: FastifyInstance,
  prisma?: PrismaClient
): void {
  app.addHook("onRequest", async (request) => {
    if (!prisma) return;
    await authenticateSessionRequest(prisma, request);
  });
}

/**
 * Bind tenant for management APIs.
 * - session: tenant comes from the login session (admin x-view-tenant override
 *   already applied during session resolution); takes precedence when present
 * - api_key: tenant comes ONLY from credential; body/header mismatch → 403
 * - disabled: tenant from body or x-tenant-id (Phase 0–7 test compatibility)
 */
export function requireTenant(
  auth: AuthContext,
  request: FastifyRequest,
  bodyTenant?: string
): string {
  const sessionAuth = request.sessionAuth;
  if (sessionAuth) {
    request.auth = {
      kind: "session",
      userId: sessionAuth.id,
      email: sessionAuth.email,
      role: sessionAuth.role,
      tenantId: sessionAuth.tenantId,
    };
    return sessionAuth.tenantId;
  }

  if (auth.mode === "api_key") {
    const raw = extractApiKeyFromHeaders({
      authorization: request.headers.authorization,
      "x-api-key":
        typeof request.headers["x-api-key"] === "string"
          ? request.headers["x-api-key"]
          : undefined,
    });
    const principal = authenticateApiKey(raw, auth.registry);
    request.auth = principal;

    const claimed =
      bodyTenant ??
      (typeof request.headers["x-tenant-id"] === "string"
        ? request.headers["x-tenant-id"]
        : undefined);
    if (claimed && claimed !== principal.tenantId) {
      throw new ForbiddenError("tenantId does not match API key tenant", {
        claimedTenantId: claimed,
      });
    }
    return principal.tenantId;
  }

  const headerTenant =
    typeof request.headers["x-tenant-id"] === "string"
      ? request.headers["x-tenant-id"]
      : undefined;
  const tenantId = bodyTenant ?? headerTenant;
  if (!tenantId) {
    throw new ValidationError("tenantId is required");
  }
  request.auth = {
    tenantId,
    keyId: "disabled",
    authMode: "disabled",
  };
  return tenantId;
}

/** Fail closed when api_key mode has an empty registry (misconfiguration). */
export function assertAuthConfigured(auth: AuthContext): void {
  if (auth.mode === "api_key" && auth.registry.length === 0) {
    throw new UnauthorizedError(
      "AUTH_MODE=api_key but no API keys configured (set ADLINKLAB_API_KEYS)"
    );
  }
}
