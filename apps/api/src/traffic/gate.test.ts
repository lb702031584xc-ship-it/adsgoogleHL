/**
 * 流量门评估单测：pass / fail / unknown 三态、domain 跳过检测、
 * deriveBrandFromTitle / extractCoreKeywords。
 *
 * 下游数据源全部 mock，只验证 gate 的编排与判定逻辑。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@adlinklab/database";

vi.mock("./official-site.js", () => ({ detectOfficialSite: vi.fn() }));
vi.mock("./trends.js", () => ({ getKeywordInterest: vi.fn() }));
vi.mock("./similarweb.js", () => ({ SimilarWebProvider: vi.fn() }));
vi.mock("./dataforseo.js", () => ({ DataForSeoProvider: vi.fn() }));

import { detectOfficialSite } from "./official-site.js";
import { getKeywordInterest } from "./trends.js";
import { SimilarWebProvider } from "./similarweb.js";
import { DataForSeoProvider } from "./dataforseo.js";
import {
  evaluateTrafficGate,
  deriveBrandFromTitle,
  extractCoreKeywords,
  type EvaluateTrafficGateInput,
} from "./gate.js";
import type { TrafficThresholds } from "./types.js";

const mockDetect = vi.mocked(detectOfficialSite);
const mockTrends = vi.mocked(getKeywordInterest);
const MockSw = vi.mocked(SimilarWebProvider);
const MockDf = vi.mocked(DataForSeoProvider);

const THRESHOLDS: TrafficThresholds = {
  officialSiteMonthlyVisits: 50000,
  brandInterest: 25,
  keywordInterest: 25,
};

const fakePrisma = {} as unknown as PrismaClient;

function baseInput(
  overrides: Partial<EvaluateTrafficGateInput> = {}
): EvaluateTrafficGateInput {
  return {
    brand: "Anker",
    title: "Anker 737 Power Bank 120W Fast Charger",
    keywords: ["power bank", "fast charger"],
    thresholds: THRESHOLDS,
    prisma: fakePrisma,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDetect.mockResolvedValue({
    found: true,
    domain: "anker.com",
    confidence: "high",
  });
  MockSw.mockImplementation(
    () => ({ getMonthlyVisits: vi.fn().mockResolvedValue(null) }) as never
  );
  MockDf.mockImplementation(
    () =>
      ({
        getKeywordVolume: vi.fn().mockResolvedValue([]),
      }) as never
  );
});

function mockSwVisits(v: number | null) {
  MockSw.mockImplementation(
    () => ({ getMonthlyVisits: vi.fn().mockResolvedValue(v) }) as never
  );
}

describe("evaluateTrafficGate", () => {
  it("有官网 + SimilarWeb 达标 → pass（付费）", async () => {
    mockSwVisits(120000);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(true);
    expect(res.reason).toContain("通过");
    expect(res.reason).toContain("付费");
    expect(res.officialSite).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "high",
    });
    const sw = res.signals.find((s) => s.source === "similarweb");
    expect(sw?.value).toBe(120000);
    expect(sw?.threshold).toBe(50000);
    expect(sw?.passed).toBe(true);
    expect(sw?.label).toContain("SimilarWeb");
  });

  it("有官网 + SimilarWeb 未达标 → fail", async () => {
    mockSwVisits(10000);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(false);
    expect(res.reason).toContain("未通过");
    expect(res.signals.find((s) => s.source === "similarweb")?.passed).toBe(
      false
    );
  });

  it("无 SimilarWeb key → Trends 品牌热度兜底（免费相对值，非访问量）", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue(60);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(true);
    const t = res.signals.find((s) => s.source === "trends");
    expect(t?.label).toContain("免费相对值，非访问量");
    expect(t?.passed).toBe(true);
    expect(res.reason).toContain("免费");
  });

  it("判定信号无数据 → unknown（不直接 fail），reason 写清暂无数据", async () => {
    mockSwVisits(null);
    mockTrends.mockResolvedValue(null);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    expect(res.reason).toContain("暂无数据");
    expect(res.reason).toContain("unknown");
  });

  it("无官网 → 关键词热度判定 + DataForSEO 仅展示", async () => {
    mockDetect.mockResolvedValue({
      found: false,
      domain: null,
      confidence: "low",
    });
    mockTrends.mockResolvedValue(70);
    MockDf.mockImplementation(
      () =>
        ({
          getKeywordVolume: vi
            .fn()
            .mockResolvedValue([
              { keyword: "power bank", volume: 90500 },
              { keyword: "fast charger", volume: null },
            ]),
        }) as never
    );
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(true);
    // 只取前 2 个关键词
    expect(mockTrends).toHaveBeenCalledWith(
      ["power bank", "fast charger"],
      "US",
      expect.anything()
    );
    const df = res.signals.filter((s) => s.source === "dataforseo");
    expect(df).toHaveLength(2);
    expect(df[0]).toMatchObject({
      value: 90500,
      threshold: null,
      passed: null,
    });
    expect(df[0]?.label).toContain("DataForSEO");
  });

  it("无官网 + 热度无数据 → unknown", async () => {
    mockDetect.mockResolvedValue({
      found: false,
      domain: null,
      confidence: "low",
    });
    mockTrends.mockResolvedValue(null);
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    expect(res.reason).toContain("暂无数据");
  });

  it("传入 domain 时跳过官网检测", async () => {
    mockSwVisits(80000);
    const res = await evaluateTrafficGate(
      baseInput({ brand: null, title: "Something", domain: "anker.com" })
    );
    expect(mockDetect).not.toHaveBeenCalled();
    expect(res.officialSite).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "medium",
    });
    expect(res.reason).toContain("官网域名由调用方提供，跳过自动检测");
    expect(res.passed).toBe(true);
  });

  it("domain 归一化（去协议/路径/大小写）", async () => {
    mockSwVisits(80000);
    const res = await evaluateTrafficGate(
      baseInput({ brand: null, title: "x", domain: "https://WWW.Anker.com/shop" })
    );
    expect(res.officialSite?.domain).toBe("www.anker.com");
    expect(mockDetect).not.toHaveBeenCalled();
  });

  it("内部异常 → unknown，不抛错", async () => {
    mockDetect.mockRejectedValue(new Error("unexpected"));
    // 注意：detectOfficialSite 本身永不抛错；这里模拟极端情况下 gate 仍收敛
    const res = await evaluateTrafficGate(baseInput());
    expect(res.passed).toBe(null);
    await expect(
      evaluateTrafficGate(baseInput())
    ).resolves.toBeDefined();
  });
});

describe("deriveBrandFromTitle", () => {
  it("取标题前 2 个有效词", () => {
    expect(deriveBrandFromTitle("Anker 737 Power Bank 120W Fast Charger")).toBe(
      "anker 737"
    );
  });

  it("支持中文标题并过滤停用词", () => {
    expect(deriveBrandFromTitle("安克 充电宝 20000mAh 旗舰新品")).toBe(
      "安克 充电宝"
    );
  });

  it("全停用词/空标题 → null", () => {
    expect(deriveBrandFromTitle("的 和 与")).toBe(null);
    expect(deriveBrandFromTitle("")).toBe(null);
    expect(deriveBrandFromTitle("   ")).toBe(null);
  });
});

describe("extractCoreKeywords", () => {
  it("优先用调用方 keywords（前 2 个）", () => {
    expect(
      extractCoreKeywords("Some Product Title Here", ["kw1", "kw2", "kw3"])
    ).toEqual(["kw1", "kw2"]);
  });

  it("无 keywords 时从标题分词", () => {
    expect(extractCoreKeywords("Anker 737 Power Bank", [])).toEqual([
      "anker 737",
      "power bank",
    ]);
  });

  it("都没有 → 空数组", () => {
    expect(extractCoreKeywords("", [])).toEqual([]);
  });
});
