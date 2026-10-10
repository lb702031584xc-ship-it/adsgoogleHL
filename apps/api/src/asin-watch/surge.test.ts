/**
 * 第十批：ASIN 需求异动判定单测（纯函数）。
 */
import { describe, expect, it } from "vitest";
import { detectSurge, DEFAULT_SURGE_THRESHOLDS } from "./surge.js";

describe("detectSurge", () => {
  it("默认阈值：+50% / +500", () => {
    expect(DEFAULT_SURGE_THRESHOLDS.growthPct).toBe(50);
    expect(DEFAULT_SURGE_THRESHOLDS.growthAbs).toBe(500);
  });

  it("绝对规则优先：1000 → 1600（+600 条 ≥500）", () => {
    const r = detectSurge(1000, 1600);
    expect(r.surged).toBe(true);
    expect(r.growthPct).toBe(60);
    expect(r.growthAbs).toBe(600);
    expect(r.reason).toContain("600");
  });

  it("相对增长触发：1000 → 1550（+55%，+550 条；用高绝对阈值隔离相对规则）", () => {
    const r = detectSurge(1000, 1550, { growthPct: 50, growthAbs: 10000 });
    expect(r.surged).toBe(true);
    expect(r.reason).toContain("55%");
  });

  it("相对增长未触发：1000 → 1400（+40% <50%，绝对 +400 <500）", () => {
    const r = detectSurge(1000, 1400);
    expect(r.surged).toBe(false);
  });

  it("绝对增长触发：10000 → 10600（+6%，但 +600 ≥500）", () => {
    const r = detectSurge(10000, 10600);
    expect(r.surged).toBe(true);
    expect(r.reason).toContain("600");
  });

  it("基线为 0：0 → 600（绝对规则触发）", () => {
    const r = detectSurge(0, 600);
    expect(r.surged).toBe(true);
    expect(r.growthPct).toBeNull();
  });

  it("基线为 0 但增长不足：0 → 100（不触发）", () => {
    const r = detectSurge(0, 100);
    expect(r.surged).toBe(false);
  });

  it("评论下降 → 不触发", () => {
    const r = detectSurge(2000, 1500);
    expect(r.surged).toBe(false);
    expect(r.growthAbs).toBe(-500);
  });

  it("缺数据 → 不触发", () => {
    expect(detectSurge(null, 1000).surged).toBe(false);
    expect(detectSurge(1000, null).surged).toBe(false);
    expect(detectSurge(undefined, undefined).surged).toBe(false);
  });

  it("自定义阈值", () => {
    const r = detectSurge(1000, 1200, { growthPct: 10, growthAbs: 5000 });
    expect(r.surged).toBe(true); // +20% ≥ 10%
    const r2 = detectSurge(1000, 1050, { growthPct: 10, growthAbs: 5000 });
    expect(r2.surged).toBe(false); // +5% < 10%，+50 < 5000
  });

  it("边界：恰好等于阈值 → 触发", () => {
    expect(detectSurge(1000, 1500).surged).toBe(true); // +50%
    expect(detectSurge(1000, 1500, { growthPct: 50, growthAbs: 500 }).surged).toBe(true);
  });
});
