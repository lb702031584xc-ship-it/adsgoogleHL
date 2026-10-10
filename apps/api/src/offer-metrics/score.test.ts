/**
 * 推荐指数单测：满分/零分/缺失字段/权重归一化/等级边界。
 */
import { describe, expect, it } from "vitest";
import { scoreOfferMetrics, gradeFor } from "./score.js";

describe("scoreOfferMetrics", () => {
  it("满分：5 星 + 1 万评论 + 10 万销量 → 100", () => {
    const s = scoreOfferMetrics({ rating: 5, reviewCount: 10000, soldCount: 100000 });
    expect(s.score).toBe(100);
    expect(s.grade).toBe("strong");
    expect(s.contributedCount).toBe(3);
  });

  it("零分：0 星 + 0 评论 + 0 销量 → 0", () => {
    const s = scoreOfferMetrics({ rating: 0, reviewCount: 0, soldCount: 0 });
    expect(s.score).toBe(0);
    expect(s.grade).toBe("avoid");
  });

  it("全部缺失 → score null（不编分）", () => {
    const s = scoreOfferMetrics({ rating: null, reviewCount: null, soldCount: null });
    expect(s.score).toBe(null);
    expect(s.grade).toBe(null);
    expect(s.contributedCount).toBe(0);
    expect(s.breakdown.every((b) => !b.contributed)).toBe(true);
  });

  it("只有评分 → 按 rating 单项计分（权重归一化）", () => {
    const s = scoreOfferMetrics({ rating: 4, reviewCount: null, soldCount: null });
    expect(s.score).toBe(80); // 4/5*100
    expect(s.contributedCount).toBe(1);
    expect(s.grade).toBe("strong");
  });

  it("只有评论数 9999 → log10(10000)/4*100 = 100", () => {
    const s = scoreOfferMetrics({ rating: null, reviewCount: 9999, soldCount: null });
    expect(s.score).toBe(100);
  });

  it("breakdown 列出每项得分、权重、是否贡献", () => {
    const s = scoreOfferMetrics({ rating: 5, reviewCount: null, soldCount: 100 });
    expect(s.breakdown).toHaveLength(3);
    const r = s.breakdown.find((b) => b.key === "rating")!;
    expect(r).toMatchObject({ weight: 0.4, contributed: true, rawValue: 5, score: 100 });
    const rc = s.breakdown.find((b) => b.key === "reviewCount")!;
    expect(rc.contributed).toBe(false);
    expect(rc.score).toBe(null);
  });
});

describe("gradeFor", () => {
  it("等级边界", () => {
    expect(gradeFor(80)).toBe("strong");
    expect(gradeFor(79)).toBe("good");
    expect(gradeFor(60)).toBe("good");
    expect(gradeFor(59)).toBe("caution");
    expect(gradeFor(40)).toBe("caution");
    expect(gradeFor(39)).toBe("avoid");
  });
});
