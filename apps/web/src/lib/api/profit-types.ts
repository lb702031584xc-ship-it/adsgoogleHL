/**
 * Profit analysis shared types (client-safe, no server-only imports).
 */

export interface ProfitAnalysisInput {
  fixedAmount?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  commissionPctMin?: number | null;
  commissionPctMax?: number | null;
  currency?: string | null;
  assumedCvrPct?: number | null;
}

export interface BidSuggestion {
  level: "conservative" | "moderate" | "aggressive";
  maxCpc: number | null;
  fraction: number;
  note: string;
}

export interface ProfitScenario {
  cvrPct: number;
  profitPer100Clicks: number | null;
  verdict: "profit" | "loss" | "unknown";
}

export interface ProfitAnalysisResult {
  commission: {
    commissionMin: number | null;
    commissionMax: number | null;
    currency: string | null;
    method: "fixed" | "range" | "unknown";
  };
  breakEvenCpc: number | null;
  assumedCvrPct: number;
  bids: BidSuggestion[];
  scenarios: ProfitScenario[];
  currency: string | null;
}
