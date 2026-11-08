/**
 * 长尾流水线标记与筛选口径单测：
 * - 已购用户风险：整 token / 固定短语命中，"apple" 不得误伤 "app"
 * - 型号特征：字母+数字相邻的启发式，纯数字（年份）不算
 * - outcome 分类：先量后竞争，无量（null/0）不进主投；意图并入只动 pass、
 *   未知意图与非购买意图都出局
 * - 主投口径（2026-11-08）：有量且购买意图才进主投；测算表有量在前按 CPC 升序、
 *   无量沉底；导入只放行有量且购买意图的词
 * - 型号词稳定前置、勾选跨批次保留
 * - 本批 dict 新键中英齐全、占位符完整
 */
import { describe, expect, it } from "vitest";
import { en, zh } from "../../i18n/dict/keyword-starter";
import {
  applyIntentOutcomes,
  classifyLocalOutcomes,
  countLocalSurvivors,
  countOutcome,
  hasModelToken,
  hasVolume,
  isBuyIntent,
  isMainListEligible,
  isOwnedUserRisk,
  keepSelectionWithin,
  modelFirstStable,
  sortMeasureDisplay,
  splitImportWords,
  type FilterOutcome,
} from "./keyword-marks";
import type { DfsCandidate } from "@/lib/api/keyword-dataforseo-actions";

const cand = (over: Partial<DfsCandidate> = {}): DfsCandidate => ({
  keyword: "robot vacuum",
  searchVolume: 1000,
  cpc: 1,
  competition: 0.2,
  competitionLevel: "LOW",
  ...over,
});

describe("isOwnedUserRisk", () => {
  it("命中单 token：app / login / support / manual / setup / connect / download", () => {
    for (const kw of [
      "roborock app",
      "roborock login",
      "roborock customer support",
      "roborock s8 manual",
      "roborock setup guide",
      "roborock wont connect to wifi",
      "roborock app download",
      "roborock troubleshooting",
      "roborock pairing",
    ]) {
      expect(isOwnedUserRisk(kw), kw).toBe(true);
    }
  });

  it("命中固定短语：sign in / customer service / how to / set up", () => {
    for (const kw of [
      "sign in roborock account",
      "roborock customer service phone",
      "how to clean roborock filter",
      "set up roborock s8",
    ]) {
      expect(isOwnedUserRisk(kw), kw).toBe(true);
    }
  });

  it("不误伤：apple / application 等含 app 子串的正常词", () => {
    for (const kw of [
      "apple robot vacuum",
      "best vacuum application",
      "pineapple scented mop pads",
      "robot vacuum",
      "roborock s8 pro ultra",
      "best robot vacuum for pet hair",
    ]) {
      expect(isOwnedUserRisk(kw), kw).toBe(false);
    }
  });
});

describe("hasModelToken", () => {
  it("字母+数字相邻 → 型号特征", () => {
    for (const kw of [
      "roborock s8",
      "roborock s8 pro ultra",
      "roborock q7 max",
      "dreame x40 ultra",
      "roomba j7",
      "shark av2501s",
    ]) {
      expect(hasModelToken(kw), kw).toBe(true);
    }
  });

  it("纯数字（年份）与纯字母词不算", () => {
    for (const kw of [
      "best robot vacuum 2024",
      "robot vacuum",
      "robot vacuum and mop",
      "self emptying robot vacuum",
    ]) {
      expect(hasModelToken(kw), kw).toBe(false);
    }
  });
});

describe("classifyLocalOutcomes", () => {
  it("先量后竞争：量不过 = out-volume（即使竞争也不过）", () => {
    const map = classifyLocalOutcomes(
      [
        cand({ keyword: "a", searchVolume: 10, competitionLevel: "HIGH" }),
        cand({ keyword: "b", searchVolume: 500, competitionLevel: "HIGH" }),
        cand({ keyword: "c", searchVolume: 500, competitionLevel: "MEDIUM" }),
      ],
      { minVolume: 100, competitionMode: "lowPlusMedium" }
    );
    expect(map.get("a")).toBe("out-volume");
    expect(map.get("b")).toBe("out-competition");
    expect(map.get("c")).toBe("pass");
  });

  it("无量不进主投：量为 null/0 → out-volume（与 minVolume 阈值无关）", () => {
    const map = classifyLocalOutcomes(
      [
        cand({ keyword: "nullvol", searchVolume: null }),
        cand({ keyword: "zerovol", searchVolume: 0 }),
        cand({ keyword: "somevol", searchVolume: 50 }),
      ],
      { minVolume: 0, competitionMode: "all" }
    );
    expect(map.get("nullvol")).toBe("out-volume");
    expect(map.get("zerovol")).toBe("out-volume");
    expect(map.get("somevol")).toBe("pass");
  });

  it("竞争未知不误杀：竞争为 null 照样 pass", () => {
    const map = classifyLocalOutcomes(
      [cand({ keyword: "x", searchVolume: 500, competition: null, competitionLevel: null })],
      { minVolume: 100, competitionMode: "lowOnly" }
    );
    expect(map.get("x")).toBe("pass");
  });

  it("competition 数值分档与原文等级都认", () => {
    const map = classifyLocalOutcomes(
      [
        cand({ keyword: "n1", competition: 0.9, competitionLevel: null }),
        cand({ keyword: "n2", competition: 0.9, competitionLevel: "LOW" }),
      ],
      { minVolume: 0, competitionMode: "lowOnly" }
    );
    expect(map.get("n1")).toBe("out-competition");
    expect(map.get("n2")).toBe("pass"); // 原文等级优先
  });
});

