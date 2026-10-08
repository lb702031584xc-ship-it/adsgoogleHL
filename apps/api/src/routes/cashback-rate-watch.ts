/**
 * 功能 1 — 返利比例监控（rate-watch）API。
 *
 * 纯新增端点（由协调器在 routes/index.ts 中注册，本文件不改动现有路由）：
 * - GET  /api/v1/cashback/rate-checks          ?offerId= （不带则返回每个 offer 的最新一次检查）
 * - POST /api/v1/cashback/offers/:id/rate      { advertisedRate, rateUrl? }（设置宣传比例+抓取URL，并立即检查一次）
 *
 * Session 鉴权 + tenantId 隔离，参考 cashback.ts。
 * CashbackRateCheck 通过 service 的 raw-SQL store 读写（Prisma client 尚无该表 delegate）。
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
  checkSingleOffer,
  listLatestRateChecks,
  listRateCheckHistory,
  parseRate,
  type RateCheckStore,
  type RatePageFetch,
} from "../services/cashback-rate-watch-service.js";

export interface CashbackRateWatchRouteDeps {
  prisma: PrismaClient;
  /** 测试注入（默认 raw-SQL 实现）。 */
  rateCheckStore?: RateCheckStore;
  /** 测试注入（默认 fetchPageHtml SSRF-safe 抓取）。 */
  fetchImpl?: RatePageFetch;
}

async function requireSession(
  deps: CashbackRateWatchRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const session = await authenticateSessionRequest(deps.prisma, request);
  if (!session) {
    throw new UnauthorizedError("未登录");
  }
  return session;
}

function isValidRateUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function registerCashbackRateWatchRoutes(
  app: FastifyInstance,
  deps: CashbackRateWatchRouteDeps
): void {
  // GET /api/v1/cashback/rate-checks — 列表
  app.get(
    "/api/v1/cashback/rate-checks",
    async (request: FastifyRequest<{ Querystring: { offerId?: string } }>) => {
      const session = await requireSession(deps, request);
      const { offerId } = request.query;
      if (offerId) {
        return {
          checks: await listRateCheckHistory(
            deps.prisma,
            session.tenantId,
            offerId,
            50,
            deps.rateCheckStore
          ),
        };
      }
      return {
        checks: await listLatestRateChecks(
          deps.prisma,
          session.tenantId,
          deps.rateCheckStore
        ),
      };
    }
  );

  // POST /api/v1/cashback/offers/:id/rate — 设置宣传比例+抓取URL，并立即检查
  app.post(
    "/api/v1/cashback/offers/:id/rate",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { advertisedRate?: unknown; rateUrl?: unknown };
      }>
    ) => {
      const session = await requireSession(deps, request);
      const { id } = request.params;
      const body = (request.body ?? {}) as {
        advertisedRate?: unknown;
        rateUrl?: unknown;
      };

      const advertisedRate =
        typeof body.advertisedRate === "string"
          ? body.advertisedRate.trim()
          : "";
      if (!advertisedRate) {
        throw new ValidationError("advertisedRate 必填，例如 \"8%\"");
      }
      if (!parseRate(advertisedRate)) {
        throw new ValidationError(
          "advertisedRate 无法解析，需要形如 \"8%\" 或 \"$12\" 的比例"
        );
      }

      let rateUrl: string | undefined;
      if (body.rateUrl !== undefined && body.rateUrl !== null) {
        if (typeof body.rateUrl !== "string" || !isValidRateUrl(body.rateUrl)) {
          throw new ValidationError("rateUrl 必须是 http(s) URL");
        }
        rateUrl = body.rateUrl.trim();
      }

      const offer = await deps.prisma.cashbackOffer.findFirst({
        where: {
          id,
          tenantId: session.tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          tenantId: true,
          cashbackNetwork: true,
          originalUrl: true,
          status: true,
        },
      });
      if (!offer) {
        throw new NotFoundError("返利 offer 不存在");
      }

      const { check, alertCreated } = await checkSingleOffer(
        deps.prisma,
        session.tenantId,
        {
          id: offer.id,
          tenantId: offer.tenantId,
          cashbackNetwork: offer.cashbackNetwork,
          originalUrl: offer.originalUrl,
        },
        {
          advertisedRate,
          rateUrl,
          fetchImpl: deps.fetchImpl,
          store: deps.rateCheckStore,
        }
      );
      return { check, alertCreated };
    }
  );
}
