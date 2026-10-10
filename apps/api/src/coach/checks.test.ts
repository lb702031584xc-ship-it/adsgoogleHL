/**
 * 第十三批：教练模式检查规则单测。
 */
import { describe, expect, it } from "vitest";
import {
  checkBrandKeywords,
  checkDisclosure,
  checkMarketplaceTarget,
  checkDailyBudget,
  runCoachChecks,
} from "./checks.js";

describe("checkBrandKeywords", () => {
  it("关键词命中品牌词 → block", () => {
    const f = checkBrandKeywords(["anker charger review", "best power bank"], ["anker"]);
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toBe("brand_keyword");
    expect(f[0]!.kind).toBe("block");
    expect(f[0]!.params.keyword).toBe("anker charger review");
  });

  it("无命中 → 空", () => {
    expect(checkBrandKeywords(["best power bank"], ["anker"])).toHaveLength(0);
  });

  it("无品牌词输入 → 不检查", () => {
    expect(checkBrandKeywords(["anker charger"], [])).toHaveLength(0);
  });
});

describe("checkDisclosure", () => {
  it("含 disclosure → 通过", () => {
    expect(checkDisclosure("<p>Affiliate Disclosure: we earn commission</p>")).toBeNull();
  });

  it("含中文披露 → 通过", () => {
    expect(checkDisclosure("本站含推广披露声明")).toBeNull();
  });

  it("无披露 → block", () => {
    const f = checkDisclosure("<p>Buy this great product now!</p>");
    expect(f?.rule).toBe("disclosure");
    expect(f?.kind).toBe("block");
  });

  it("空内容 → block", () => {
    expect(checkDisclosure(""))?.not.toBeNull();
  });
});

describe("checkMarketplaceTarget", () => {
  it("amazon.com → block", () => {
    const f = checkMarketplaceTarget("https://www.amazon.com/dp/B0XYZ");
    expect(f?.rule).toBe("marketplace_target");
  });

  it("子域名归一化：smile.amazon.co.uk → block", () => {
    expect(checkMarketplaceTarget("https://smile.amazon.co.uk/x"))?.not.toBeNull();
  });

  it("普通商家域 → 通过", () => {
    expect(checkMarketplaceTarget("https://yeahpromos.com/deal")).toBeNull();
  });

  it("非法 URL → 不拦截（不误杀）", () => {
    expect(checkMarketplaceTarget("not a url")).toBeNull();
  });
});

describe("checkDailyBudget", () => {
  it("超上限 → confirm（非 block）", () => {
    const f = checkDailyBudget(100, 50);
    expect(f?.kind).toBe("confirm");
    expect(f?.rule).toBe("budget_limit");
  });

  it("未超 → null", () => {
    expect(checkDailyBudget(30, 50)).toBeNull();
  });

  it("无上限设置 → null", () => {
    expect(checkDailyBudget(100, null)).toBeNull();
  });
});

describe("runCoachChecks", () => {
  it("只检查传入的项", () => {
    const f = runCoachChecks({ url: "https://amazon.com/x" });
    expect(f).toHaveLength(1);
    expect(f[0]!.rule).toBe("marketplace_target");
  });

  it("空输入 → 无 findings", () => {
    expect(runCoachChecks({})).toHaveLength(0);
  });

  it("聚合多项", () => {
    const f = runCoachChecks({
      url: "https://amazon.com/x",
      dailyBudget: 100,
      budgetLimit: 50,
    });
    expect(f.map((x) => x.rule).sort()).toEqual(["budget_limit", "marketplace_target"]);
  });
});