describe("applyIntentOutcomes", () => {
  const base = (): Map<string, FilterOutcome> =>
    new Map<string, FilterOutcome>([
      ["keep-buy", "pass"],
      ["info-word", "pass"],
      ["unknown-word", "pass"],
      ["already-out", "out-volume"],
    ]);

  it("明确非购买向与意图未知 → out-intent；commercial/transactional 保持 pass", () => {
    const { outcomes, hasUnverified } = applyIntentOutcomes(
      base(),
      new Map([
        ["keep-buy", "transactional"],
        ["info-word", "informational"],
        ["unknown-word", null],
        ["already-out", "informational"],
      ])
    );
    expect(outcomes.get("keep-buy")).toBe("pass");
    expect(outcomes.get("info-word")).toBe("out-intent");
    expect(outcomes.get("unknown-word")).toBe("out-intent");
    expect(hasUnverified).toBe(true);
  });

  it("意图未知不进主投（out-intent）且标未验证；已出局的行不被意图改动、不入参污染", () => {
    const input = base();
    const { outcomes } = applyIntentOutcomes(
      input,
      new Map([
        ["keep-buy", "commercial"],
        ["info-word", "commercial"],
        ["unknown-word", null],
        ["already-out", "transactional"],
      ])
    );
    expect(outcomes.get("unknown-word")).toBe("out-intent");
    expect(outcomes.get("already-out")).toBe("out-volume");
    expect(input.get("already-out")).toBe("out-volume");
    expect(outcomes).not.toBe(input);
  });

  it("计数口径：本地幸存 = pass + out-intent", () => {
    const { outcomes } = applyIntentOutcomes(
      base(),
      new Map([
        ["keep-buy", "commercial"],
        ["info-word", "navigational"],
        ["unknown-word", "transactional"],
      ])
    );
    expect(countLocalSurvivors(outcomes)).toBe(3);
    expect(countOutcome(outcomes, "pass")).toBe(2);
    expect(countOutcome(outcomes, "out-intent")).toBe(1);
  });
});

describe("modelFirstStable / keepSelectionWithin", () => {
  it("型号词前置且组内保序，无型号词相对顺序不变", () => {
    const rows = [
      { keyword: "robot vacuum" },
      { keyword: "roborock s8" },
      { keyword: "robot mop" },
      { keyword: "dreame x40" },
    ];
    expect(modelFirstStable(rows).map((r) => r.keyword)).toEqual([
      "roborock s8",
      "dreame x40",
      "robot vacuum",
      "robot mop",
    ]);
  });

  it("勾选保留只留下仍在候选内的词（大小写不敏感）", () => {
    const prev = new Set(["roborock s8", "gone word", "robot vacuum"]);
    const next = keepSelectionWithin(prev, ["Roborock S8", "Robot Vacuum"]);
    expect([...next].sort()).toEqual(["roborock s8", "robot vacuum"]);
  });
});

describe("hasVolume / isBuyIntent / isMainListEligible（主投口径 2026-11-08）", () => {
  it("有量 = searchVolume 明确 > 0；null/0 都是无量", () => {
    expect(hasVolume(100)).toBe(true);
    expect(hasVolume(1)).toBe(true);
    expect(hasVolume(0)).toBe(false);
    expect(hasVolume(null)).toBe(false);
  });

  it("购买意图只认 commercial / transactional", () => {
    expect(isBuyIntent("commercial")).toBe(true);
    expect(isBuyIntent("transactional")).toBe(true);
    expect(isBuyIntent("informational")).toBe(false);
    expect(isBuyIntent("navigational")).toBe(false);
    expect(isBuyIntent(null)).toBe(false);
    expect(isBuyIntent(undefined)).toBe(false);
  });

  it("主投资格 = 有量且购买意图；任一缺失都不进主投", () => {
    expect(isMainListEligible({ searchVolume: 100, intent: "commercial" })).toBe(true);
    expect(isMainListEligible({ searchVolume: 100, intent: "transactional" })).toBe(true);
    expect(isMainListEligible({ searchVolume: 100, intent: "informational" })).toBe(false);
    expect(isMainListEligible({ searchVolume: 100, intent: null })).toBe(false);
    expect(isMainListEligible({ searchVolume: 100 })).toBe(false);
    expect(isMainListEligible({ searchVolume: null, intent: "commercial" })).toBe(false);
    expect(isMainListEligible({ searchVolume: 0, intent: "commercial" })).toBe(false);
  });
});

