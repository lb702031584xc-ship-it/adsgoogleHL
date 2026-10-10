/**
 * 第十二批：新手任务自动检测单测（内存 fake Prisma）。
 */
import { describe, expect, it } from "vitest";
import { detectTaskCompletion, ONBOARD_TASKS } from "./tasks.js";

function makeFake(opts: {
  paapi?: boolean;
  pipeline?: number;
  landing?: number;
  tracking?: number;
  campaign?: number;
  clicks?: number;
  throwOn?: string;
}) {
  const countFor = (model: string) => {
    if (opts.throwOn === model) throw new Error("db down");
    switch (model) {
      case "productPipelineRun":
        return opts.pipeline ?? 0;
      case "landingPage":
        return opts.landing ?? 0;
      case "trackingLink":
        return opts.tracking ?? 0;
      case "campaign":
        return opts.campaign ?? 0;
      case "click":
        return opts.clicks ?? 0;
      default:
        return 0;
    }
  };
  return {
    aiSetting: {
      findUnique: async () =>
        opts.paapi ? { value: "enc" } : null,
    },
    productPipelineRun: { count: async () => countFor("productPipelineRun") },
    landingPage: { count: async () => countFor("landingPage") },
    trackingLink: { count: async () => countFor("trackingLink") },
    campaign: { count: async () => countFor("campaign") },
    click: { count: async () => countFor("click") },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("ONBOARD_TASKS", () => {
  it("7 天任务定义完整", () => {
    expect(ONBOARD_TASKS).toHaveLength(7);
    expect(ONBOARD_TASKS.map((t) => t.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ONBOARD_TASKS[6]!.autoCheck).toBeNull(); // Day7 只能手动
  });
});

describe("detectTaskCompletion", () => {
  it("全空 → 全 false", async () => {
    const r = await detectTaskCompletion(makeFake({}), "t1");
    expect(Object.values(r).every((v) => v === false)).toBe(true);
  });

  it("有数据 → 对应任务 true", async () => {
    const r = await detectTaskCompletion(
      makeFake({ paapi: true, pipeline: 2, landing: 1, tracking: 3, campaign: 1, clicks: 5 }),
      "t1"
    );
    expect(r.paapi).toBe(true);
    expect(r.pipeline).toBe(true);
    expect(r.landing).toBe(true);
    expect(r.tracking).toBe(true);
    expect(r.campaign).toBe(true);
    expect(r.first_click).toBe(true);
  });

  it("DB 异常 → 该项 false，不抛错", async () => {
    const r = await detectTaskCompletion(makeFake({ throwOn: "click", paapi: true }), "t1");
    expect(r.first_click).toBe(false);
    expect(r.paapi).toBe(true);
  });
});
