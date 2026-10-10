/**
 * 节日日历单测：固定日期 / 第N个周X / 跨年 / 倒计时 / 复活节算法。
 */
import { describe, expect, it } from "vitest";
import {
  getNowHotCategories,
  getUpcomingHolidays,
  isCountryCode,
  resolveHolidayDate,
  HOLIDAYS,
} from "./holidays.js";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("resolveHolidayDate", () => {
  it("固定日期：圣诞节 12-25", () => {
    const h = HOLIDAYS.find((x) => x.id === "us-christmas")!;
    expect(resolveHolidayDate(h, 2026).toISOString().slice(0, 10)).toBe("2026-12-25");
  });
  it("第N个周X：2026 黑色星期五 = 11月第4个周五", () => {
    const h = HOLIDAYS.find((x) => x.id === "us-black-friday")!;
    // 2026-11-27 是周五
    expect(resolveHolidayDate(h, 2026).toISOString().slice(0, 10)).toBe("2026-11-27");
  });
  it("网络星期一 = 黑五 +3 天", () => {
    const h = HOLIDAYS.find((x) => x.id === "us-cyber-monday")!;
    expect(resolveHolidayDate(h, 2026).toISOString().slice(0, 10)).toBe("2026-11-30");
  });
  it("复活节算法：2026-04-05，2027-03-28", () => {
    const h = HOLIDAYS.find((x) => x.id === "us-easter")!;
    expect(resolveHolidayDate(h, 2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(resolveHolidayDate(h, 2027).toISOString().slice(0, 10)).toBe("2027-03-28");
  });
  it("复活节偏移：英国母亲节 = 复活节 -21 天", () => {
    const h = HOLIDAYS.find((x) => x.id === "uk-mothers-day")!;
    // 2026-04-05 - 21 天 = 2026-03-15
    expect(resolveHolidayDate(h, 2026).toISOString().slice(0, 10)).toBe("2026-03-15");
  });
  it("指定日期前的最后一个周X：加拿大维多利亚日 2026 = 05-18（周一）", () => {
    const h = HOLIDAYS.find((x) => x.id === "ca-victoria-day")!;
    const iso = resolveHolidayDate(h, 2026).toISOString().slice(0, 10);
    expect(iso).toBe("2026-05-18");
  });
  it("最后一个周X：英国夏季银行假日 2026 = 08-31（周一）", () => {
    const h = HOLIDAYS.find((x) => x.id === "uk-summer-bank")!;
    expect(resolveHolidayDate(h, 2026).toISOString().slice(0, 10)).toBe("2026-08-31");
  });
});

describe("getUpcomingHolidays", () => {
  it("2026-10-09 的 US 时间线：万圣节/黑五/圣诞在 90 天内，按倒计时排序", () => {
    const list = getUpcomingHolidays("US", d("2026-10-09"), 90);
    const ids = list.map((x) => x.id);
    expect(ids).toContain("us-halloween");
    expect(ids).toContain("us-black-friday");
    expect(ids).toContain("us-christmas");
    // 排序：倒计时递增
    const days = list.map((x) => x.daysLeft);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    const halloween = list.find((x) => x.id === "us-halloween")!;
    expect(halloween.daysLeft).toBe(22);
    expect(halloween.stage).toBe("prepare"); // 22 <= leadDays 45
  });
  it("跨年：2026-12-28 的 US 时间线应包含明年元旦/情人节", () => {
    const list = getUpcomingHolidays("US", d("2026-12-28"), 90);
    const ids = list.map((x) => x.id);
    expect(ids).toContain("us-new-year");
    expect(ids).toContain("us-valentine");
    const ny = list.find((x) => x.id === "us-new-year")!;
    expect(ny.date).toBe("2027-01-01");
    expect(ny.daysLeft).toBe(4);
  });
  it("已过期的今年节日不再出现", () => {
    const list = getUpcomingHolidays("US", d("2026-10-09"), 90);
    expect(list.find((x) => x.id === "us-valentine")).toBeUndefined();
  });
  it("冲刺期判定：万圣节前 10 天 → sprint", () => {
    const list = getUpcomingHolidays("US", d("2026-10-21"), 90);
    const h = list.find((x) => x.id === "us-halloween")!;
    expect(h.daysLeft).toBe(10);
    expect(h.stage).toBe("sprint");
    expect(h.prepAdviceZh).toContain("冲刺期");
  });
  it("选品期判定：距圣诞 > leadDays → plan", () => {
    const list = getUpcomingHolidays("US", d("2026-09-01"), 120);
    const h = list.find((x) => x.id === "us-christmas")!;
    expect(h.stage).toBe("plan");
    expect(h.prepAdviceZh).toContain("选品");
  });
});

describe("getNowHotCategories", () => {
  it("2026-10-09 US：万圣节品类在热销中", () => {
    const cats = getNowHotCategories("US", d("2026-10-09"));
    const zh = cats.map((x) => x.zh);
    expect(zh).toContain("服装");
    // 去重
    expect(new Set(zh).size).toBe(zh.length);
  });
  it("10 月中旬：万圣节+黑五品类进入备货窗口", () => {
    const cats = getNowHotCategories("US", d("2026-10-15"));
    const zh = cats.map((x) => x.zh);
    expect(zh).toContain("服装"); // 万圣节 16 天后，lead 45
    expect(cats.length).toBeGreaterThan(0);
  });
});

describe("isCountryCode", () => {
  it("9 国通过，其他拒绝", () => {
    for (const c of ["US", "UK", "DE", "FR", "IT", "ES", "CA", "AU", "JP"]) {
      expect(isCountryCode(c)).toBe(true);
    }
    expect(isCountryCode("CN")).toBe(false);
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });
});
