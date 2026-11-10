/**
 * 返利商家粘贴筛选 vitest：解析 + 筛查 + 品牌词流量判定。
 *
 * 口径锁死在这里：返利% ≠ 佣金；Awin / Impact / CJ 硬排除；
 * PepperJam 标风险；unknown 永不进 shortlist；无量不进主投。
 */
import { describe, expect, it } from "vitest";
import {
  KNOWN_BRAND_KEYWORD_EXAMPLES,
  applyKeywordTraffic,
  brandKeywordVerdict,
  brandSeedKeyword,
  demandTierFor,
  normalizeBrandName,
  parseCashbackMerchants,
  parseKeywordTable,
  screenCashbackText,
} from "./cashback-merchant-screening";

const SAMPLE_6 = [
  "Eileen Fisher / 最高4%返利 / 5726人获得返利",
  "ROVE Dash Cam / 8%返利 / 50人获得返利",
  "Leatherman / 最高4%返利 / 4.9万人获得返利",
  "White Fox Boutique US / 最高1%返利 / 2.9万人获得返利",
  "SKIMS / 最高2%返利 / 2万人获得返利",
  "Crocs DE / 3.2%返利 / 3人获得返利",
].join("\n");

describe("parseCashbackMerchants（解析）", () => {
  it("解析最高返利%与人数：4.9万 → 49000", () => {
    const r = parseCashbackMerchants("Leatherman\n最高4%返利\n4.9万人获得返利 6人关注");
    expect(r.parsedCount).toBe(1);
    const m = r.merchants[0];
    expect(m.name).toBe("Leatherman");
    expect(m.cashbackPct).toBe(4);
    expect(m.cashbackKind).toBe("percent");
    expect(m.peopleCount).toBe(49000);
    expect(m.followerCount).toBe(6);
  });

  it("解析固定金额返利：返利最高$44", () => {
    const r = parseCashbackMerchants("PuppySpot LLC\n返利最高$44\n15人获得返利");
    expect(r.merchants[0].cashbackFixedUsd).toBe(44);
    expect(r.merchants[0].cashbackKind).toBe("fixed");
    expect(r.merchants[0].cashbackPct).toBeNull();
  });

  it("暂无返利 → 返利 null", () => {
    const r = parseCashbackMerchants("DOEN\n暂无返利\n64人成功下单");
    expect(r.merchants[0].cashbackPct).toBeNull();
    expect(r.merchants[0].cashbackKind).toBe("none");
    expect(r.merchants[0].peopleCount).toBe(64);
  });

  it("£ 价格 + HK 后缀：region HK、priceCurrency GBP", () => {
    const r = parseCashbackMerchants("Swarovski HK\n最高3%返利\nSwarovski 心形水晶手链£79");
    expect(r.merchants[0].region).toBe("HK");
    expect(r.merchants[0].priceGbp).toBe(79);
    expect(r.merchants[0].priceCurrency).toBe("GBP");
  });

  it("备注行里的 $ 价：Frasier Fir 节日蜡烛套装$58", () => {
    const r = parseCashbackMerchants("Thymes\n最高8%返利\nFrasier Fir 节日蜡烛套装$58");
    expect(r.merchants[0].name).toBe("Thymes");
    expect(r.merchants[0].priceUsd).toBe(58);
  });

  it("满$N免邮不算商品价", () => {
    const r = parseCashbackMerchants("Katie Loxton US\n3%返利\n满$50免邮");
    expect(r.merchants[0].priceUsd).toBeNull();
  });

  it("斜杠单行格式：品牌 / 返利 / 人数", () => {
    const r = parseCashbackMerchants("Eileen Fisher / 最高4%返利 / 5726人获得返利");
    expect(r.parsedCount).toBe(1);
    expect(r.merchants[0].name).toBe("Eileen Fisher");
    expect(r.merchants[0].peopleCount).toBe(5726);
  });

  it("无法解析的块计入跳过，不静默丢数", () => {
    const r = parseCashbackMerchants("Eileen Fisher / 最高4%返利 / 5726人获得返利\n\n最高8%返利");
    expect(r.parsedCount).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(r.skippedLines.length).toBe(1);
  });

  it("同品牌去重：大小写/空格不敏感，第二条计入跳过", () => {
    const r = parseCashbackMerchants(
      "ROVE Dash Cam / 8%返利 / 50人获得返利\nrove  dash cam / 8%返利 / 60人获得返利"
    );
    expect(r.parsedCount).toBe(1);
    expect(r.skippedCount).toBe(1);
    expect(normalizeBrandName("ROVE  Dash Cam")).toBe("rove dash cam");
  });

  it("品牌名带 + 号不并到上一家：Fenty Beauty + Fenty Skin", () => {
    const r = parseCashbackMerchants(
      "Swarovski HK\n最高3%返利\nFenty Beauty + Fenty Skin\n最高4%返利\n2.2万人获得返利"
    );
    expect(r.parsedCount).toBe(2);
    expect(r.merchants[1].name).toBe("Fenty Beauty + Fenty Skin");
    expect(r.merchants[1].peopleCount).toBe(22000);
  });
});

