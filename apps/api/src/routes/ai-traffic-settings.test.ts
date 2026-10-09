/**
 * AI 设置中的流量数据源凭证（SimilarWeb / DataForSEO）读写单测。
 *
 * - PUT 接受 body.traffic = { similarwebKey?, dataforseoLogin?, dataforseoPassword? }，
 *   非空字符串加密存入 AiSetting；空字符串表示不修改已有值。
 * - GET 只返回 hasTrafficSimilarweb / hasTrafficDataforseo 布尔值，永不返回明文。
 */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAiRoutes } from "./ai.js";
import { decryptSecret, TEST_AI_SETTINGS_PEPPER } from "../ai/crypto.js";

type Row = { key: string; value: string };

function makeFakePrisma() {
  const store = new Map<string, string>();
  return {
    store,
    aiSetting: {
      findMany: async (): Promise<Row[]> =>
        [...store.entries()].map(([key, value]) => ({ key, value })),
      findUnique: async ({
        where,
      }: {
        where: { key: string };
      }): Promise<Row | null> => {
        const value = store.get(where.key);
        return value === undefined ? null : { key: where.key, value };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: Row;
        update: Partial<Row>;
      }): Promise<Row> => {
        const value = (update.value ?? create.value) as string;
        store.set(where.key, value);
        return { key: where.key, value };
      },
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  // 直接注入 admin 会话，绕过真实 session 查库。
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u-admin",
      email: "admin@example.com",
      name: "admin",
      role: "admin",
      tenantId: "t1",
    };
    done();
  });
  await registerAiRoutes(app, { prisma: fake as unknown as PrismaClient });
  return app;
}

function storedPlain(fake: FakePrisma, key: string): string | null {
  const enc = fake.store.get(key);
  if (!enc) return null;
  return decryptSecret(enc, TEST_AI_SETTINGS_PEPPER);
}

describe("AI settings 流量数据源凭证", () => {
  let fake: FakePrisma;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    fake = makeFakePrisma();
    app = await buildApp(fake);
  });

  it("GET 未配置时两个布尔值均为 false", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ai/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasTrafficSimilarweb).toBe(false);
    expect(body.hasTrafficDataforseo).toBe(false);
  });

  it("PUT 保存后 GET 返回 true，且落盘为密文", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: {
        traffic: {
          similarwebKey: "sw-key-123",
          dataforseoLogin: "dfs-login",
          dataforseoPassword: "dfs-pass",
        },
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().hasTrafficSimilarweb).toBe(true);
    expect(put.json().hasTrafficDataforseo).toBe(true);

    // 落盘的是密文，不是明文；且可解密回原文
    expect(fake.store.get("traffic.similarwebKey")).not.toBe("sw-key-123");
    expect(storedPlain(fake, "traffic.similarwebKey")).toBe("sw-key-123");
    expect(storedPlain(fake, "traffic.dataforseoLogin")).toBe("dfs-login");
    expect(storedPlain(fake, "traffic.dataforseoPassword")).toBe("dfs-pass");

    const get = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
    });
    expect(get.statusCode).toBe(200);
    const body = get.json();
    expect(body.hasTrafficSimilarweb).toBe(true);
    expect(body.hasTrafficDataforseo).toBe(true);
    // 明文永不出现在 GET 返回里
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("sw-key-123");
    expect(raw).not.toContain("dfs-login");
    expect(raw).not.toContain("dfs-pass");
  });

  it("空字符串不覆盖已有 key", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: {
        traffic: {
          similarwebKey: "sw-original",
          dataforseoLogin: "login-original",
          dataforseoPassword: "pass-original",
        },
      },
    });

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: {
        traffic: { similarwebKey: "", dataforseoLogin: "   " },
      },
    });
    expect(put.statusCode).toBe(200);

    expect(storedPlain(fake, "traffic.similarwebKey")).toBe("sw-original");
    expect(storedPlain(fake, "traffic.dataforseoLogin")).toBe("login-original");
    expect(storedPlain(fake, "traffic.dataforseoPassword")).toBe("pass-original");

    const get = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
    });
    expect(get.json().hasTrafficSimilarweb).toBe(true);
    expect(get.json().hasTrafficDataforseo).toBe(true);
  });

  it("只配了 dataforseoLogin 而无 password 时 hasTrafficDataforseo 为 false", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: { traffic: { dataforseoLogin: "only-login" } },
    });
    const get = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
    });
    expect(get.json().hasTrafficDataforseo).toBe(false);
    expect(get.json().hasTrafficSimilarweb).toBe(false);
  });

  it("traffic 非对象时 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: { traffic: "not-an-object" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("只传全空 traffic 对象时返回 200（no-op，不覆盖已有值）", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: { traffic: { similarwebKey: "sw-keep" } },
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      payload: { traffic: { similarwebKey: "" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hasTrafficSimilarweb).toBe(true);
    expect(storedPlain(fake, "traffic.similarwebKey")).toBe("sw-keep");
  });
});
