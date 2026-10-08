/**
 * Phase 11 — profitability math for AI offer analysis.
 * Computed in code (never by the LLM) so the numbers are deterministic.
 *
 * Extended: supports commission ranges (fixed amount OR price range ×
 * commission % range), bid suggestions at three risk levels, and
 * profit/loss scenarios across conversion rates.
 */

export interface Profitability {
  payout: number | null;
  payoutCurrency: string | null;
  estimatedCpc: number | null;
  /** Break-even conversion rate in percent, rounded to 2 decimals. */
  breakEvenCvrPct: number | null;
}

export interface CommissionRangeInput {
  /** Fixed commission amount (takes precedence if set). */
  fixedAmount?: number | null;
  /** Price range for percentage-based commission. */
  priceMin?: number | null;
  priceMax?: number | null;
  /** Commission percentage range (e.g. 5–10 means 5 to 10). */
  commissionPctMin?: number | null;
  commissionPctMax?: number | null;
  currency?: string | null;
}

export interface CommissionEstimate {
  /** Estimated commission low/high in currency units. */
  commissionMin: number | null;
  commissionMax: number | null;
  currency: string | null;
  /** How the estimate was derived. */
  method: "fixed" | "range" | "unknown";
}

export interface BidSuggestion {
  level: "conservative" | "moderate" | "aggressive";
  /** Suggested max CPC. */
  maxCpc: number | null;
  /** Fraction of break-even CPC used. */
  fraction: number;
  /** Expected margin at assumed conversion rate. */
  note: string;
}

export interface ProfitScenario {
  /** Assumed conversion rate in percent. */
  cvrPct: number;
  /** Profit per 100 clicks at suggested CPC (moderate level). */
  profitPer100Clicks: number | null;
  verdict: "profit" | "loss" | "unknown";
}

export interface ProfitAnalysis {
  commission: CommissionEstimate;
  /** Break-even CPC at assumed conversion rate. */
  breakEvenCpc: number | null;
  assumedCvrPct: number;
  bids: BidSuggestion[];
  scenarios: ProfitScenario[];
  currency: string | null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * breakEvenCvrPct = estimatedCpc / payout * 100 (2dp).
 * Nulls when inputs are missing or non-positive.
 */
export function computeProfitability(
  payout: unknown,
  payoutCurrency: unknown,
  estimatedCpc: unknown
): Profitability {
  const p = finiteOrNull(payout);
  const c = finiteOrNull(estimatedCpc);
  const breakEvenCvrPct =
    p !== null && c !== null && p > 0 && c > 0
      ? Math.round((c / p) * 100 * 100) / 100
      : null;
  return {
    payout: p,
    payoutCurrency:
      typeof payoutCurrency === "string" && payoutCurrency.trim()
        ? payoutCurrency.trim()
        : null,
    estimatedCpc: c,
    breakEvenCvrPct,
  };
}

/**
 * Estimate commission from fixed amount or price × percentage ranges.
 */
export function estimateCommission(
  input: CommissionRangeInput
): CommissionEstimate {
  const currency =
    typeof input.currency === "string" && input.currency.trim()
      ? input.currency.trim().toUpperCase()
      : null;
  const fixed = finiteOrNull(input.fixedAmount);
  if (fixed !== null && fixed > 0) {
    return {
      commissionMin: round2(fixed),
      commissionMax: round2(fixed),
      currency,
      method: "fixed",
    };
  }
  const pMin = finiteOrNull(input.priceMin);
  const pMax = finiteOrNull(input.priceMax) ?? pMin;
  const cMin = finiteOrNull(input.commissionPctMin);
  const cMax = finiteOrNull(input.commissionPctMax) ?? cMin;
  if (
    pMin !== null &&
    pMin > 0 &&
    pMax !== null &&
    pMax > 0 &&
    cMin !== null &&
    cMin > 0 &&
    cMax !== null &&
    cMax > 0
  ) {
    return {
      commissionMin: round2((pMin * cMin) / 100),
      commissionMax: round2((pMax * cMax) / 100),
      currency,
      method: "range",
    };
  }
  return { commissionMin: null, commissionMax: null, currency, method: "unknown" };
}

/**
 * Full profit analysis: commission estimate → break-even CPC →
 * three bid suggestions → profit/loss scenarios.
 *
 * assumedCvrPct: expected conversion rate in percent (default 2).
 * Bid fractions: conservative 50%, moderate 70%, aggressive 90% of break-even CPC.
 */
export function analyzeProfit(
  commissionInput: CommissionRangeInput,
  assumedCvrPct: unknown = 2
): ProfitAnalysis {
  const commission = estimateCommission(commissionInput);
  const cvr =
    finiteOrNull(assumedCvrPct) !== null && (assumedCvrPct as number) > 0
      ? (assumedCvrPct as number)
      : 2;
  const currency = commission.currency;

  // Use midpoint of commission range for break-even math.
  const midCommission =
    commission.commissionMin !== null && commission.commissionMax !== null
      ? (commission.commissionMin + commission.commissionMax) / 2
      : null;
  const breakEvenCpc =
    midCommission !== null && midCommission > 0
      ? round2((midCommission * cvr) / 100)
      : null;

  const levels: BidSuggestion["level"][] = ["conservative", "moderate", "aggressive"];
  const fractions = [0.5, 0.7, 0.9];
  const notes = [
    "低风险：即使转化率偏低也有缓冲",
    "平衡：兼顾流量规模与利润",
    "激进：接近盈亏线，需高转化支撑",
  ];
  const bids: BidSuggestion[] = levels.map((level, i) => ({
    level,
    maxCpc: breakEvenCpc !== null ? round2(breakEvenCpc * fractions[i]) : null,
    fraction: fractions[i],
    note: notes[i],
  }));

  // Scenarios at 1%, assumed, and 2× assumed conversion rates.
  const scenarioCvrs = [round2(cvr * 0.5), cvr, round2(cvr * 2)];
  const moderateCpc = bids[1].maxCpc;
  const scenarios: ProfitScenario[] = scenarioCvrs.map((cvrPct) => {
    if (midCommission === null || moderateCpc === null) {
      return { cvrPct, profitPer100Clicks: null, verdict: "unknown" as const };
    }
    // Profit per 100 clicks = 100 × cvr% × commission − 100 × cpc
    const revenue = 100 * (cvrPct / 100) * midCommission;
    const cost = 100 * moderateCpc;
    const profit = round2(revenue - cost);
    return {
      cvrPct,
      profitPer100Clicks: profit,
      verdict: profit > 0 ? ("profit" as const) : ("loss" as const),
    };
  });

  return { commission, breakEvenCpc, assumedCvrPct: cvr, bids, scenarios, currency };
}