describe("sortMeasureDisplay", () => {
  const row = (keyword: string, searchVolume: number | null, cpc: number | null) => ({
    keyword,
    searchVolume,
    cpc,
  });

  it("有量词在前按 CPC 升序（CPC null 组内最后），无量词沉底保原序", () => {
    const rows = [
      row("no-vol-a", null, 0.1),
      row("cheap", 100, 0.5),
      row("pricey", 200, 2.0),
      row("no-cpc", 50, null),
      row("no-vol-b", 0, 0.2),
      row("cheapest", 300, 0.2),
    ];
    expect(sortMeasureDisplay(rows).map((r) => r.keyword)).toEqual([
      "cheapest",
      "cheap",
      "pricey",
      "no-cpc",
      "no-vol-a",
      "no-vol-b",
    ]);
  });

  it("不改入参、不拿 0 冒充数据", () => {
    const rows = [row("a", null, 1), row("b", 10, 1)];
    const sorted = sortMeasureDisplay(rows);
    expect(sorted).not.toBe(rows);
    expect(rows[0].keyword).toBe("a");
  });
});

describe("splitImportWords（导入守门）", () => {
  const cands = new Map<string, { searchVolume: number | null; intent: string | null }>([
    ["buy-word", { searchVolume: 100, intent: "commercial" }],
    ["no-vol", { searchVolume: null, intent: "commercial" }],
    ["zero-vol", { searchVolume: 0, intent: "transactional" }],
    ["review-word", { searchVolume: 500, intent: "informational" }],
    ["unknown-intent", { searchVolume: 500, intent: null }],
  ]);

  it("只放行有量且购买意图的词；其余按原因拦下", () => {
    const { eligible, blocked } = splitImportWords(
      ["buy-word", "no-vol", "zero-vol", "review-word", "unknown-intent", "ghost-word"],
      cands,
      new Map()
    );
    expect(eligible).toEqual(["buy-word"]);
    expect(blocked.map((b) => [b.keyword, b.reason])).toEqual([
      ["no-vol", "no-volume"],
      ["zero-vol", "no-volume"],
      ["review-word", "non-buy-intent"],
      ["unknown-intent", "unknown"],
      ["ghost-word", "unknown"],
    ]);
  });

  it("测算量优先于扩词量：测算无量则拦，测算有量则放（意图仍取候选）", () => {
    const { eligible, blocked } = splitImportWords(
      ["buy-word", "no-vol"],
      cands,
      new Map([
        ["buy-word", { searchVolume: null }], // 测算说无量 → 拦
        ["no-vol", { searchVolume: 900 }], // 测算说有量 → 放
      ])
    );
    expect(eligible).toEqual(["no-vol"]);
    expect(blocked).toEqual([{ keyword: "buy-word", reason: "no-volume" }]);
  });
});

describe("dict 新键（dfs）", () => {
  it("中英齐全且非空", () => {
    for (const d of [zh.dfs, en.dfs]) {
      expect(d.expandCacheNote.length).toBeGreaterThan(10);
      expect(d.showFiltered).toContain("{k}");
      expect(d.hideFiltered.length).toBeGreaterThan(0);
      expect(d.keptBadge.length).toBeGreaterThan(0);
      expect(d.ownedRiskBadge.length).toBeGreaterThan(0);
      expect(d.modelBadge.length).toBeGreaterThan(0);
      expect(d.marksNote.length).toBeGreaterThan(10);
      expect(d.outcomeReasons["out-volume"].length).toBeGreaterThan(0);
      expect(d.outcomeReasons["out-competition"].length).toBeGreaterThan(0);
      expect(d.outcomeReasons["out-intent"].length).toBeGreaterThan(0);
      expect(d.thVerdict.length).toBeGreaterThan(0);
      expect(d.noVolumeLabel.length).toBeGreaterThan(0);
      expect(d.hasVolumeLabel.length).toBeGreaterThan(0);
      expect(d.onlyWithVolume.length).toBeGreaterThan(0);
      expect(d.measureSortNote.length).toBeGreaterThan(0);
      expect(d.importExcludedNote).toContain("{n}");
      expect(d.importExcludedNote).toContain("{m}");
      expect(d.importBlockedWords).toContain("{words}");
      expect(d.importNoneEligible.length).toBeGreaterThan(0);
    }
  });

  it("filterLine 占位符 {x}/{y}/{k} 中英完整", () => {
    for (const line of [zh.dfs.filterLine, en.dfs.filterLine]) {
      expect(line).toContain("{x}");
      expect(line).toContain("{y}");
      expect(line).toContain("{k}");
    }
  });

  it("缓存说明写明 14 天（中英）", () => {
    expect(zh.dfs.expandCacheNote).toContain("14");
    expect(en.dfs.expandCacheNote).toContain("14");
  });
});
