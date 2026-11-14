/**
 * AutoAds-style 换链接任务 API。
 *
 * Session-auth:
 * - GET/POST   /api/v1/url-swap/tasks
 * - GET/PATCH/DELETE /api/v1/url-swap/tasks/:id
 * - POST       /api/v1/url-swap/tasks/:id/run
 * - GET        /api/v1/url-swap/script
 * - GET/POST   /api/v1/url-swap/authcode
 *
 * Public (Ads Script):
 * - GET /api/v1/url-swap/gettemplate?apiauthcode=&campaign_name=
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  UrlSwapService,
  type UrlSwapTaskInput,
} from "../services/url-swap.js";
import { buildUrlSwapAdsScript } from "../services/url-swap-script.js";

export interface UrlSwapRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: UrlSwapRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

function publicApiBase(request: FastifyRequest): string {
  const env =
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    "";
  if (env) return env.replace(/\/+$/, "");
  const proto = String(request.headers["x-forwarded-proto"] ?? "https");
  const host = String(
    request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost"
  );
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function parseBody(raw: unknown): Partial<UrlSwapTaskInput> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Partial<UrlSwapTaskInput>;
}

export async function registerUrlSwapRoutes(
  app: FastifyInstance,
  deps: UrlSwapRouteDeps
): Promise<void> {
  const service = new UrlSwapService(deps.prisma);

  app.get("/api/v1/url-swap/tasks", async (request) => {
    const info = await requireSession(deps, request);
    const q = request.query as { status?: string; summary?: string };
    const items = await service.listTasks(info.tenantId, q.status);
    if (q.summary === "1" || q.summary === "true") {
      return { data: { items, summary: service.summarize(items) } };
    }
    return { data: { items } };
  });

  app.post("/api/v1/url-swap/tasks", async (request) => {
    const info = await requireSession(deps, request);
    const body = parseBody(request.body);
    if (!body.campaignName || !body.landingDomain || !body.links) {
      throw new ValidationError("campaignName、landingDomain、links 必填");
    }
    const task = await service.createTask(info.tenantId, body as UrlSwapTaskInput);
    return { data: task };
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/url-swap/tasks/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const task = await service.getTask(info.tenantId, request.params.id);
      if (!task) throw new NotFoundError("UrlSwapTask", request.params.id);
      return { data: task };
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/url-swap/tasks/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const task = await service.updateTask(
        info.tenantId,
        request.params.id,
        parseBody(request.body)
      );
      return { data: task };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/url-swap/tasks/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      await service.deleteTask(info.tenantId, request.params.id);
      return { data: { ok: true } };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/url-swap/tasks/:id/run",
    async (request) => {
      const info = await requireSession(deps, request);
      const body = (request.body ?? {}) as { forceRotate?: boolean };
      const result = await service.executeTask(info.tenantId, request.params.id, {
        forceRotate: body.forceRotate !== false,
      });
      return { data: result };
    }
  );

  app.get("/api/v1/url-swap/authcode", async (request) => {
    const info = await requireSession(deps, request);
    const auth = await service.getOrCreateAuth(info.tenantId);
    return { data: { apiAuthCode: auth.apiAuthCode } };
  });

  app.post("/api/v1/url-swap/authcode", async (request) => {
    const info = await requireSession(deps, request);
    const auth = await service.regenerateAuth(info.tenantId);
    return { data: { apiAuthCode: auth.apiAuthCode } };
  });

  app.get("/api/v1/url-swap/script", async (request) => {
    const info = await requireSession(deps, request);
    const auth = await service.getOrCreateAuth(info.tenantId);
    const apiBaseUrl = publicApiBase(request);
    const script = buildUrlSwapAdsScript({
      apiBaseUrl,
      apiAuthCode: auth.apiAuthCode,
    });
    return {
      data: {
        apiAuthCode: auth.apiAuthCode,
        apiBaseUrl,
        script,
        endpoint: `${apiBaseUrl}/api/v1/url-swap/gettemplate`,
      },
    };
  });

  /** Public: Google Ads Script pulls tracking template by campaign name. */
  app.get("/api/v1/url-swap/gettemplate", async (request, reply) => {
    const q = request.query as {
      apiauthcode?: string;
      campaign_name?: string;
    };
    const apiAuthCode = (q.apiauthcode ?? "").trim();
    const campaignName = (q.campaign_name ?? "").trim();
    if (!apiAuthCode) {
      return reply.code(401).type("text/plain").send("unauthorized");
    }
    try {
      const template = await service.resolveTrackingTemplate({
        apiAuthCode,
        campaignName,
      });
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .type("text/plain; charset=utf-8")
        .send(template ?? "");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.code(401).type("text/plain").send("unauthorized");
      }
      throw error;
    }
  });
}
