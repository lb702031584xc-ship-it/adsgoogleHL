import { describe, expect, it } from "vitest";
import {
  buildRotationScript,
  ROTATION_SCRIPT_VERSION,
  validateRotationScriptInput,
} from "./script-rotation.js";

describe("script-rotation", () => {
  it("is at v1.2.0", () => {
    expect(ROTATION_SCRIPT_VERSION).toBe("1.2.0");
  });

  it("generates a valid Google Ads script with the label", () => {
    const src = buildRotationScript({ label: "1" });
    // v1.0.0 曾丢过开头的 /**，粘贴进 Google Ads 直接报
    // SyntaxError: Unexpected token '*' (line 1)；此处必须以 /** 开头。
    expect(src.startsWith("/**")).toBe(true);
    expect(src).toContain("AdLinkLab 直链轮换 Script v1.2.0");
    expect(src).toContain('var LABEL = "1"');
    expect(src).toContain("function main()");
    expect(src).toContain("AdsApp.ads()");
    // v1.2.0 不靠计数器：不再用 PropertiesService，预览不会打乱顺序。
    expect(src).not.toContain("PropertiesService");
    expect(src).not.toContain("adlinklab_rotation_idx_");
    // v1.2.0 每轮先启用广告组（暂停的组里广告不展示）。
    expect(src).toContain("getAdGroup().enable()");
    expect(src).toContain("isEnabled()");
  });

  it("rejects empty label", () => {
    expect(validateRotationScriptInput({ label: "" })).toHaveLength(1);
    expect(validateRotationScriptInput({ label: "   " })).toHaveLength(1);
  });

  it("rejects label with illegal characters", () => {
    const errors = validateRotationScriptInput({ label: "bad label!" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts valid label", () => {
    expect(
      validateRotationScriptInput({ label: "adlinklab-rotate-nike_01" })
    ).toHaveLength(0);
  });

  it("throws on empty label in builder", () => {
    expect(() => buildRotationScript({ label: "" })).toThrow();
  });
});

/**
 * v1.2.0 行为模拟：用本地 Fake AdsApp 执行生成的脚本源码。
 * 共享的 test-runtime MockAdsApp 只覆盖 Id 选择 + URL 改写，
 * 不支持 LabelNames 过滤、enable()/pause()、广告组，不适用，
 * 故此处用最小 Fake 只实现生成脚本实际调用的 API 面。
 */
interface FakeAdState {
  id: string;
  adGroupName: string;
  labels: string[];
  enabled: boolean;
  adGroupEnabled: boolean;
}

class FakeAdGroup {
  constructor(private readonly state: FakeAdState) {}
  getName(): string {
    return this.state.adGroupName;
  }
  enable(): void {
    this.state.adGroupEnabled = true;
  }
  isEnabled(): boolean {
    return this.state.adGroupEnabled;
  }
}

class FakeAd {
  constructor(private readonly state: FakeAdState) {}
  getId(): string {
    return this.state.id;
  }
  getAdGroup(): FakeAdGroup {
    return new FakeAdGroup(this.state);
  }
  isEnabled(): boolean {
    return this.state.enabled;
  }
  isPaused(): boolean {
    return !this.state.enabled;
  }
  enable(): void {
    this.state.enabled = true;
  }
  pause(): void {
    this.state.enabled = false;
  }
}

class FakeAdIterator {
  private index = 0;
  constructor(private readonly ads: FakeAd[]) {}
  hasNext(): boolean {
    return this.index < this.ads.length;
  }
  next(): FakeAd {
    if (!this.hasNext()) throw new Error("FakeAdIterator exhausted");
    return this.ads[this.index++]!;
  }
}

class FakeAdSelector {
  private readonly conditions: string[] = [];
  private readonly orderBys: string[] = [];
  constructor(private readonly states: FakeAdState[]) {}
  withCondition(condition: string): this {
    this.conditions.push(condition);
    return this;
  }
  orderBy(order: string): this {
    this.orderBys.push(order);
    return this;
  }
  get(): FakeAdIterator {
    let matched = this.states.filter((s) => {
      for (const c of this.conditions) {
        const labelMatch = c.match(/LabelNames CONTAINS '([^']*)'/);
        if (labelMatch && !s.labels.includes(labelMatch[1]!)) return false;
        const statusMatch = c.match(/Status IN \[([^\]]*)\]/);
        if (statusMatch) {
          const wanted = statusMatch[1]!.split(",").map((x) => x.trim());
          const status = s.enabled ? "ENABLED" : "PAUSED";
          if (!wanted.includes(status)) return false;
        }
      }
      return true;
    });
    matched = [...matched].sort((a, b) => {
      for (const o of this.orderBys) {
        const [field, dir] = o.split(" ");
        const av = field === "AdGroupName" ? a.adGroupName : a.id;
        const bv = field === "AdGroupName" ? b.adGroupName : b.id;
        if (av !== bv) {
          return dir === "DESC" ? (av < bv ? 1 : -1) : av < bv ? -1 : 1;
        }
      }
      return 0;
    });
    return new FakeAdIterator(matched.map((s) => new FakeAd(s)));
  }
}

