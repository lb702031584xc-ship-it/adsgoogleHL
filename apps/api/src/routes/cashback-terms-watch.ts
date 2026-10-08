/**
 * 功能 2 — 商家返利条款监控 (terms-watch) API.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * - GET  /api/v1/cashback/terms-watches            （本 tenant 的 watch 列表）
 * - POST /api/v1/cashback/terms-watches            { merchantName, merchantDomain, termsUrl }
 * - POST /api/v1/cashback/terms-watches/:id/check  （手动立即检查）
 *
 * Session auth only（每个用户一个 tenant），查询全部按 tenantId 隔离。
 * 手动检查会实时抓取 termsUrl（SSRF-safe，10s 超时），抓取失败记 blocked 不抛错。
 *
 * WIRING: 在 apps/api/src/routes/index.ts 中
 *   import { registerCashbackTermsWatchRoutes } from "./cashback-terms-watch.js";
 *   await registerCashbackTermsWatchRoutes(app, { prisma: services.prisma });
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  checkTermsWatch,
  createTermsWatch,
  isHttpUrl,
  listTermsWatches,
  normalizeMerchantDomain,
} from "../services/cashback-terms-watch-service.js";

export interface CashbackTermsWatchRouteDeps {
  prisma: PrismaClient;
}

async function requireSession(
  deps: CashbackTermsWatchRouteDeps,
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asWatchBody(body: unknown): {
  merchantName: string;
  merchantDomain: string;
  termsUrl: string;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const merchantName = asTrimmedString(b.merchantName);
  if (!merchantName || merchantName.length > 200) {
    throw new ValidationError("merchantName is required (max 200 chars)");
  }
  const domain = normalizeMerchantDomain(asTrimmedString(b.merchantDomain) ?? "");
  if (!domain || domain.length > 253) {
    throw new ValidationError(
      "merchantDomain must be a valid domain (e.g. www.merchant.example)"
    );
  }
  const termsUrl = asTrimmedString(b.termsUrl);
  if (!termsUrl || !isHttpUrl(termsUrl)) {
    throw new ValidationError("termsUrl must be a valid http(s) URL");
  }
  return { merchantName, merchantDomain: domain, termsUrl };
}

export async function registerCashbackTermsWatchRoutes(
  app: FastifyInstance,
  deps: CashbackTermsWatchRouteDeps
): Promise<void> {
  app.get("/api/v1/cashback/terms-watches", async (request: FastifyRequest) => {
    const { tenantId } = await requireSession(deps, request);
    const watches = await listTermsWatches(deps.prisma, tenantId);
    return { items: watches };
  });

  app.post("/api/v1/cashback/terms-watches", async (request: FastifyRequest) => {
    const { tenantId } = await requireSession(deps, request);
    const input = asWatchBody(request.body);
    const watch = await createTermsWatch(deps.prisma, tenantId, input);
    return { watch };
  });

  app.post(
    "/api/v1/cashback/terms-watches/:id/check",
    async (request: FastifyRequest) => {
      const { tenantId } = await requireSession(deps, request);
      const params = request.params as { id?: string };
      const id = asTrimmedString(params.id);
      if (!id || !UUID_RE.test(id)) {
        throw new ValidationError("Invalid watch id");
      }
      const watches = await listTermsWatches(deps.prisma, tenantId);
      const watch = watches.find((w) => w.id === id);
      if (!watch) {
        throw new NotFoundError("Terms watch not found");
      }
      // 手动检查：实时抓取（SSRF-safe，10s 超时）；抓取失败只记 blocked。
      const result = await checkTermsWatch(deps.prisma, watch);
      return { result };
    }
  );
}
