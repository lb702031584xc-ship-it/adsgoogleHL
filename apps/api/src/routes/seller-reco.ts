/**
 * 卖家工具 AI 推荐路由。
 *
 * POST /api/v1/ai/seller-recommendations（挂在 /api/v1/ai/ 下，复用既有
 * AI 限流 hook：20 次/分钟 + 200 次/天，Redis 不可用时 fail-open）。
 * 会话认证 only；凭证全部走既有加密设置：
 * - DataForSEO：AiSetting traffic.dataforseoLogin / traffic.dataforseoPassword
 * - 大模型：AiSetting llm.baseUrl / llm.model / llm.apiKeyEnc（全局配置，
 *   v1 不做租户级覆盖，与管理控制台 AI 设置同一处填写）
 * 未配置/未验证时返回可读的明示错误，绝不回退到无证据的模型推荐。
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import { authenticateSessionRequest } from "../auth/sessions.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import { chatJson, type ChatJsonArgs } from "../ai/llm.js";
import { readEncryptedTrafficSetting } from "../traffic/settings.js";
import {
  DataForSeoUnverifiedError,
  recommendSellerProducts,
} from "../ai/seller-reco.js";

export interface SellerRecoRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: (args: ChatJsonArgs) => Promise<unknown>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export async function registerSellerRecoRoutes(
  app: FastifyInstance,
  deps: SellerRecoRouteDeps
): Promise<void> {
  const { prisma } = deps;
  app.post("/api/v1/ai/seller-recommendations", async (request, reply) => {
    const info =
      request.sessionAuth ??
      (await authenticateSessionRequest(prisma, request));
    if (!info) {
      throw new UnauthorizedError("Authentication required");
    }
    const body = (request.body ?? {}) as {
      direction?: unknown;
      limit?: unknown;
    };
    const direction =
      typeof body.direction === "string" ? body.direction.trim() : "";
    if (direction.length < 2 || direction.length > 80) {
      throw new ValidationError("方向需为 2–80 字");
    }
    const limitRaw =
      typeof body.limit === "number" ? Math.floor(body.limit) : 5;
    const limit = Math.min(10, Math.max(3, limitRaw || 5));

    const login = await readEncryptedTrafficSetting(
      prisma,
      "traffic.dataforseoLogin"
    );
    const password = await readEncryptedTrafficSetting(
      prisma,
      "traffic.dataforseoPassword"
    );
    if (!login || !password) {
      return reply.code(400).send({
        message:
          "未配置 DataForSEO 凭证：请先在管理控制台 → AI 设置里填写 DataForSEO 登录账号与密码，并在 app.dataforseo.com 完成账号验证。",
      });
    }
    const rows = (await prisma.aiSetting.findMany()) as Array<{
      key: string;
      value: string;
    }>;
    let baseUrl: string | undefined;
    let model: string | undefined;
    let apiKeyEnc: string | undefined;
    for (const r of rows) {
      if (r.key === "llm.baseUrl") baseUrl = r.value;
      else if (r.key === "llm.model") model = r.value;
      else if (r.key === "llm.apiKeyEnc") apiKeyEnc = r.value;
    }
    if (!baseUrl || !model || !apiKeyEnc) {
      return reply.code(400).send({
        message:
          "未配置 AI 模型：请先在管理控制台 → AI 设置里填写模型地址、模型与密钥。",
      });
    }
    let apiKey: string;
    try {
      apiKey = decryptSecret(
        apiKeyEnc,
        assertAiSettingsPepperConfigured()
      );
    } catch {
      return reply.code(400).send({
        message: "AI 密钥解密失败：请检查服务器 AI 设置 pepper 配置。",
      });
    }
    if (!apiKey) {
      return reply.code(400).send({
        message: "AI 密钥为空：请在管理控制台 → AI 设置里重新保存密钥。",
      });
    }
    try {
      const result = await recommendSellerProducts(
        {
          fetchImpl: deps.fetchImpl ?? fetch,
          chatJsonImpl: deps.chatJsonImpl ?? chatJson,
          dataforseoCreds: { login, password },
          llm: { baseUrl, model, apiKey },
        },
        { direction, limit }
      );
      return result;
    } catch (e) {
      if (e instanceof DataForSeoUnverifiedError) {
        return reply.code(502).send({
          message:
            "DataForSEO 账号未验证：请先去 app.dataforseo.com 完成账号验证，再重试（服务端改不了验证状态）。",
        });
      }
      if (e instanceof Error) {
        return reply.code(502).send({ message: e.message });
      }
      throw e;
    }
  });
}
