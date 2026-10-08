/**
 * Phase 8.4.7.1 — Dashboard read-only HTTP routes.
 * Dual auth: session (per-user, tenant-scoped) for the web UI,
 * or integration token (legacy) for scripts. Each user sees their own tenant's data.
 */
import type { FastifyInstance } from "fastify";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import {
  requireScriptIntegrationAuth,
} from "../auth/integration-auth.js";
import type { AppServices } from "./index.js";

export async function registerDashboardRoutes(
  app: FastifyInstance,
  services: AppServices,
  auth: AuthContext
): Promise<void> {
  /**
   * Try session auth first (web UI). Fall back to integration token (scripts).
   * Returns the tenantId to scope the query, plus whether the caller is
   * restricted to a single integration (token auth) or sees the whole tenant (session).
   */
  async function authContext(
    request: Parameters<typeof requireTenant>[1]
  ): Promise<{ tenantId: string; integrationId?: string }> {
    // Session auth: requireTenant throws if no session and auth mode requires it.
    // In disabled mode it falls back to header/body tenant.
    try {
      const tenantId = requireTenant(auth, request);
      // If we got here via session (request.auth set with kind=session),
      // it's a user — full tenant view. Otherwise (disabled mode header),
      // fall through to token check below.
      if (request.auth && "kind" in request.auth && request.auth.kind === "session") {
        return { tenantId };
      }
    } catch {
      // Fall through to token auth
    }
    // Integration token auth (scripts): restricted to the one integration
    await requireScriptIntegrationAuth(
      { scriptIntegrations: services.scriptIntegrations },
      request
    );
    const ctx = request.integrationAuth!;
    return { tenantId: ctx.tenantId, integrationId: ctx.integrationId };
  }

  app.get("/api/v1/dashboard/integrations", async (request) => {
    const { tenantId, integrationId } = await authContext(request);
    if (integrationId) {
      // Token auth: single integration view (legacy)
      // request.integrationAuth is already set by authContext's fallback path
      return services.dashboardQuery.listIntegrations(request.integrationAuth!);
    }
    return services.dashboardQuery.listIntegrationsForTenant(tenantId);
  });

  app.get<{
    Params: { integrationId: string };
  }>("/api/v1/dashboard/integrations/:integrationId", async (request) => {
    const { tenantId, integrationId: authIntegrationId } = await authContext(request);
    if (authIntegrationId && authIntegrationId !== request.params.integrationId) {
      const { ForbiddenError } = await import("@adlinklab/shared");
      throw new ForbiddenError("integrationId does not match Integration auth");
    }
    return services.dashboardQuery.getIntegrationForTenant(
      tenantId,
      request.params.integrationId
    );
  });

  app.get<{
    Params: { integrationId: string };
  }>(
    "/api/v1/dashboard/integrations/:integrationId/targets",
    async (request) => {
      const { tenantId, integrationId: authIntegrationId } = await authContext(request);
      if (authIntegrationId && authIntegrationId !== request.params.integrationId) {
        const { ForbiddenError } = await import("@adlinklab/shared");
        throw new ForbiddenError("integrationId does not match Integration auth");
      }
      return services.dashboardQuery.listTargetsForTenant(
        tenantId,
        request.params.integrationId
      );
    }
  );

  app.get<{
    Params: { integrationId: string };
    Querystring: { page?: string; pageSize?: string };
  }>(
    "/api/v1/dashboard/integrations/:integrationId/logs",
    async (request) => {
      const { tenantId, integrationId: authIntegrationId } = await authContext(request);
      if (authIntegrationId && authIntegrationId !== request.params.integrationId) {
        const { ForbiddenError } = await import("@adlinklab/shared");
        throw new ForbiddenError("integrationId does not match Integration auth");
      }
      return services.dashboardQuery.listLogsForTenant(
        tenantId,
        request.params.integrationId,
        request.query ?? {}
      );
    }
  );

  app.get("/api/v1/dashboard/summary", async (request) => {
    const { tenantId, integrationId } = await authContext(request);
    if (integrationId) {
      return services.dashboardQuery.getSummaryForTenant(tenantId);
    }
    return services.dashboardQuery.getSummaryForTenant(tenantId);
  });
}
