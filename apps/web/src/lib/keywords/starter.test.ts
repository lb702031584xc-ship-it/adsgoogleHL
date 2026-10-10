/**
 * 第十六批：关键词启动包模板生成单测。
 */
import { describe, expect, it } from "vitest";
import {
  STARTER_CATEGORIES,
  generateStarterKeywords,
  flattenStarterKeywords,
} from "./starter";

describe("STARTER_CATEGORIES", () => {
  it("6 个类目，中英双语名 + 种子词", () => {
    expect(STARTER_CATEGORIES).toHaveLength(6);
    for (const c of STARTER_CATEGORIES) {
      expect(c.nameZh).toBeTruthy();
      expect(c.nameEn).toBeTruthy();
      expect(c.seeds.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("generateStarterKeywords", () => {
  it("三组模板齐全", () => {
    const groups = generateStarterKeywords("electronics");
    expect(groups.map((g) => g.template)).toEqual(["best", "review", "vs"]);
  });

  it("best/review 每组一种子一词", () => {
    const groups = generateStarterKeywords("pet");
    const best = groups.find((g) => g.template === "best")!;
    const review = groups.find((g) => g.template === "review")!;
    expect(best.keywords).toContain("best cat tree");
    expect(review.keywords).toContain("cat tree review");
    expect(best.keywords).toHaveLength(4);
    expect(review.keywords).toHaveLength(4);
  });

  it("vs 为相邻种子两两对比", () => {
    const groups = generateStarterKeywords("beauty");
    const vs = groups.find((g) => g.template === "vs")!;
    expect(vs.keywords[0]).toBe("vitamin c serum vs electric toothbrush");
    expect(vs.keywords).toHaveLength(3);
  });

  it("未知类目 → 空数组（不抛错）", () => {
    // @ts-expect-error 故意传非法值
    expect(generateStarterKeywords("nope")).toEqual([]);
  });
});

describe("flattenStarterKeywords", () => {
  it("拍平三组", () => {
    const groups = generateStarterKeywords("baby");
    const flat = flattenStarterKeywords(groups);
    expect(flat).toHaveLength(4 + 4 + 3);
    expect(flat).toContain("best baby monitor");
  });
});