describe("demandTierFor（人数分档）", () => {
  it("≥10000 强、1000–9999 中、100–999 弱、<100 极弱、null 未知", () => {
    expect(demandTierFor(49000)).toBe("strong");
    expect(demandTierFor(5726)).toBe("medium");
    expect(demandTierFor(300)).toBe("weak");
    expect(demandTierFor(50)).toBe("veryWeak");
    expect(demandTierFor(null)).toBe("unknown");
  });
});

describe("screenCashbackText（筛查）", () => {
  it("6 家示例跑通三档：短名单 2、备选 1、排除 3", () => {
    const r = screenCashbackText(SAMPLE_6);
    expect(r.parsedCount).toBe(6);
    expect(r.counts).toEqual({ shortlist: 2, backup: 1, excluded: 3 });
    expect(r.merchants.filter((m) => m.verdict === "shortlist").map((m) => m.name)).toEqual([
      "Eileen Fisher",
      "ROVE Dash Cam",
    ]);
  });

  it("短名单 Eileen Fisher：四项齐全，佣金 $178×4%≈$7.12，盈亏平衡 $3.56", () => {
    const r = screenCashbackText(SAMPLE_6);
    const m = r.merchants.find((x) => x.name === "Eileen Fisher")!;
    expect(m.verdict).toBe("shortlist");
    expect(m.estimatedCommissionUsd).toBe(7.12);
    expect(m.breakevenCpcUsd).toBe(3.56);
    expect(m.fame).toBe("medium");
    expect(m.networkLabel).toContain("Rakuten");
    expect(m.giftFit).toBe("general");
    expect(m.commissionLabel).toContain("4%");
  });

  it("短名单 ROVE：只推 $130+ 档，$129.99×5%≈$6.50，送礼一般", () => {
    const r = screenCashbackText(SAMPLE_6);
    const m = r.merchants.find((x) => x.name === "ROVE Dash Cam")!;
    expect(m.verdict).toBe("shortlist");
    expect(m.estimatedCommissionUsd).toBe(6.5);
    expect(m.fame).toBe("strong");
    expect(m.giftReason).toContain("安全刚需");
  });

  it("网络硬排除：Awin（Tenways）、Impact（Aiper）、CJ（Michael Kors Outlet US）", () => {
    const r = screenCashbackText(
      [
        "Tenways (US) / 最高4%返利 / 236人获得返利",
        "Aiper / 6.4%返利 / 39人获得返利",
        "Michael Kors Outlet US / 最高5%返利 / 1362人获得返利",
      ].join("\n")
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded", "excluded"]);
    expect(r.merchants[0].networkLabel).toContain("Awin");
    expect(r.merchants[1].networkLabel).toContain("Impact");
    expect(r.merchants[2].networkLabel).toContain("CJ");
  });

  it("PepperJam 单独标风险不当可用：Leatherman 排除", () => {
    const r = screenCashbackText("Leatherman / 最高4%返利 / 4.9万人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("excluded");
    expect(m.networkLabel).toContain("PepperJam");
    expect(m.reason).toContain("Ascend");
  });

  it("巨头排除：The Home Depot", () => {
    const r = screenCashbackText("The Home Depot / 最高6%返利 / 4441人获得返利");
    expect(r.merchants[0].verdict).toBe("excluded");
    expect(r.merchants[0].reason).toContain("巨头非小众");
  });

  it("非美国排除：Crocs DE（DE）与 NARS CA（CA）", () => {
    const r = screenCashbackText("Crocs DE / 3.2%返利 / 3人获得返利\nNARS CA / 12%返利 / 4人获得返利");
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded"]);
    expect(r.merchants[0].reason).toContain("非美国");
  });

  it("重复/已搁置排除：Dooney 已在跑、Vevor 已有系列、Ogee 已搁置", () => {
    const r = screenCashbackText(
      "Dooney & Bourke / 4%返利 / 1.3万人获得返利\nVevor / 2.4%返利 / 9人获得返利\nOgee / 3%返利 / 100人获得返利"
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded", "excluded"]);
    expect(r.merchants[0].reason).toContain("已在跑");
    expect(r.merchants[2].reason).toContain("已搁置");
  });

  it("佣金门槛：Wildflower $35–$37 算不出 >$5 → 排除；White Fox 需求强但客单低 → 排除", () => {
    const r = screenCashbackText(
      "Wildflower Cases / 7%返利 / 5151人获得返利\nWhite Fox Boutique US / 最高1%返利 / 2.9万人获得返利"
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded"]);
    expect(r.merchants[0].demandTier).toBe("medium");
  });

  it("未知品牌永不进短名单：最多备选，佣金/网络/知名度/送礼全写未核实", () => {
    const r = screenCashbackText("Some Random Brand / 5%返利 / 500人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.knownBrand).toBe(false);
    expect(m.commissionLabel).toBe("未核实");
    expect(m.fame).toBe("unknown");
    expect(m.giftFit).toBe("unknown");
    expect(m.reason).toContain("网络未核实");
  });

  it("送礼维度进库：Thymes 送礼最强但 PepperJam 排除；Aiper 泳池淡季不适配", () => {
    const r = screenCashbackText("Thymes / 最高8%返利 / 100人获得返利\nAiper / 6.4%返利 / 39人获得返利");
    expect(r.merchants[0].giftFit).toBe("fit");
    expect(r.merchants[0].giftReason).toContain("送礼最强");
    expect(r.merchants[0].verdict).toBe("excluded");
    expect(r.merchants[1].giftFit).toBe("notFit");
    expect(r.merchants[1].giftReason).toContain("淡季");
  });
});

describe("brandKeywordVerdict（品牌词流量判定）", () => {
  it("无量：搜索量 0 → no-volume", () => {
    expect(brandKeywordVerdict({ searchVolume: 0, cpc: 0.5, breakevenCpc: 3 })).toBe("no-volume");
  });

  it("无量：搜索量 null → no-volume", () => {
    expect(brandKeywordVerdict({ searchVolume: null, cpc: 0.5, breakevenCpc: 3 })).toBe("no-volume");
  });

  it("可投：dooney & bourke bags 27,100 / $0.56 ≤ 盈亏平衡 $3.00", () => {
    expect(
      brandKeywordVerdict({ searchVolume: 27100, cpc: 0.56, breakevenCpc: 3 })
    ).toBe("investable");
  });

  it("超盈亏平衡：ogee makeup 22K / $2.08 > 盈亏平衡 $1.50", () => {
    expect(
      brandKeywordVerdict({ searchVolume: 22000, cpc: 2.08, breakevenCpc: 1.5 })
    ).toBe("over-breakeven");
  });

  it("无法判断：有量但佣金未核实（盈亏平衡 null）", () => {
    expect(
      brandKeywordVerdict({ searchVolume: 5000, cpc: 0.8, breakevenCpc: null })
    ).toBe("unknown");
  });

  it("无法判断：有量但 CPC 未知", () => {
    expect(
      brandKeywordVerdict({ searchVolume: 5000, cpc: null, breakevenCpc: 3 })
    ).toBe("unknown");
  });

  it("示例数只属于 Ogee / Dooney：三条都在库里且不套用给别人", () => {
    expect(KNOWN_BRAND_KEYWORD_EXAMPLES).toHaveLength(3);
    expect(KNOWN_BRAND_KEYWORD_EXAMPLES.map((e) => e.measure.keyword)).toEqual([
      "ogee makeup",
      "dooney & bourke bags",
      "dooney outlet",
    ]);
  });
});

describe("brandSeedKeyword（品牌词种子）", () => {
  it("去地区后缀并小写：Katie Loxton US → katie loxton", () => {
    expect(brandSeedKeyword("Katie Loxton US")).toBe("katie loxton");
    expect(brandSeedKeyword("ROVE Dash Cam")).toBe("rove dash cam");
    expect(brandSeedKeyword("Eileen Fisher")).toBe("eileen fisher");
  });
});

describe("parseKeywordTable（品牌词流量表粘贴）", () => {
  it("逗号分隔 + 千分位：dooney & bourke bags, 27,100, 0.56", () => {
    const r = parseKeywordTable("dooney & bourke bags, 27,100, 0.56");
    expect(r.parsedCount).toBe(1);
    expect(r.rows[0]).toMatchObject({ keyword: "dooney & bourke bags", searchVolume: 27100, cpc: 0.56 });
  });

  it("制表符分隔 + 22K 写法", () => {
    const r = parseKeywordTable("ogee makeup\t22K\t2.08");
    expect(r.rows[0]).toMatchObject({ keyword: "ogee makeup", searchVolume: 22000, cpc: 2.08 });
  });

  it("空量保留为 null、0 量保留为 0（都不算解析失败）", () => {
    const r = parseKeywordTable("eileen fisher, , 3.50\neileen fisher dresses, 0, 1.20");
    expect(r.parsedCount).toBe(2);
    expect(r.skippedCount).toBe(0);
    expect(r.rows[0].searchVolume).toBeNull();
    expect(r.rows[1].searchVolume).toBe(0);
  });

  it("词为空或量无法解析的行计入跳过", () => {
    const r = parseKeywordTable(", 100, 1.00\neileen fisher, abc, 1.00\neileen fisher, 100, 1.00");
    expect(r.parsedCount).toBe(1);
    expect(r.skippedCount).toBe(2);
  });
});

describe("applyKeywordTraffic（流量归属 + 升降档）", () => {
  it("短名单 + 无量 → 降为备选，理由写清不直接杀品牌", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "eileen fisher", searchVolume: 0, cpc: null, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "Eileen Fisher")!;
    expect(m.verdict).toBe("backup");
    expect(m.keywordVerdict).toBe("no-volume");
    expect(m.reason).toContain("不直接杀品牌");
    expect(result.counts.shortlist).toBe(1);
  });

  it("短名单 + 有量且 CPC ≤ 盈亏平衡 → 留在短名单", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "eileen fisher", searchVolume: 5000, cpc: 1.2, competition: "LOW", lowTopBid: 0.8, highTopBid: 1.5 },
    ]);
    const m = result.merchants.find((x) => x.name === "Eileen Fisher")!;
    expect(m.verdict).toBe("shortlist");
    expect(m.keywordVerdict).toBe("investable");
    expect(m.keywordMeasure?.lowTopBid).toBe(0.8);
  });

  it("短名单 + CPC 超盈亏平衡 → 降为备选", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "rove dash cam", searchVolume: 8000, cpc: 5.0, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "ROVE Dash Cam")!;
    expect(m.verdict).toBe("backup");
    expect(m.keywordVerdict).toBe("over-breakeven");
  });

  it("佣金未核实的备选品牌：只显示量和 CPC，不判可投/超标", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "skims", searchVolume: 90000, cpc: 0.4, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "SKIMS")!;
    expect(m.verdict).toBe("backup");
    expect(m.keywordVerdict).toBe("unknown");
    expect(m.keywordNote).toContain("佣金未核实");
  });

  it("未归属的行计入 unmatchedCount", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { unmatchedCount, appliedCount } = applyKeywordTraffic(screened, [
      { keyword: "some other brand", searchVolume: 100, cpc: 1, competition: null, lowTopBid: null, highTopBid: null },
      { keyword: "eileen fisher", searchVolume: 100, cpc: 1, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    expect(appliedCount).toBe(1);
    expect(unmatchedCount).toBe(1);
  });
});
