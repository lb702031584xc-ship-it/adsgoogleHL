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
  it("6 家示例跑通三档：短名单 1、备选 1、排除 4（深核后 Eileen Fisher 降级、SKIMS 排除）", () => {
    const r = screenCashbackText(SAMPLE_6);
    expect(r.parsedCount).toBe(6);
    expect(r.counts).toEqual({ shortlist: 1, backup: 1, excluded: 4 });
    expect(r.merchants.filter((m) => m.verdict === "shortlist").map((m) => m.name)).toEqual([
      "ROVE Dash Cam",
    ]);
  });

  it("备选 Eileen Fisher（深核降级）：佣金仍 $178×4%≈$7.12，盈亏平衡 $3.56，但折扣价 $111.75×4%=$4.47 跌破 $5 线", () => {
    const r = screenCashbackText(SAMPLE_6);
    const m = r.merchants.find((x) => x.name === "Eileen Fisher")!;
    expect(m.verdict).toBe("backup");
    expect(m.estimatedCommissionUsd).toBe(7.12);
    expect(m.breakevenCpcUsd).toBe(3.56);
    expect(m.fame).toBe("medium");
    expect(m.networkLabel).toContain("Rakuten");
    expect(m.giftFit).toBe("general");
    expect(m.commissionLabel).toContain("4%");
    expect(m.reason).toContain("$4.47");
  });

  it("短名单 ROVE：只推 $130+ 档，$129.99×5%≈$6.50，送礼一般", () => {
    const r = screenCashbackText(SAMPLE_6);
    const m = r.merchants.find((x) => x.name === "ROVE Dash Cam")!;
    expect(m.verdict).toBe("shortlist");
    expect(m.estimatedCommissionUsd).toBe(6.5);
    expect(m.fame).toBe("strong");
    expect(m.giftReason).toContain("安全刚需");
  });

  it("网络硬排除：Awin（Tenways）、Impact（JLab）、CJ（Michael Kors Outlet US）", () => {
    const r = screenCashbackText(
      [
        "Tenways (US) / 最高4%返利 / 236人获得返利",
        "JLab / 最高8%返利 / 154人获得返利",
        "Michael Kors Outlet US / 最高5%返利 / 1362人获得返利",
      ].join("\n")
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded", "excluded"]);
    expect(r.merchants[0].networkLabel).toContain("Awin");
    expect(r.merchants[1].networkLabel).toContain("Impact");
    expect(r.merchants[2].networkLabel).toContain("CJ");
  });

  it("Aiper 改判备选（暂缓）：新增 Rakuten #53990，费率待核，春季复评", () => {
    const r = screenCashbackText("Aiper / 6.4%返利 / 39人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.networkLabel).toContain("Rakuten");
    expect(m.networkLabel).toContain("53990");
    expect(m.giftFit).toBe("notFit");
    expect(m.giftReason).toContain("淡季");
    expect(m.reason).toContain("复评");
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
      { keyword: "rove dash cam", searchVolume: 0, cpc: null, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "ROVE Dash Cam")!;
    expect(m.verdict).toBe("backup");
    expect(m.keywordVerdict).toBe("no-volume");
    expect(m.reason).toContain("不直接杀品牌");
    expect(result.counts.shortlist).toBe(0);
  });

  it("短名单 + 有量且 CPC ≤ 盈亏平衡 → 留在短名单（ROVE 实测 4,400/$1.38 ≤ $3.25）", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "rove dash cam", searchVolume: 4400, cpc: 1.38, competition: "LOW", lowTopBid: 0.8, highTopBid: 1.5 },
    ]);
    const m = result.merchants.find((x) => x.name === "ROVE Dash Cam")!;
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

  it("佣金未核实的备选品牌：只显示量和 CPC，不判可投/超标（Bambu Lab 实测 550,000/$0.47）", () => {
    const screened = screenCashbackText("Bambu Lab / 最高1%返利 / 13人获得返利");
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "bambu lab", searchVolume: 550000, cpc: 0.47, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "Bambu Lab")!;
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

describe("深核复核终判（2026-11-10，改判 7 家）", () => {
  it("SKIMS 改判排除：主网络 Impact，常规 5% 下 $58 款仅 $2.90", () => {
    const r = screenCashbackText("SKIMS / 最高2%返利 / 2万人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("excluded");
    expect(m.networkLabel).toContain("Impact");
    expect(m.estimatedCommissionUsd).toBe(2.9);
    expect(m.reason).toContain("流量救不了");
  });

  it("Cecred 改判排除：须美国美容执照，洗发 $32×15%=$4.80 不过线", () => {
    const r = screenCashbackText("Cecred / 最高3%返利 / 7072人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("excluded");
    expect(m.estimatedCommissionUsd).toBe(4.8);
    expect(m.reason).toContain("执照");
  });

  it("JLab 改判排除：官网证实走 Impact", () => {
    const r = screenCashbackText("JLab / 最高8%返利 / 154人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("excluded");
    expect(m.networkLabel).toContain("Impact");
    expect(m.reason).toContain("jlab 40,500");
  });

  it("Fenty 改判备选：$160 Lip Vault 套装 4%–8% 下 $6.40–$12.80 单件过线", () => {
    const r = screenCashbackText("Fenty Beauty + Fenty Skin / 最高4%返利 / 2.2万人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.reason).toContain("Lip Vault");
    expect(m.reason).toContain("$6.40");
  });

  it("MiniTool 改判备选：LinkConnector 40% 起，$59×40%=$23.60", () => {
    const r = screenCashbackText("MiniTool / 最高40%返利 / 420人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.networkLabel).toContain("LinkConnector");
    expect(m.estimatedCommissionUsd).toBe(23.6);
    expect(m.breakevenCpcUsd).toBe(11.8);
    expect(m.reason).toContain("LinkConnector");
  });

  it("PIA 维持备选：Kape 33% 首单已确认，$56.94×33%=$18.79", () => {
    const r = screenCashbackText("Private Internet Access VPN / 最高80%返利 / 250人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.estimatedCommissionUsd).toBe(18.79);
    expect(m.reason).toContain("盈亏平衡 $9.40");
  });

  it("Baobab 维持备选（有条件）：Skimlinks 净佣约 $10.88 待核，1 天 cookie", () => {
    const r = screenCashbackText("Baobab Collection USA / 8%返利 / 1534人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.reason).toContain("Skimlinks");
    expect(m.reason).toContain("$10.88");
  });

  it("Katie Loxton 维持备选：Weekender 纠正为 $135–$180", () => {
    const r = screenCashbackText("Katie Loxton US / 3%返利 / 1.4万人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.priceLabel).toContain("$59–$180");
    expect(m.reason).toContain("$135–$180");
  });

  it("Bambu Lab 维持备选：ShareASale 3% 作废，GoAffPro 直签待核", () => {
    const r = screenCashbackText("Bambu Lab / 最高1%返利 / 13人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.reason).toContain("GoAffPro");
    expect(m.reason).toContain("550,000");
  });

  it("Eileen Fisher 实测品牌词：135,000/$1.21 ≤ 盈亏平衡 $3.56，可投，仍留备选", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "eileen fisher", searchVolume: 135000, cpc: 1.21, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "Eileen Fisher")!;
    expect(m.verdict).toBe("backup");
    expect(m.keywordVerdict).toBe("investable");
  });

  it("SKIMS 品牌词量再大也救不了网络一票否决：仍排除，不归属流量", () => {
    const screened = screenCashbackText(SAMPLE_6);
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "skims", searchVolume: 1500000, cpc: 0.21, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const m = result.merchants.find((x) => x.name === "SKIMS")!;
    expect(m.verdict).toBe("excluded");
    expect(m.keywordVerdict).toBeNull();
  });

  it("Currentbody PPC 三重封死、Tenways/Nixon 的 Awin 条款原文已核实，写进理由（粘贴原名 Nixon (US & Canada) 也能命中）", () => {
    const r = screenCashbackText(
      "Currentbody US & Canada / 1%返利 / 7192人获得返利\nTenways (US) / 最高4%返利 / 236人获得返利\nNixon (US & Canada) / 最高4%返利 / 25人获得返利"
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded", "excluded"]);
    expect(r.merchants[0].reason).toContain("三重封死");
    expect(r.merchants[1].reason).toContain("Awin 条款原文已核实");
    expect(r.merchants[2].reason).toContain("Awin 条款原文已核实");
  });
});

describe("四类 Top 10 深核终判（2026-11-11，40 家、38 个独立品牌）", () => {
  const SAMPLE_38 = [
    "Nike / 5%返利 / 100人获得返利",
    "Levi's / 5%返利 / 100人获得返利",
    "Adidas / 5%返利 / 100人获得返利",
    "Zara / 5%返利 / 100人获得返利",
    "Gap / 5%返利 / 100人获得返利",
    "H&M / 5%返利 / 100人获得返利",
    "Ralph Lauren / 5%返利 / 100人获得返利",
    "Lululemon / 5%返利 / 100人获得返利",
    "Uniqlo / 5%返利 / 100人获得返利",
    "Louis Vuitton / 5%返利 / 100人获得返利",
    "Skechers / 5%返利 / 100人获得返利",
    "New Balance / 5%返利 / 100人获得返利",
    "Jordan / 5%返利 / 100人获得返利",
    "Puma / 5%返利 / 100人获得返利",
    "Crocs / 5%返利 / 100人获得返利",
    "ASICS / 5%返利 / 100人获得返利",
    "HOKA / 5%返利 / 100人获得返利",
    "Vans / 5%返利 / 100人获得返利",
    "Tiffany & Co. / 5%返利 / 100人获得返利",
    "Cartier / 5%返利 / 100人获得返利",
    "Pandora / 5%返利 / 100人获得返利",
    "David Yurman / 5%返利 / 100人获得返利",
    "Swarovski / 5%返利 / 100人获得返利",
    "Van Cleef & Arpels / 5%返利 / 100人获得返利",
    "Harry Winston / 5%返利 / 100人获得返利",
    "Kendra Scott / 5%返利 / 100人获得返利",
    "Blue Nile / 5%返利 / 100人获得返利",
    "Brilliant Earth / 5%返利 / 100人获得返利",
    "L'Oréal Paris / 5%返利 / 100人获得返利",
    "Maybelline / 5%返利 / 100人获得返利",
    "e.l.f. Cosmetics / 5%返利 / 100人获得返利",
    "Dove / 5%返利 / 100人获得返利",
    "Clinique / 5%返利 / 100人获得返利",
    "CeraVe / 5%返利 / 100人获得返利",
    "The Ordinary / 5%返利 / 100人获得返利",
    "La Roche-Posay / 5%返利 / 100人获得返利",
    "Sol de Janeiro / 5%返利 / 100人获得返利",
    "Rare Beauty / 5%返利 / 100人获得返利",
  ].join("\n");

  it("38 家全贴计档：短名单 0、备选 8（H&M/Uniqlo/ASICS/HOKA/Pandora/David Yurman/Clinique/Sol de Janeiro）、排除 30", () => {
    const r = screenCashbackText(SAMPLE_38);
    expect(r.parsedCount).toBe(38);
    expect(r.counts).toEqual({ shortlist: 0, backup: 8, excluded: 30 });
    expect(r.merchants.filter((m) => m.verdict === "backup").map((m) => m.name).sort()).toEqual([
      "ASICS",
      "Clinique",
      "David Yurman",
      "H&M",
      "HOKA",
      "Pandora",
      "Sol de Janeiro",
      "Uniqlo",
    ]);
  });

  it("Nike、Adidas 服装/鞋类重合只建一条记录，两类同 verdict", () => {
    const r = screenCashbackText("Nike / 5%返利 / 100人获得返利\nAdidas / 5%返利 / 100人获得返利");
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded"]);
    expect(r.merchants[0].reason).toContain("两类同 verdict");
    expect(r.merchants[1].reason).toContain("两类同 verdict");
    expect(r.merchants[0].reason).toContain("品牌词竞价明文禁");
    expect(r.merchants[1].reason).toContain("自 2016 年起");
  });

  it("New Balance 推翻线索：上一轮 Rakuten 7% 唯一可用作废，官网现 Impact 起步 2%，$125×2%=$2.50", () => {
    const r = screenCashbackText("New Balance / 5%返利 / 100人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("excluded");
    expect(m.networkLabel).toContain("Impact");
    expect(m.estimatedCommissionUsd).toBe(2.5);
    expect(m.reason).toContain("已被推翻");
    expect(m.reason).toContain("MID 39756");
  });

  it("Uniqlo 备选：只推 PUFFTECH Parka $89.90，$89.90×7%=$6.29，MID 40462", () => {
    const r = screenCashbackText("Uniqlo / 5%返利 / 100人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.estimatedCommissionUsd).toBe(6.29);
    expect(m.breakevenCpcUsd).toBe(3.15);
    expect(m.networkLabel).toContain("40462");
    expect(m.reason).toContain("$6.29");
    expect(m.reason).toContain("1,830,000");
  });

  it("H&M 备选：只推 $179+ 羊毛外套，$179×4%=$7.16，MID 43148，$99 款不进", () => {
    const r = screenCashbackText("H&M / 5%返利 / 100人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.estimatedCommissionUsd).toBe(7.16);
    expect(m.breakevenCpcUsd).toBe(3.58);
    expect(m.networkLabel).toContain("43148");
    expect(m.reason).toContain("$99 款不进");
    expect(m.reason).toContain("2,740,000");
  });

  it("Pandora 备选：6% 档篮子 $110 单均 $6.60，2% 档仅 $2.20", () => {
    const r = screenCashbackText("Pandora / 5%返利 / 100人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.estimatedCommissionUsd).toBe(6.6);
    expect(m.breakevenCpcUsd).toBe(3.3);
    expect(m.reason).toContain("FMTC");
    expect(m.reason).toContain("$6.60");
    expect(m.reason).toContain("5,000,000");
  });

  it("ASICS 备选：Kayano 32 $165×3%=$4.95 差 $0.05 不过线，品牌词明文禁只走型号词；HOKA 备选：Bondi 9 $170×3%=$5.10 刚过线", () => {
    const r = screenCashbackText("ASICS / 5%返利 / 100人获得返利\nHOKA / 5%返利 / 100人获得返利");
    const [a, h] = r.merchants;
    expect(a.verdict).toBe("backup");
    expect(a.estimatedCommissionUsd).toBe(4.95);
    expect(a.breakevenCpcUsd).toBe(2.48);
    expect(a.reason).toContain("差 $0.05");
    expect(a.reason).toContain("gel-kayano 32");
    expect(h.verdict).toBe("backup");
    expect(h.estimatedCommissionUsd).toBe(5.1);
    expect(h.breakevenCpcUsd).toBe(2.55);
    expect(h.reason).toContain("$5.10");
    expect(h.reason).toContain("3–14%");
  });

  it("佣金不过线组：Ralph Lauren $125×3%=$3.75、Skechers $135×2%=$2.70、e.l.f. $95×5%=$4.75", () => {
    const r = screenCashbackText(
      "Ralph Lauren / 5%返利 / 100人获得返利\nSkechers / 5%返利 / 100人获得返利\ne.l.f. Cosmetics / 5%返利 / 100人获得返利"
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["excluded", "excluded", "excluded"]);
    expect(r.merchants[0].estimatedCommissionUsd).toBe(3.75);
    expect(r.merchants[0].reason).toContain("Partnerize 明文禁 PPC");
    expect(r.merchants[1].estimatedCommissionUsd).toBe(2.7);
    expect(r.merchants[2].estimatedCommissionUsd).toBe(4.75);
    expect(r.merchants[2].reason).toContain("暂缓");
    expect(r.merchants[2].reason).toContain("加拿大");
    expect(r.merchants[2].reason).toContain("重测待确认");
  });

  it("Clinique 备选：MID 24775 实证，$99 套装实付价盈亏平衡仅 $1.93 几无余量；Sol de Janeiro 备选：8% 是 ShareASale 费率不得默认 Rakuten", () => {
    const r = screenCashbackText("Clinique / 5%返利 / 100人获得返利\nSol de Janeiro / 5%返利 / 100人获得返利");
    const [c, s] = r.merchants;
    expect(c.verdict).toBe("backup");
    expect(c.estimatedCommissionUsd).toBe(5.94);
    expect(c.networkLabel).toContain("24775");
    expect(c.reason).toContain("$1.93");
    expect(c.reason).toContain("246,000");
    expect(s.verdict).toBe("backup");
    expect(s.networkLabel).toContain("54369");
    expect(s.reason).toContain("ShareASale");
    expect(s.reason).toContain("$69+");
    expect(s.commissionLabel).toBe("未核实");
  });

  it("David Yurman 备选：四关全过卡在网络+佣金+条款，佣金未核实", () => {
    const r = screenCashbackText("David Yurman / 5%返利 / 100人获得返利");
    const m = r.merchants[0];
    expect(m.verdict).toBe("backup");
    expect(m.commissionLabel).toBe("未核实");
    expect(m.networkLabel).toContain("Rakuten 后台核 MID");
    expect(m.reason).toContain("550,000");
  });

  it("美国 Crocs 走 Impact 6%（$49.99×6%=$3.00）；Crocs DE 单独贴仍判非美国；同名去重：两者同贴只留一条", () => {
    const us = screenCashbackText("Crocs / 5%返利 / 100人获得返利");
    expect(us.merchants[0].verdict).toBe("excluded");
    expect(us.merchants[0].estimatedCommissionUsd).toBe(3);
    expect(us.merchants[0].reason).toContain("Impact 6%");
    const de = screenCashbackText("Crocs DE / 3.2%返利 / 3人获得返利");
    expect(de.merchants[0].verdict).toBe("excluded");
    expect(de.merchants[0].reason).toContain("非美国");
    const both = screenCashbackText("Crocs / 5%返利 / 100人获得返利\nCrocs DE / 3.2%返利 / 3人获得返利");
    expect(both.parsedCount).toBe(1);
    expect(both.skippedCount).toBe(1);
  });

  it("美国 Swarovski 走 Impact；Swarovski HK 单独贴仍判非美国；同名去重：两者同贴只留一条", () => {
    const us = screenCashbackText("Swarovski / 5%返利 / 100人获得返利");
    expect(us.merchants[0].verdict).toBe("excluded");
    expect(us.merchants[0].reason).toContain("Impact");
    const hk = screenCashbackText("Swarovski HK / 最高3%返利 / 100人获得返利");
    expect(hk.merchants[0].verdict).toBe("excluded");
    expect(hk.merchants[0].reason).toContain("非美国");
    const both = screenCashbackText("Swarovski / 5%返利 / 100人获得返利\nSwarovski HK / 最高3%返利 / 100人获得返利");
    expect(both.parsedCount).toBe(1);
    expect(both.skippedCount).toBe(1);
  });

  it("地区识别只认末尾标记：Sol de Janeiro 里的 de 不是 DE 地区，不判非美国", () => {
    const r = screenCashbackText("Sol de Janeiro / 5%返利 / 100人获得返利");
    expect(r.merchants[0].verdict).toBe("backup");
    expect(r.merchants[0].reason).not.toContain("非美国");
  });

  it("备选品牌词实测归属：Uniqlo/H&M/Pandora 均可投，仍留备选", () => {
    const screened = screenCashbackText(
      "Uniqlo / 5%返利 / 100人获得返利\nH&M / 5%返利 / 100人获得返利\nPandora / 5%返利 / 100人获得返利"
    );
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "uniqlo", searchVolume: 1830000, cpc: 0.22, competition: null, lowTopBid: null, highTopBid: null },
      { keyword: "h&m", searchVolume: 2740000, cpc: 0.78, competition: null, lowTopBid: null, highTopBid: null },
      { keyword: "pandora", searchVolume: 5000000, cpc: 0.46, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const by = (n: string) => result.merchants.find((x) => x.name === n)!;
    expect(by("Uniqlo").keywordVerdict).toBe("investable");
    expect(by("H&M").keywordVerdict).toBe("investable");
    expect(by("Pandora").keywordVerdict).toBe("investable");
    expect(result.merchants.map((m) => m.verdict)).toEqual(["backup", "backup", "backup"]);
  });

  it("型号词实测归属：Clinique 可投，ASICS/HOKA 型号词可投", () => {
    const screened = screenCashbackText(
      "Clinique / 5%返利 / 100人获得返利\nASICS / 5%返利 / 100人获得返利\nHOKA / 5%返利 / 100人获得返利"
    );
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "clinique", searchVolume: 246000, cpc: 1.89, competition: null, lowTopBid: null, highTopBid: null },
      { keyword: "asics gel-kayano 32", searchVolume: 27100, cpc: 0.69, competition: null, lowTopBid: null, highTopBid: null },
      { keyword: "hoka bondi 9", searchVolume: 201000, cpc: 1.52, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const by = (n: string) => result.merchants.find((x) => x.name === n)!;
    expect(by("Clinique").keywordVerdict).toBe("investable");
    expect(by("ASICS").keywordVerdict).toBe("investable");
    expect(by("HOKA").keywordVerdict).toBe("investable");
  });

  it("佣金未核实的备选品牌：只显示量和 CPC，不判可投/超标（Sol de Janeiro、David Yurman）", () => {
    const screened = screenCashbackText(
      "Sol de Janeiro / 5%返利 / 100人获得返利\nDavid Yurman / 5%返利 / 100人获得返利"
    );
    const { result } = applyKeywordTraffic(screened, [
      { keyword: "sol de janeiro", searchVolume: 450000, cpc: 1.37, competition: null, lowTopBid: null, highTopBid: null },
      { keyword: "david yurman", searchVolume: 550000, cpc: 0.55, competition: null, lowTopBid: null, highTopBid: null },
    ]);
    const by = (n: string) => result.merchants.find((x) => x.name === n)!;
    expect(by("Sol de Janeiro").keywordVerdict).toBe("unknown");
    expect(by("Sol de Janeiro").keywordNote).toContain("佣金未核实");
    expect(by("David Yurman").keywordVerdict).toBe("unknown");
    expect(by("David Yurman").keywordNote).toContain("佣金未核实");
  });

  it("e.l.f. cosmetics 品牌词无量：搜索量 0 → no-volume（换 elf cosmetics 重测待确认）", () => {
    expect(
      brandKeywordVerdict({ searchVolume: 0, cpc: null, breakevenCpc: 2.38 })
    ).toBe("no-volume");
  });

  it("19 家深核结论不动：ROVE 仍短名单、SKIMS 仍排除（计档不受新库影响）", () => {
    const r = screenCashbackText(
      "ROVE Dash Cam / 8%返利 / 50人获得返利\nSKIMS / 最高2%返利 / 2万人获得返利"
    );
    expect(r.merchants.map((m) => m.verdict)).toEqual(["shortlist", "excluded"]);
  });
});
