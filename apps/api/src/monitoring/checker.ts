/**
 * P1 — traffic monitor breach checker (pure, no DB).
 *
 * Compares a recent window against a baseline window per tracking link:
 * - cvr_drop: relative CVR drop, (baseCvr - winCvr) / baseCvr > thresholdPct/100
 * - refund_spike: refund-rate increase in percentage POINTS,
 *   winRate - baseRate > thresholdPct/100
 * - geo_shift: absolute top-country share shift in percentage points,
 *   |winShare - baseShare| > thresholdPct/100
 * - duplicate_clicks: duplicate click rate within the window —
 *   same gclid (or same ip+trackingLinkId when gclid is absent) seen again
 *   within windowMinutes; breached when rate > thresholdPct/100.
 *   Evaluated by checkDuplicateClicks() over window.clickRows.
 * - click_burst: window clicks vs baseline hourly rate —
 *   windowClicks > expected * (thresholdPct/100), where
 *   expected = baselineClicks / baselineHours * windowHours.
 *   thresholdPct is a percentage of the baseline rate (300 = 3x).
 * - ctr_anomaly: absolute relative CTR deviation —
 *   |winCtr - baseCtr| / baseCtr > thresholdPct/100 (direction agnostic).
 * - device_anomaly: absolute top-deviceType share shift in percentage points,
 *   |winShare - baseShare| > thresholdPct/100 (mirrors geo_shift).
 *
 * Links are skipped when either window has fewer than minClicks clicks
 * (avoids noise on thin traffic).
 */

export type MonitorMetric =
  | "cvr_drop"
  | "refund_spike"
  | "geo_shift"
  | "duplicate_clicks"
  | "click_burst"
  | "ctr_anomaly"
  | "device_anomaly";

export const MONITOR_METRICS: readonly MonitorMetric[] = [
  "cvr_drop",
  "refund_spike",
  "geo_shift",
  "duplicate_clicks",
  "click_burst",
  "ctr_anomaly",
  "device_anomaly",
] as const;

export interface MonitorAggregates {
  clicks: number;
  conversions: number;
  refundedOrders: number;
  /** confirmed + refunded orders (the decided denominator). */
  decidedOrders: number;
  /** Share (0..1) of the top country, null when unknown. */
  topCountryShare: number | null;
  /**
   * Raw click rows of the window (capped) for duplicate_clicks.
   * Omitted for the baseline — duplicate detection is window-local.
   */
  clickRows?: ClickRow[];
  /** Share (0..1) of the top deviceType, null/undefined when unknown. */
  topDeviceShare?: number | null;
}

/** One raw click row used by duplicate-click detection (pure input). */
export interface ClickRow {
  gclid: string | null;
  ipAddress: string | null;
  trackingLinkId: string;
  occurredAt: Date;
}

export interface MonitorRuleInput {
  metric: MonitorMetric;
  /**
   * cvr_drop: relative %; refund_spike/geo_shift/device_anomaly: percentage
   * points; duplicate_clicks: max duplicate rate %; click_burst: % of
   * baseline rate (300 = 3x); ctr_anomaly: relative % deviation.
   */
  thresholdPct: number;
  minClicks: number;
  /** click_burst: window span in hours. */
  windowHours?: number;
  /** click_burst: baseline span in hours. */
  baselineHours?: number;
  /** duplicate_clicks: dupe-grouping span in minutes (default 30). */
  windowMinutes?: number;
}

