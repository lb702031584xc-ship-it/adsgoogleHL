/**
 * 第九批：组合测试排名计算单测（纯函数，无 DB）。
 */
import { describe, expect, it } from "vitest";
import {
  rankComboItems,
  buildComboConclusion,
} from "./amazon-combo.js";

const ITEMS = [
  { asin: "B001", title: "Alpha", publicId: "tl_a", offerId: "o1", trackingLinkId: "l1" },
  { asin: "B002", title: "Beta", publicId: "tl_b", offerId: "o2", trackingLinkId: "l2" },
  { asin: "B003", title: "Gamma", publicId: "tl_c", offerId: "o3", trackingLinkId: "l3" },
  { asin: "B004", title: "Delta", publicId: "tl_d", offerId: "o4", trackingLinkId: "l4" },
  { asin: "B005", title: "Epsilon", publicId: "tl_e", offerId: "o5", trackingLinkId: "l5" },
];

describe("rankComboItems", () => {
  it("按出站点击数降序排名", () => {
    const r = rankComboItems(
      ITEMS,
      { l1: 10, l2: 50, l3: 30, l4: 0, l5: 5 },
      {}
    );
    expect(r.map((x) => x.title)).toEqual(["Beta", "Gamma", "Alpha", "Epsilon", "Delta"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("点击相同 → 转化数多者靠前", () => {
    const r = rankComboItems(
      ITEMS,
      { l1: 10, l2: 10 },
      { o1: 3, o2: 1 }
    );
    expect(r[0]!.title).toBe("Alpha");
    expect(r[0]!.conversions).toBe(3);
  });

  it("点击份额总和 ≈100%", () => {
    const r = rankComboItems(ITEMS, { l1: 10, l2: 50, l3: 30, l4: 0, l5: 10 }, {});
    const sum = r.reduce((s, x) => s + x.sharePct, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThanOrEqual(100.1);
  });

  it("零点击 → 份额全 0，不断言崩", () => {
    const r = rankComboItems(ITEMS, {}, {});
    expect(r.every((x) => x.sharePct === 0)).toBe(true);
    expect(r).toHaveLength(5);
  });

  it("缺失的 link 视为 0 点击", () => {
    const r = rankComboItems(ITEMS, { l2: 7 }, {});
    expect(r[0]!.title).toBe("Beta");
    expect(r[0]!.clicks).toBe(7);
  });
});

describe("buildComboConclusion", () => {
  it("完成且有点击 → 点名最高者", () => {
    const r = rankComboItems(ITEMS, { l1: 10, l2: 50 }, {});
    const c = buildComboConclusion(r, 60);
    expect(c).toContain("Beta");
    expect(c).toContain("50");
    expect(c).toContain("值得单独深入测试");
  });

  it("零点击 → 提示检查流量来源", () => {
    const r = rankComboItems(ITEMS, {}, {});
    const c = buildComboConclusion(r, 0);
    expect(c).toContain("无点击");
  });

  it("英文版", () => {
    const r = rankComboItems(ITEMS, { l3: 9 }, {});
    const c = buildComboConclusion(r, 9, "en");
    expect(c).toContain("Gamma");
  });

  it("空列表 → null", () => {
    expect(buildComboConclusion([], 0)).toBeNull();
  });
});
