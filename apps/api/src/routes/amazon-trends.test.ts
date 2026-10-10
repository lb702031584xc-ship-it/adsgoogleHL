/**
 * 热销日历 API 单测：
 * - GET /calendar：国家校验、时间线结构
 * - POST /recommend：缓存命中、LLM 未配置 → 503、LLM 失败 → 503（不编数据）
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAmazonTrendsRoutes } from "./amazon-trends.js";
import { encryptSecret, TEST_AI_SETTINGS_PEPPER } from "../ai/crypto.js";

type Row = { key: string; value: string };

function makeFakePrisma() {
  const store = new Map<string, string>();
  return {
    store,
    aiSetting: {
      findMany: async (): Promise<Row[]> =>
        [...store.entries()].map(([key, value]) => ({ key, value })),
    },
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    incr: vi.fn(async (key: string) => {
      const n = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
  };
}
type FakeRedis = ReturnType<typeof makeFakeRedis>;

async function buildApp(
  fake: FakePrisma,
  redis: FakeRedis,
  chatJsonImpl?: (args: unknown) => Promise<unknown>
) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u1",
      email: "u@example.com",
      name: "u",
      role: "member",
      tenantId: "t1",
    };
    done();
  });
  await registerAmazonTrendsRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: redis as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chatJsonImpl: chatJsonImpl as any,
  });
  return app;
}

function seedLlm(fake: FakePrisma) {
  const p = TEST_AI_SETTINGS_PEPPER;
  fake.store.set("llm.baseUrl", "https://api.deepseek.com");
  fake.store.set("llm.model", "deepseek-chat");
  fake.store.set("llm.apiKeyEnc", encryptSecret("sk-test", p));
}

const llmOk = {
  categories: [
    {
      name: "万圣节服装",
      examples: ["吸血鬼斗篷", "南瓜灯装饰"],
      reason: "万圣节临近",
      keywords: ["halloween costume", "pumpkin decor"],
      adAngle: "派对季必备装扮",
    },
    {
      name: "圣诞装饰",
      examples: ["LED 灯串", "圣诞树"],
      reason: "圣诞备货期",
      keywords: ["christmas lights", "xmas tree"],
      adAngle: "提前布置圣诞氛围",
    },
    {
      name: "电子产品",
      examples: ["蓝牙音箱", "智能插座"],
      reason: "黑五促销季",
      keywords: ["bluetooth speaker", "smart plug"],
      adAngle: "黑五囤货好时机",
    },
  ],
};

describe("GET /api/v1/amazon/trends/calendar", () => {
  let fake: FakePrisma;
  let redis: FakeRedis;
  beforeEach(() => {
    fake = makeFakePrisma();
    redis = makeFakeRedis();
  });

  it("默认 US，返回时间线 + 现在热销", async () => {
    const app = await buildApp(fake, redis);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/amazon/trends/calendar",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.country).toBe("US");
    expect(Array.isArray(body.upcoming)).toBe(true);
    expect(Array.isArray(body.now.hotCategories)).toBe(true);
    // 倒计时排序
    const days = body.upcoming.map((h: { daysLeft: number }) => h.daysLeft);
    expect([...days].sort((a: number, b: number) => a - b)).toEqual(days);
    await app.close();
  });

  it("非法国家 → 400", async () => {
    const app = await buildApp(fake, redis);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/amazon/trends/calendar?country=XX",
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("country 大小写不敏感", async () => {
    const app = await buildApp(fake, redis);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/amazon/trends/calendar?country=jp",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().country).toBe("JP");
    await app.close();
  });
});

describe("POST /api/v1/amazon/trends/recommend", () => {
  let fake: FakePrisma;
  let redis: FakeRedis;
  beforeEach(() => {
    fake = makeFakePrisma();
    redis = makeFakeRedis();
  });

  it("LLM 未配置 → 503 + 明确文案，不编数据", async () => {
    const app = await buildApp(fake, redis, async () => llmOk);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/trends/recommend",
      payload: { country: "US" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toContain("LLM 未配置");
    await app.close();
  });

  it("LLM 调用失败 → 503，不返回编造数据", async () => {
    seedLlm(fake);
    const app = await buildApp(fake, redis, async () => {
      throw new Error("boom");
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/trends/recommend",
      payload: { country: "US" },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("LLM 成功 → 返回推荐并写入 7 天缓存；第二次命中缓存不再调 LLM", async () => {
    seedLlm(fake);
    const spy = vi.fn(async () => llmOk);
    const app = await buildApp(fake, redis, spy);
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/trends/recommend",
      payload: { country: "US" },
    });
    expect(res1.statusCode).toBe(200);
    const b1 = res1.json();
    expect(b1.categories).toHaveLength(3);
    expect(b1.cached).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/trends/recommend",
      payload: { country: "US" },
    });
    const b2 = res2.json();
    expect(b2.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1); // 缓存命中，不再调 LLM
    await app.close();
  });

  it("非法国家 → 400", async () => {
    seedLlm(fake);
    const app = await buildApp(fake, redis, async () => llmOk);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/trends/recommend",
      payload: { country: "XX" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
