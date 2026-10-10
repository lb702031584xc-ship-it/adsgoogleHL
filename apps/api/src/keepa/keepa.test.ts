/**
 * Keepa 自动筛选单测：csv fixture 解析、规则边界（跳水品/平稳品/数据缺失）、
 * client 错误映射（429/token 不足/无数据/网络失败）。
 */
import { describe, expect, it, vi } from "vitest";
import { fetchKeepaProduct } from "./client.js";
import { computeKeepaMetrics, evaluateKeepa } from "./rules.js";

// Keepa 时间换算（官方文档）：(keepaTime + 21564000) * 60000 = Unix 毫秒
const KEEPA_OFFSET = 21564000;
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0); // 固定 now，保证测试稳定
function kt(daysAgo: number): number {
  return Math.floor(NOW / 60000) - KEEPA_OFFSET - Math.round(daysAgo * 1440);
}

/** 跳水品：30 天从 10000 跌到 7000（跌幅 30%），排名平稳，评论增长。 */
function csvDiving(): Array<number[] | null> {
  return [
    [kt(30), 10000, kt(15), 8500, kt(0), 7000], // 0=AMAZON
    null, // 1=NEW
    null, // 2=USED
    [kt(90), 120, kt(60), 110, kt(30), 130, kt(0), 125], // 3=SALES
    null, null, null, null, null, null, null, null, null, null, null, null,
    null, // 4..15
    null, // 16=RATING
    [kt(90), 500, kt(45), 620, kt(0), 700], // 17=COUNT_REVIEWS
  ];
}

/** 平稳品：价格波动 ~4%，排名中位数 ~51，评论增长，无断货。 */
function csvStable(): Array<number[] | null> {
  return [
    [kt(90), 10000, kt(60), 10300, kt(30), 9900, kt(0), 10100],
    null,
    null,
    [kt(90), 55, kt(60), 48, kt(30), 52, kt(0), 50],
    null, null, null, null, null, null, null, null, null, null, null, null,
    null,
    [kt(90), 100, kt(0), 150],
  ];
}

/** 大起大落：排名 50 → 800 → 60（max/min=16）。 */
function csvRankSwing(): Array<number[] | null> {
  return [
    [kt(90), 10000, kt(45), 10200, kt(0), 10100],
    null,
    null,
    [kt(90), 50, kt(45), 800, kt(0), 60],
    null, null, null, null, null, null, null, null, null, null, null, null,
    null,
    null,
    [kt(90), 100, kt(0), 160],
  ];
}

/** 长期断货：-1 从 60 天前持续到 10 天前（50 天）。 */
function csvStockout(): Array<number[] | null> {
  return [
    [kt(90), 10000, kt(60), -1, kt(10), 10000, kt(0), 10000],
    null,
    null,
    [kt(90), 90, kt(0), 95],
    null, null, null, null, null, null, null, null, null, null, null, null,
    null,
    null,
    [kt(90), 200, kt(0), 260],
  ];
}

describe("computeKeepaMetrics", () => {
  it("跳水品：30 天跌幅约 30%", () => {
    const m = computeKeepaMetrics(csvDiving(), NOW);
    expect(m.priceDrop30dPct).toBeCloseTo(30, 0);
    expect(m.stockoutDays90d).toBe(0);
  });

  it("平稳品：波动小、排名中位数 <100、评论增长", () => {
    const m = computeKeepaMetrics(csvStable(), NOW);
    expect(m.priceDrop30dPct).not.toBeNull();
    expect(m.rankMaxMinRatio90d).toBeLessThan(2);
    expect(m.reviewGrowth90d).toBe(50);
    expect(m.stockoutDays90d).toBe(0);
  });

  it("断货品：断货天数约 50 天", () => {
    const m = computeKeepaMetrics(csvStockout(), NOW);
    expect(m.stockoutDays90d).toBeCloseTo(50, 0);
  });

  it("空 csv：全部指标 null", () => {
    const m = computeKeepaMetrics([], NOW);
    expect(m).toEqual({
      priceDrop30dPct: null,
      rankMaxMinRatio90d: null,
      reviewGrowth90d: null,
      stockoutDays90d: null,
    });
  });
});

describe("evaluateKeepa 规则边界", () => {
  it("跳水品 → kill（price_drop）", () => {
    const r = evaluateKeepa(csvDiving(), null, NOW);
    expect(r.verdict).toBe("kill");
    expect(r.reasons.map((x) => x.code)).toContain("price_drop");
  });

  it("大起大落 → kill（rank_swing）", () => {
    const r = evaluateKeepa(csvRankSwing(), null, NOW);
    expect(r.verdict).toBe("kill");
    expect(r.reasons.map((x) => x.code)).toContain("rank_swing");
  });

  it("长期断货 → kill（stockout）", () => {
    const r = evaluateKeepa(csvStockout(), null, NOW);
    expect(r.verdict).toBe("kill");
    expect(r.reasons.map((x) => x.code)).toContain("stockout");
  });

  it("平稳品 → pass", () => {
    const r = evaluateKeepa(csvStable(), null, NOW);
    expect(r.verdict).toBe("pass");
    expect(r.reasons[0].code).toBe("pass");
  });

  it("数据缺失 → unknown（insufficient，不编数）", () => {
    const r = evaluateKeepa([], null, NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.reasons[0].code).toBe("insufficient");
    expect(r.metrics.priceDrop30dPct).toBeNull();
  });

  it("Keepa 无产品数据 → unknown（no_data）", () => {
    const r = evaluateKeepa(null, "no_data", NOW);
    expect(r.verdict).toBe("unknown");
    expect(r.reasons[0].code).toBe("no_data");
  });

  it("限流/token 不足 → unknown", () => {
    expect(evaluateKeepa([], "rate_limited", NOW).reasons[0].code).toBe("rate_limited");
    expect(evaluateKeepa([], "tokens_exhausted", NOW).reasons[0].code).toBe(
      "tokens_exhausted"
    );
  });
});

function fakeFetchJson(status: number, body: unknown) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("fetchKeepaProduct 错误映射", () => {
  it("正常返回解析 product", async () => {
    const r = await fetchKeepaProduct(
      "KEY",
      "B001",
      1,
      fakeFetchJson(200, {
        products: [{ asin: "B001", title: "T", productType: 0, csv: [] }],
        tokensLeft: 100,
      })
    );
    expect(r.error).toBeNull();
    expect(r.product?.asin).toBe("B001");
    expect(r.tokensLeft).toBe(100);
  });

  it("429 → rate_limited", async () => {
    const r = await fetchKeepaProduct("KEY", "B001", 1, fakeFetchJson(429, {}));
    expect(r.error).toBe("rate_limited");
    expect(r.product).toBeNull();
  });

  it("401 → invalid_key", async () => {
    const r = await fetchKeepaProduct("KEY", "B001", 1, fakeFetchJson(401, {}));
    expect(r.error).toBe("invalid_key");
  });

  it("tokensLeft=0 → tokens_exhausted", async () => {
    const r = await fetchKeepaProduct(
      "KEY",
      "B001",
      1,
      fakeFetchJson(200, { products: [], tokensLeft: 0 })
    );
    expect(r.error).toBe("tokens_exhausted");
  });

  it("products 为空 → no_data", async () => {
    const r = await fetchKeepaProduct(
      "KEY",
      "B001",
      1,
      fakeFetchJson(200, { products: [], tokensLeft: 50 })
    );
    expect(r.error).toBe("no_data");
  });

  it("网络异常 → network", async () => {
    const bad = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const r = await fetchKeepaProduct("KEY", "B001", 1, bad);
    expect(r.error).toBe("network");
  });
});
