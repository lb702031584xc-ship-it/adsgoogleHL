/**
 * 选品流水线 API 单测：
 * - POST /run：入参校验、落库、限流
 * - GET /runs：tenant 隔离
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { registerAmazonPipelineRoutes } from "./amazon-pipeline.js";

vi.mock("../pipeline/evaluate.js", () => ({
  evaluatePipeline: vi.fn(async (items: Array<{ title: string }>) => ({
    items: items.map((it, i) => ({
      input: it,
      gates: [],
      worthIndex: 90 - i,
      killed: false,
    })),
    weights: { quality: 0.2, demand: 0.25, metrics: 0.2, profit: 0.2, risk: 0.15 },
    evaluatedAt: new Date().toISOString(),
  })),
}));

function makeFakePrisma() {
  const runs: Array<Record<string, unknown>> = [];
  return {
    runs,
    productPipelineRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, createdAt: new Date() };
        runs.push(row);
        return { id: row.id, createdAt: row.createdAt };
      }),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) => {
        return runs
          .filter((r) => r.tenantId === where.tenantId)
          .map((r) => ({
            id: r.id,
            name: r.name,
            itemCount: r.itemCount,
            createdAt: r.createdAt,
          }));
      }),
      count: vi.fn(async ({ where }: { where: { tenantId: string } }) => {
        return runs.filter((r) => r.tenantId === where.tenantId).length;
      }),
      findFirst: vi.fn(async () => null),
    },
  };
}
type FakePrisma = ReturnType<typeof makeFakePrisma>;

function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    incr: vi.fn(async (key: string) => {
      const n = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(n));
      return n;
    }),
    expire: vi.fn(async () => 1),
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
  };
}

async function buildApp(fake: FakePrisma, redis?: unknown, tenantId = "t1") {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", (request, _reply, done) => {
    request.sessionAuth = {
      id: "u1",
      email: "u@example.com",
      name: "u",
      role: "member",
      tenantId,
    };
    done();
  });
  await registerAmazonPipelineRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redis: (redis ?? makeFakeRedis()) as any,
  });
  return app;
}

const item = { title: "Widget", brand: "Acme", rating: 4.5, reviewCount: 1000 };

describe("POST /api/v1/amazon/pipeline/run", () => {
  let fake: FakePrisma;
  beforeEach(() => {
    fake = makeFakePrisma();
  });

  it("成功：评估→落库→返回排序结果", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: [item, { ...item, title: "Gadget" }], name: "test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toBeTruthy();
    expect(body.items).toHaveLength(2);
    expect(fake.runs).toHaveLength(1);
    expect(fake.runs[0]!.tenantId).toBe("t1");
    expect(fake.runs[0]!.itemCount).toBe(2);
    await app.close();
  });

  it("空 items → 400", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("超过 10 个 → 400", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: Array.from({ length: 11 }, (_, i) => ({ title: `P${i}` })) },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("缺 title → 400", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: [{ brand: "x" }] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("非法阈值 → 400", async () => {
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: [item], options: { minRating: 9 } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("超限 → 429", async () => {
    const redis = makeFakeRedis();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
    for (let i = 0; i < 10; i++) await redis.incr(`amazon-pipeline:ratelimit:t1:${stamp}`);
    const app = await buildApp(fake, redis);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: [item] },
    });
    expect(res.statusCode).toBe(429);
    await app.close();
  });
});

describe("GET /api/v1/amazon/pipeline/runs", () => {
  it("tenant 隔离", async () => {
    const fake = makeFakePrisma();
    const app1 = await buildApp(fake, undefined, "t1");
    await app1.inject({
      method: "POST",
      url: "/api/v1/amazon/pipeline/run",
      payload: { items: [item] },
    });
    const res = await app1.inject({
      method: "GET",
      url: "/api/v1/amazon/pipeline/runs",
    });
    expect(res.json().total).toBe(1);

    const app2 = await buildApp(fake, undefined, "t2");
    const res2 = await app2.inject({
      method: "GET",
      url: "/api/v1/amazon/pipeline/runs",
    });
    expect(res2.json().total).toBe(0);
    await app1.close();
    await app2.close();
  });

  it("不存在的 run → 404", async () => {
    const fake = makeFakePrisma();
    const app = await buildApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/amazon/pipeline/runs/nope",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