class FakeAdsApp {
  constructor(private readonly states: FakeAdState[]) {}
  ads(): FakeAdSelector {
    return new FakeAdSelector(this.states);
  }
}

class FakeLogger {
  readonly logs: string[] = [];
  log(message: unknown): void {
    this.logs.push(String(message));
  }
}

function runGeneratedScript(
  src: string,
  app: FakeAdsApp,
  logger: FakeLogger
): void {
  const fn = new Function("AdsApp", "Logger", `${src}\nmain();`);
  fn(app, logger);
}

describe("script-rotation v1.2.0 simulation", () => {
  it("rotates 1 → 2 → 3 across runs and enables ad groups", () => {
    const src = buildRotationScript({ label: "1" });
    const states: FakeAdState[] = [
      {
        id: "1001",
        adGroupName: "广告组 1",
        labels: ["1"],
        enabled: true,
        adGroupEnabled: true,
      },
      {
        id: "1002",
        adGroupName: "广告组 1 #2",
        labels: ["1"],
        enabled: false,
        adGroupEnabled: false,
      },
      {
        id: "1003",
        adGroupName: "广告组 1 #3",
        labels: ["1"],
        enabled: false,
        adGroupEnabled: false,
      },
    ];
    const app = new FakeAdsApp(states);
    const logger = new FakeLogger();

    runGeneratedScript(src, app, logger);
    expect(states.map((s) => s.enabled)).toEqual([false, true, false]);
    expect(states.every((s) => s.adGroupEnabled)).toBe(true);
    expect(logger.logs.at(-1)).toContain("共 3 条");
    expect(logger.logs.at(-1)).toContain("第 2 条");

    runGeneratedScript(src, app, logger);
    expect(states.map((s) => s.enabled)).toEqual([false, false, true]);
    expect(logger.logs.at(-1)).toContain("第 3 条");

    runGeneratedScript(src, app, logger);
    expect(states.map((s) => s.enabled)).toEqual([true, false, false]);
    expect(logger.logs.at(-1)).toContain("第 1 条");
  });

  it("starts from the first ad when none is enabled", () => {
    const src = buildRotationScript({ label: "1" });
    const states: FakeAdState[] = [
      {
        id: "1001",
        adGroupName: "广告组 1",
        labels: ["1"],
        enabled: false,
        adGroupEnabled: false,
      },
      {
        id: "1002",
        adGroupName: "广告组 1 #2",
        labels: ["1"],
        enabled: false,
        adGroupEnabled: false,
      },
    ];
    const app = new FakeAdsApp(states);
    const logger = new FakeLogger();
    runGeneratedScript(src, app, logger);
    expect(states.map((s) => s.enabled)).toEqual([true, false]);
    expect(states.every((s) => s.adGroupEnabled)).toBe(true);
  });

  it("does nothing when no ad carries the label", () => {
    const src = buildRotationScript({ label: "1" });
    const states: FakeAdState[] = [
      {
        id: "1001",
        adGroupName: "广告组 1",
        labels: ["2"],
        enabled: true,
        adGroupEnabled: true,
      },
    ];
    const app = new FakeAdsApp(states);
    const logger = new FakeLogger();
    runGeneratedScript(src, app, logger);
    expect(states[0]!.enabled).toBe(true);
    expect(logger.logs.at(-1)).toContain("下没有广告");
  });
});
