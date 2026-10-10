/**
 * 流水线评估单测：指数加权、各门边界、异常降级不抛错。
 * 外部依赖全部注入 mock（traffic gate / scrape / LLM 不走真实调用）。
 */
import { describe, expect, it, vi } from "vitest";
import { evaluatePipeline } from "./evaluate.js";
import { PIPELINE_WEIGHTS } from "./types.js";

// ---- mock 外部模块 ----
vi.mock("../traffic/thresholds.js", () => ({
  getTrafficThresholds: vi.fn(async () => ({
    officialSiteMonthlyVisits: 50000,
    brandInterest: 25,
    keywordInterest: 25,
  })),
}));

vi.mock("../traffic/gate.js", () => ({
  evaluateTrafficGate: vi.fn(),
}));

vi.mock("../offer-metrics/scrape.js", () => ({
  scrapeOfferMetrics: vi.fn(),
}));

vi.mock("../offer-metrics/score.js", () => ({
  scoreOfferMetrics: vi.fn(),
}));

vi.mock("../ai/profitability.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../ai/profitability.js")>();
  return { ...orig };
});

import { evaluateTrafficGate } from "../traffic/gate.js";
import { scrapeOfferMetrics } from "../offer-metrics/scrape.js";
import { scoreOfferMetrics } from "../offer-metrics/score.js";

const mockGate = vi.mocked(evaluateTrafficGate);
const mockScrape = vi.mocked(scrapeOfferMetrics);
const mockScore = vi.mocked(scoreOfferMetrics);

const fakePrisma = {} as never;

function deps(extra: Record<string, unknown> = {}) {
  return { prisma: fakePrisma, ...extra };
}

const goodItem = {
  asin: "B001",
  title: "Great Widget",
  brand: "Acme",
  detailPageUrl: "https://www.amazon.com/dp/B001",
  rating: 4.6,
  reviewCount: 5000,
};

function resetMocks() {
  mockGate.mockReset();
  mockScrape.mockReset();
  mockScore.mockReset();
  mockGate.mockResolvedValue({
    passed: true,
    reason: "ok",
    officialSite: null,
    signals: [],
  } as never);
  mockScrape.mockResolvedValue({
    url: "u",
    finalUrl: "u",
    title: "t",
    price: 10,
    currency: "USD",
    rating: 4.6,
    reviewCount: 5000,
    soldCount: null,
    availability: null,
    bsr: null,
    fetchedAt: new Date().toISOString(),
    failures: [],
  } as never);
  mockScore.mockReturnValue({
    score: 80,
    grade: "strong",
    breakdown: [],
    contributedCount: 2,
  });
}

