import { describe, expect, it } from "vitest";
import {
  checkBreach,
  checkDuplicateClicks,
  type ClickRow,
  type MonitorAggregates,
} from "./checker.js";

const agg = (over: Partial<MonitorAggregates>): MonitorAggregates => ({
  clicks: 100,
  conversions: 5,
  refundedOrders: 1,
  decidedOrders: 10,
  topCountryShare: 0.6,
  ...over,
});

const clickRow = (over: Partial<ClickRow> = {}): ClickRow => ({
  gclid: null,
  ipAddress: null,
  trackingLinkId: "link-1",
  occurredAt: new Date("2026-10-05T10:00:00Z"),
  ...over,
});

/** N rows sharing one gclid, spaced `gapMin` minutes apart. */
function gclidRows(n: number, gapMin: number, gclid = "g-1"): ClickRow[] {
  const rows: ClickRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      clickRow({
        gclid,
        occurredAt: new Date(
          new Date("2026-10-05T10:00:00Z").getTime() + i * gapMin * 60 * 1000
        ),
      })
    );
  }
  return rows;
}

describe("monitoring checker", () => {
  it("cvr_drop breaches on relative drop beyond threshold", () => {
    const r = checkBreach(
      { metric: "cvr_drop", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 100, conversions: 1 }), // 1% vs 5% baseline = 80% drop
      agg({ clicks: 200, conversions: 10 })
    );
    expect(r.breached).toBe(true);
    expect(r.windowValue).toBeCloseTo(0.01);
    expect(r.baselineValue).toBeCloseTo(0.05);
    expect(r.deltaDescription).toContain("80.0%");
  });

  it("cvr_drop does not breach below threshold", () => {
    const r = checkBreach(
      { metric: "cvr_drop", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 100, conversions: 4 }), // 4% vs 5% = 20% drop
      agg({ clicks: 200, conversions: 10 })
    );
    expect(r.breached).toBe(false);
  });

  it("cvr_drop skips zero baseline CVR", () => {
    const r = checkBreach(
      { metric: "cvr_drop", thresholdPct: 50, minClicks: 50 },
      agg({}),
      agg({ clicks: 200, conversions: 0 })
    );
    expect(r.breached).toBe(false);
    expect(r.skipReason).toBe("zero-baseline-cvr");
  });

  it("refund_spike breaches on percentage-point increase", () => {
    const r = checkBreach(
      { metric: "refund_spike", thresholdPct: 5, minClicks: 50 },
      agg({ refundedOrders: 3, decidedOrders: 10 }), // 30% vs 10% = +20pp
      agg({ refundedOrders: 1, decidedOrders: 10 })
    );
    expect(r.breached).toBe(true);
    expect(r.deltaDescription).toBe("+20.0pp");
  });

  it("refund_spike uses points not relative (5% of 10% would be 0.5pp)", () => {
    const r = checkBreach(
      { metric: "refund_spike", thresholdPct: 5, minClicks: 50 },
      agg({ refundedOrders: 2, decidedOrders: 20 }), // 10% vs 10% = +0pp
      agg({ refundedOrders: 1, decidedOrders: 10 })
    );
    expect(r.breached).toBe(false);
  });

  it("refund_spike skips when no decided orders", () => {
    const r = checkBreach(
      { metric: "refund_spike", thresholdPct: 5, minClicks: 50 },
      agg({ decidedOrders: 0, refundedOrders: 0 }),
      agg({})
    );
    expect(r.breached).toBe(false);
    expect(r.skipReason).toBe("no-decided-orders");
  });

  it("geo_shift breaches on absolute share shift", () => {
    const r = checkBreach(
      { metric: "geo_shift", thresholdPct: 30, minClicks: 50 },
      agg({ topCountryShare: 0.2 }),
      agg({ topCountryShare: 0.6 })
    );
    expect(r.breached).toBe(true); // 40pp shift
    expect(r.deltaDescription).toBe("+40.0pp");
  });

  it("geo_shift does not breach below threshold", () => {
    const r = checkBreach(
      { metric: "geo_shift", thresholdPct: 30, minClicks: 50 },
      agg({ topCountryShare: 0.5 }),
      agg({ topCountryShare: 0.6 })
    );
    expect(r.breached).toBe(false);
  });

  it("skips thin traffic in either window", () => {
    const thinWindow = checkBreach(
      { metric: "cvr_drop", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 49 }),
      agg({ clicks: 500 })
    );
    expect(thinWindow.breached).toBe(false);
    expect(thinWindow.skipReason).toBe("thin-traffic");

    const thinBaseline = checkBreach(
      { metric: "cvr_drop", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 500 }),
      agg({ clicks: 10 })
    );
    expect(thinBaseline.breached).toBe(false);
    expect(thinBaseline.skipReason).toBe("thin-traffic");
  });

  it("duplicate_clicks breaches when same-gclid rate exceeds threshold", () => {
    // 100 rows: 10 dupes of the same gclid (5-min apart, within 30-min window)
    // + 90 unique rows => 10% duplicate rate > 5%.
    const rows = [
      ...gclidRows(11, 5), // first is the seed, 10 are dupes
      ...Array.from({ length: 89 }, (_, i) =>
        clickRow({ gclid: `unique-${i}` })
      ),
    ];
    const r = checkDuplicateClicks(rows, { thresholdRate: 0.05, minClicks: 50 });
    expect(r.breached).toBe(true);
    expect(r.metric).toBe("duplicate_clicks");
    expect(r.windowValue).toBeCloseTo(0.1);
    expect(r.deltaDescription).toContain("1 groups");
  });

  it("duplicate_clicks groups by ip+link when gclid is absent", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        clickRow({
          ipAddress: "1.2.3.4",
          occurredAt: new Date(
            new Date("2026-10-05T10:00:00Z").getTime() + i * 60 * 1000
          ),
        })
      ),
      ...Array.from({ length: 94 }, (_, i) => clickRow({ gclid: `u-${i}` })),
    ];
    const r = checkDuplicateClicks(rows, { thresholdRate: 0.05, minClicks: 50 });
    expect(r.breached).toBe(false); // 5/100 = 5%, not > 5%
    expect(r.windowValue).toBeCloseTo(0.05);
  });

  it("duplicate_clicks ignores dupes outside the time window", () => {
    const rows = [
      ...gclidRows(11, 60), // 60-min apart: no two within 30 min
      ...Array.from({ length: 89 }, (_, i) =>
        clickRow({ gclid: `unique-${i}` })
      ),
    ];
    const r = checkDuplicateClicks(rows, { thresholdRate: 0.05, minClicks: 50 });
    expect(r.breached).toBe(false);
    expect(r.windowValue).toBe(0);
  });

  it("duplicate_clicks skips thin traffic", () => {
    const r = checkDuplicateClicks(gclidRows(10, 1), { minClicks: 50 });
    expect(r.breached).toBe(false);
    expect(r.skipReason).toBe("thin-traffic");
  });

  it("checkBreach wires duplicate_clicks through window.clickRows", () => {
    const rows = [
      ...gclidRows(11, 5),
      ...Array.from({ length: 89 }, (_, i) =>
        clickRow({ gclid: `unique-${i}` })
      ),
    ];
    const r = checkBreach(
      { metric: "duplicate_clicks", thresholdPct: 5, minClicks: 50 },
      agg({ clicks: 100, clickRows: rows }),
      agg({ clicks: 100 })
    );
    expect(r.breached).toBe(true);
  });

  it("click_burst breaches on 3x baseline rate", () => {
    // baseline: 168 clicks / 168h = 1/h -> expected 24 in window;
    // window has 100 clicks = 4.17x -> breach at 3x.
    const r = checkBreach(
      {
        metric: "click_burst",
        thresholdPct: 300,
        minClicks: 50,
        windowHours: 24,
        baselineHours: 168,
      },
      agg({ clicks: 100 }),
      agg({ clicks: 168 })
    );
    expect(r.breached).toBe(true);
    expect(r.baselineValue).toBeCloseTo(24);
    expect(r.deltaDescription).toContain("of baseline rate");
  });

  it("click_burst does not breach below the multiple", () => {
    const r = checkBreach(
      {
        metric: "click_burst",
        thresholdPct: 300,
        minClicks: 50,
        windowHours: 24,
        baselineHours: 168,
      },
      agg({ clicks: 60 }), // 2.5x
      agg({ clicks: 168 })
    );
    expect(r.breached).toBe(false);
  });

  it("click_burst skips when baseline rate is zero", () => {
    const r = checkBreach(
      {
        metric: "click_burst",
        thresholdPct: 300,
        minClicks: 50,
        windowHours: 24,
        baselineHours: 168,
      },
      agg({ clicks: 100 }),
      agg({ clicks: 0, conversions: 0 })
    );
    // thin-traffic skip fires first (baseline 0 clicks < minClicks)
    expect(r.breached).toBe(false);
    expect(r.skipReason).toBe("thin-traffic");
  });

  it("click_burst skips when window hours are missing", () => {
    const r = checkBreach(
      { metric: "click_burst", thresholdPct: 300, minClicks: 50 },
      agg({ clicks: 100 }),
      agg({ clicks: 168 })
    );
    expect(r.breached).toBe(false);
    expect(r.skipReason).toBe("missing-window-hours");
  });

  it("ctr_anomaly breaches on absolute deviation beyond threshold", () => {
    const r = checkBreach(
      { metric: "ctr_anomaly", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 100, conversions: 1 }), // 1% vs 5% = 80% deviation
      agg({ clicks: 200, conversions: 10 })
    );
    expect(r.breached).toBe(true);
    expect(r.deltaDescription).toContain("80.0%");
  });

  it("ctr_anomaly breaches on upward deviation too (direction agnostic)", () => {
    const r = checkBreach(
      { metric: "ctr_anomaly", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 100, conversions: 10 }), // 10% vs 5% = 100% deviation up
      agg({ clicks: 200, conversions: 10 })
    );
    expect(r.breached).toBe(true);
    expect(r.deltaDescription).toContain("+100.0%");
  });

  it("ctr_anomaly does not breach below threshold", () => {
    const r = checkBreach(
      { metric: "ctr_anomaly", thresholdPct: 50, minClicks: 50 },
      agg({ clicks: 100, conversions: 6 }), // 6% vs 5% = 20% deviation
      agg({ clicks: 200, conversions: 10 })
    );
    expect(r.breached).toBe(false);
  });

  it("device_anomaly breaches on absolute device share shift", () => {
    const r = checkBreach(
      { metric: "device_anomaly", thresholdPct: 30, minClicks: 50 },
      agg({ topDeviceShare: 0.2 }),
      agg({ topDeviceShare: 0.6 })
    );
    expect(r.breached).toBe(true); // 40pp shift
    expect(r.deltaDescription).toBe("+40.0pp");
  });

  it("device_anomaly does not breach below threshold", () => {
    const r = checkBreach(
      { metric: "device_anomaly", thresholdPct: 30, minClicks: 50 },
      agg({ topDeviceShare: 0.5 }),
      agg({ topDeviceShare: 0.6 })
    );
    expect(r.breached).toBe(false);
  });

  it("device_anomaly skips when device share is unknown", () => {
    const r = checkBreach(
      { metric: "device_anomaly", thresholdPct: 30, minClicks: 50 },
      agg({ topDeviceShare: null }),
      agg({ topDeviceShare: 0.6 })
    );
    expect(r.breached).toBe(false);
    expect(r.skipReason).toBe("unknown-device-share");
  });
});