export interface BreachCheck {
  breached: boolean;
  metric: MonitorMetric;
  windowValue: number | null;
  baselineValue: number | null;
  /** Human-readable delta, e.g. "-62.5% relative" or "+7.0pp". Null when skipped. */
  deltaDescription: string | null;
  /** Why the check was skipped (thin traffic / undefined baseline). */
  skipReason: string | null;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPp(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}pp`;
}

export interface DuplicateClicksOptions {
  /** Dupe-grouping span in minutes (default 30). */
  windowMinutes?: number;
  /** Breach when duplicate rate exceeds this (0..1, default 0.05). */
  thresholdRate?: number;
  /** Skip when fewer rows than this (default 50). */
  minClicks?: number;
}

/**
 * Pure duplicate-click detector.
 *
 * Identity key: gclid when present, otherwise `${ipAddress}:${trackingLinkId}`.
 * Rows with neither get a unique key (never count as duplicates). A row is a
 * duplicate when a previous row with the same key occurred within
 * windowMinutes. Duplicate rate = duplicate rows / total rows.
 */
export function checkDuplicateClicks(
  rows: ClickRow[],
  opts: DuplicateClicksOptions = {}
): BreachCheck {
  const windowMinutes = opts.windowMinutes ?? 30;
  const thresholdRate = opts.thresholdRate ?? 0.05;
  const minClicks = opts.minClicks ?? 50;
  const base = {
    breached: false,
    metric: "duplicate_clicks" as MonitorMetric,
    windowValue: null as number | null,
    baselineValue: null as number | null,
    deltaDescription: null as string | null,
    skipReason: null as string | null,
  };
  if (rows.length < minClicks) {
    return { ...base, skipReason: "thin-traffic" };
  }

  const windowMs = windowMinutes * 60 * 1000;
  const timesByKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const g = r.gclid?.trim();
    const ip = r.ipAddress?.trim();
    const key = g
      ? `gclid:${g}`
      : ip
        ? `ip:${ip}:${r.trackingLinkId}`
        : `anon:${i}`;
    const t = r.occurredAt.getTime();
    const arr = timesByKey.get(key);
    if (arr) arr.push(t);
    else timesByKey.set(key, [t]);
  });

  let duplicateClicks = 0;
  let duplicateGroups = 0;
  for (const times of timesByKey.values()) {
    if (times.length < 2) continue;
    times.sort((a, b) => a - b);
    let dupes = 0;
    let last = times[0];
    for (let i = 1; i < times.length; i++) {
      if (times[i] - last <= windowMs) dupes++;
      last = times[i];
    }
    if (dupes > 0) {
      duplicateClicks += dupes;
      duplicateGroups += 1;
    }
  }

  const rate = rows.length > 0 ? duplicateClicks / rows.length : 0;
  return {
    ...base,
    windowValue: rate,
    deltaDescription: `${fmtPct(rate)} duplicate (${duplicateGroups} groups)`,
    breached: rate > thresholdRate,
  };
}

export function checkBreach(
  rule: MonitorRuleInput,
  window: MonitorAggregates,
  baseline: MonitorAggregates
): BreachCheck {
  const base = {
    breached: false,
    metric: rule.metric,
    windowValue: null as number | null,
    baselineValue: null as number | null,
    deltaDescription: null as string | null,
    skipReason: null as string | null,
  };
  if (window.clicks < rule.minClicks || baseline.clicks < rule.minClicks) {
    return { ...base, skipReason: "thin-traffic" };
  }

  if (rule.metric === "cvr_drop") {
    const baseCvr = baseline.conversions / baseline.clicks;
    if (baseCvr <= 0) {
      return { ...base, skipReason: "zero-baseline-cvr" };
    }
    const winCvr = window.conversions / window.clicks;
    const relDrop = (baseCvr - winCvr) / baseCvr;
    return {
      ...base,
      windowValue: winCvr,
      baselineValue: baseCvr,
      deltaDescription: `${relDrop >= 0 ? "-" : "+"}${fmtPct(Math.abs(relDrop))} relative`,
      breached: relDrop > rule.thresholdPct / 100,
    };
  }

  if (rule.metric === "refund_spike") {
    if (window.decidedOrders === 0 || baseline.decidedOrders === 0) {
      return { ...base, skipReason: "no-decided-orders" };
    }
    const baseRate = baseline.refundedOrders / baseline.decidedOrders;
    const winRate = window.refundedOrders / window.decidedOrders;
    const delta = winRate - baseRate;
    return {
      ...base,
      windowValue: winRate,
      baselineValue: baseRate,
      deltaDescription: fmtPp(delta),
      breached: delta > rule.thresholdPct / 100,
    };
  }

  // geo_shift
  if (rule.metric === "geo_shift") {
    if (window.topCountryShare === null || baseline.topCountryShare === null) {
      return { ...base, skipReason: "unknown-country-share" };
    }
    const delta = Math.abs(window.topCountryShare - baseline.topCountryShare);
    return {
      ...base,
      windowValue: window.topCountryShare,
      baselineValue: baseline.topCountryShare,
      deltaDescription: fmtPp(delta),
      breached: delta > rule.thresholdPct / 100,
    };
  }

  if (rule.metric === "duplicate_clicks") {
    return checkDuplicateClicks(window.clickRows ?? [], {
      windowMinutes: rule.windowMinutes ?? 30,
      thresholdRate: rule.thresholdPct / 100,
      minClicks: rule.minClicks,
    });
  }

  if (rule.metric === "click_burst") {
    if (!rule.windowHours || !rule.baselineHours) {
      return { ...base, skipReason: "missing-window-hours" };
    }
    const expected = (baseline.clicks / rule.baselineHours) * rule.windowHours;
    if (expected <= 0) {
      return { ...base, skipReason: "zero-baseline-rate" };
    }
    const ratio = window.clicks / expected;
    const multiple = rule.thresholdPct / 100; // 300 -> 3x
    return {
      ...base,
      windowValue: window.clicks,
      baselineValue: expected,
      deltaDescription: `${fmtPct(ratio)} of baseline rate`,
      breached: ratio > multiple,
    };
  }

  if (rule.metric === "ctr_anomaly") {
    const baseCtr = baseline.conversions / baseline.clicks;
    if (baseCtr <= 0) {
      return { ...base, skipReason: "zero-baseline-cvr" };
    }
    const winCtr = window.conversions / window.clicks;
    const relDev = Math.abs(winCtr - baseCtr) / baseCtr;
    const sign = winCtr >= baseCtr ? "+" : "-";
    return {
      ...base,
      windowValue: winCtr,
      baselineValue: baseCtr,
      deltaDescription: `${sign}${fmtPct(relDev)} relative`,
      breached: relDev > rule.thresholdPct / 100,
    };
  }

  // device_anomaly (mirrors geo_shift)
  if (window.topDeviceShare == null || baseline.topDeviceShare == null) {
    return { ...base, skipReason: "unknown-device-share" };
  }
  const delta = Math.abs(window.topDeviceShare - baseline.topDeviceShare);
  return {
    ...base,
    windowValue: window.topDeviceShare,
    baselineValue: baseline.topDeviceShare,
    deltaDescription: fmtPp(delta),
    breached: delta > rule.thresholdPct / 100,
  };
}