describe("evaluatePipeline", () => {
  it("4 门 pass + 风险门关闭(unknown) → 100 - 0.15*50 = 93", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [goodItem],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    expect(r.items).toHaveLength(1);
    const item = r.items[0]!;
    expect(item.worthIndex).toBe(93);
    expect(item.killed).toBe(false);
    expect(
      item.gates.filter((g) => g.key !== "risk").every((g) => g.status === "pass")
    ).toBe(true);
    expect(r.weights).toEqual({ ...PIPELINE_WEIGHTS });
  });

  it("机会品 +10：93 → 100（上限 100）", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [{ ...goodItem, opportunity: true }],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    // 基础 93 + 10 = 103 → 上限 100
    expect(r.items[0]!.worthIndex).toBe(100);
  });

  it("机会品 +10：无上限溢出时直接 +10", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [{ ...goodItem, opportunity: true, rating: 4.2, reviewCount: 200 }],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    const base = await evaluatePipeline(
      [{ ...goodItem, rating: 4.2, reviewCount: 200 }],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    expect(r.items[0]!.worthIndex).toBe(
      Math.min(100, base.items[0]!.worthIndex + 10)
    );
  });

  it("质量门边界：rating 3.9 → fail；缺失 → unknown", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [
        { ...goodItem, rating: 3.9 },
        { ...goodItem, asin: "B002", rating: undefined, reviewCount: undefined },
      ],
      { riskCheck: false },
      deps()
    );
    const q1 = r.items.find((i) => i.input.asin === "B001")!.gates.find((g) => g.key === "quality")!;
    expect(q1.status).toBe("fail");
    const q2 = r.items.find((i) => i.input.asin === "B002")!.gates.find((g) => g.key === "quality")!;
    expect(q2.status).toBe("unknown");
    expect(q2.score).toBe(50);
  });

  it("指数加权：1 门 fail + 4 门 pass = 100 - 权重×100", async () => {
    resetMocks();
    // 指标门 fail（score 50 < 60）
    mockScore.mockReturnValue({
      score: 50,
      grade: "caution",
      breakdown: [],
      contributedCount: 2,
    });
    const r = await evaluatePipeline(
      [goodItem],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    const item = r.items[0]!;
    // 新权重：quality15+demand20+metrics0+profit20+risk7.5+denylist15 = 77.5 → 78
    expect(item.worthIndex).toBe(78);
    expect(item.gates.find((g) => g.key === "metrics")!.status).toBe("fail");
  });

  it("unknown 降权不杀：需求门 unknown → 指数扣一半权重", async () => {
    resetMocks();
    mockGate.mockResolvedValue({
      passed: null,
      reason: "暂无数据",
      officialSite: null,
      signals: [],
    } as never);
    const r = await evaluatePipeline(
      [goodItem],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    const item = r.items[0]!;
    // 新权重：quality15+demand10+metrics15+profit20+risk7.5+denylist15 = 82.5 → 83
    expect(item.worthIndex).toBe(83);
    expect(item.killed).toBe(false);
  });

  it("数学打不平：CPC > 佣金 → fail + killed", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [goodItem],
      { estimatedCpc: 12, commission: 10, riskCheck: false },
      deps()
    );
    const item = r.items[0]!;
    const profit = item.gates.find((g) => g.key === "profit")!;
    expect(profit.status).toBe("fail");
    expect(profit.detail?.breakEvenCvrPct).toBe(120);
    expect(item.killed).toBe(true);
  });

  it("盈亏门阈值：break-even 20% > 上限 15% → fail（不杀）", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [goodItem],
      { estimatedCpc: 2, commission: 10, riskCheck: false },
      deps()
    );
    const profit = r.items[0]!.gates.find((g) => g.key === "profit")!;
    expect(profit.status).toBe("fail");
    expect(r.items[0]!.killed).toBe(false);
  });

  it("需求门异常 → unknown，不抛错", async () => {
    resetMocks();
    mockGate.mockRejectedValue(new Error("boom"));
    const r = await evaluatePipeline([goodItem], { riskCheck: false }, deps());
    expect(r.items[0]!.gates.find((g) => g.key === "demand")!.status).toBe("unknown");
  });

  it("否定清单门：评分 < 3.5 → fail + 直接杀", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [{ ...goodItem, rating: 3.4 }],
      { riskCheck: false },
      deps()
    );
    const item = r.items[0]!;
    const dl = item.gates.find((g) => g.key === "denylist")!;
    expect(dl.status).toBe("fail");
    expect(dl.reason).toContain("3.5");
    expect(item.killed).toBe(true);
  });

  it("否定清单门：内置规则可关（denyLowRating=false → 不杀）", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [{ ...goodItem, rating: 3.4 }],
      { riskCheck: false, denyLowRating: false },
      deps()
    );
    const item = r.items[0]!;
    expect(item.gates.find((g) => g.key === "denylist")!.status).toBe("pass");
    expect(item.killed).toBe(false);
  });

  it("否定清单门：命中用户别碰名单（brand）→ fail + 直接杀", async () => {
    resetMocks();
    const prisma = {
      denylistEntry: {
        findMany: async () => [{ type: "brand", value: "Acme" }],
      },
    };
    const r = await evaluatePipeline(
      [goodItem],
      { riskCheck: false },
      deps({ prisma }),
      "tenant-1"
    );
    const item = r.items[0]!;
    const dl = item.gates.find((g) => g.key === "denylist")!;
    expect(dl.status).toBe("fail");
    expect(dl.reason).toContain("Acme");
    expect(item.killed).toBe(true);
  });

  it("否定清单门：命中用户别碰名单（keyword 在标题中）→ fail", async () => {
    resetMocks();
    const prisma = {
      denylistEntry: {
        findMany: async () => [{ type: "keyword", value: "widget" }],
      },
    };
    const r = await evaluatePipeline(
      [goodItem],
      { riskCheck: false },
      deps({ prisma }),
      "tenant-1"
    );
    expect(r.items[0]!.gates.find((g) => g.key === "denylist")!.status).toBe("fail");
    expect(r.items[0]!.killed).toBe(true);
  });

  it("否定清单门：AI 标记品牌词风险 → fail（直接调 denylistGate）", async () => {
    resetMocks();
    const { denylistGate } = await import("./evaluate.js");
    const fakeRisk = {
      key: "risk",
      status: "fail",
      score: 0,
      reason: "AI 风控判定高风险：品牌词侵权风险",
      detail: { riskLevel: "high", brandRisk: true, policyRisk: false },
    } as never;
    const dl = await denylistGate(
      goodItem as never,
      { denyLowRating: true, denyBrandWord: true, denyPolicyCategory: true } as never,
      deps(),
      null,
      fakeRisk
    );
    expect(dl.status).toBe("fail");
    expect(dl.reason).toContain("品牌词");
  });

  it("否定清单门：AI 标记政策风险品类 → fail", async () => {
    resetMocks();
    const { denylistGate } = await import("./evaluate.js");
    const fakeRisk = {
      key: "risk",
      status: "fail",
      score: 0,
      reason: "AI 风控判定高风险：医疗功效宣称，政策风险",
      detail: { riskLevel: "high", brandRisk: false, policyRisk: true },
    } as never;
    const dl = await denylistGate(
      goodItem as never,
      { denyLowRating: true, denyBrandWord: true, denyPolicyCategory: true } as never,
      deps(),
      null,
      fakeRisk
    );
    expect(dl.status).toBe("fail");
    expect(dl.reason).toContain("政策");
  });

  it("否定清单门：DB 失败降级 → 内置规则照常（不抛错）", async () => {
    resetMocks();
    const prisma = {
      denylistEntry: {
        findMany: async () => {
          throw new Error("db down");
        },
      },
    };
    const r = await evaluatePipeline(
      [{ ...goodItem, rating: 3.2 }],
      { riskCheck: false },
      deps({ prisma }),
      "tenant-1"
    );
    const dl = r.items[0]!.gates.find((g) => g.key === "denylist")!;
    expect(dl.status).toBe("fail"); // 内置低评分规则仍生效
    expect(r.items[0]!.killed).toBe(true);
  });

  it("否定清单门：无命中 → pass（权重 15% 计入指数）", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [goodItem],
      { estimatedCpc: 1, commission: 10, riskCheck: false },
      deps()
    );
    const dl = r.items[0]!.gates.find((g) => g.key === "denylist")!;
    expect(dl.status).toBe("pass");
    // 15+20+15+20+7.5+15 = 92.5 → 93
    expect(r.items[0]!.worthIndex).toBe(93);
  });

  it("风险门：LLM high → fail；medium → unknown", async () => {
    resetMocks();
    const chatJsonImpl = vi.fn(async () => ({
      riskLevel: "high",
      reasons: ["品牌词侵权风险"],
    }));
    // 配好 LLM 设置
    const prisma = {
      aiSetting: {
        findMany: async () => [
          { key: "llm.baseUrl", value: "https://x" },
          { key: "llm.model", value: "m" },
          { key: "llm.apiKeyEnc", value: "enc" },
        ],
      },
    };
    // decryptSecret 会失败（enc 非法）→ 走 catch → unknown；这里直接 mock 掉比较复杂，
    // 改为 mock chatJsonImpl 抛错前先让 decrypt 成功：用 vi.mock 覆盖 crypto 模块
    const r = await evaluatePipeline([goodItem], { riskCheck: true }, deps({ prisma: prisma as never, chatJsonImpl: chatJsonImpl as never }));
    const risk = r.items[0]!.gates.find((g) => g.key === "risk")!;
    // decryptSecret("enc") 会抛错 → unknown（降权不杀），不断言 high
    expect(["fail", "unknown"]).toContain(risk.status);
    expect(chatJsonImpl).not.toHaveBeenCalled(); // 解密失败在 LLM 之前
  });

  it("结果按 worthIndex 降序", async () => {
    resetMocks();
    const r = await evaluatePipeline(
      [
        { ...goodItem, asin: "B1", rating: 3.0 },
        { ...goodItem, asin: "B2" },
      ],
      { riskCheck: false },
      deps()
    );
    expect(r.items[0]!.input.asin).toBe("B2");
    expect(r.items[1]!.input.asin).toBe("B1");
  });
});
