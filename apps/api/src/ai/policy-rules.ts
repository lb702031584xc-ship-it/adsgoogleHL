/**
 * Phase 1 Offer Intelligence — deterministic Critical Rules engine (§6).
 *
 * Pure logic, no LLM: when a structured policy verdict hits one of the
 * hard blocks, the offer must be DO_NOT_RUN. UNKNOWN never kills a deal
 * (conservative but not trigger-happy).
 */

export type PolicyRuleName =
  | "PPC"
  | "DIRECT_LINK"
  | "BRAND_BIDDING"
  | "NON_BRAND_KEYWORDS"
  | "SEARCH_ADS"
  | "DISPLAY"
  | "SOCIAL"
  | "GEO"
  | "LANDING_PAGE";

export type RuleVerdict = "ALLOWED" | "FORBIDDEN" | "REQUIRED" | "UNKNOWN";

export type TrafficMode = "DIRECT_LINK" | "LANDING_PAGE";

export interface CriticalHit {
  rule: PolicyRuleName;
  verdict: RuleVerdict;
  reason: string;
}

export interface CriticalRulesResult {
  decision: "DO_NOT_RUN" | "PROCEED";
  hits: CriticalHit[];
}

export interface CriticalRulesOptions {
  trafficMode: TrafficMode;
  /** Target geo codes (e.g. ["US", "DE"]); empty = no geo target declared. */
  geo: string[];
  /**
   * Geos explicitly forbidden by the offer terms. Matched against opts.geo
   * case-insensitively. Empty = no forbidden geos declared.
   */
  forbiddenGeo?: string[];
}

/**
 * Deterministic Critical Rules (§6):
 *  - PPC = FORBIDDEN → DO_NOT_RUN
 *  - trafficMode = DIRECT_LINK and DIRECT_LINK = FORBIDDEN → DO_NOT_RUN
 *  - GEO = FORBIDDEN and any target geo in the forbidden list → DO_NOT_RUN
 *  - UNKNOWN never causes DO_NOT_RUN (conservative, not trigger-happy)
 * Everything else → PROCEED.
 */
export function evaluateCriticalRules(
  rules: Record<string, RuleVerdict>,
  opts: CriticalRulesOptions
): CriticalRulesResult {
  const hits: CriticalHit[] = [];
  const get = (name: PolicyRuleName): RuleVerdict | undefined => {
    const v = rules[name];
    return v === "ALLOWED" ||
      v === "FORBIDDEN" ||
      v === "REQUIRED" ||
      v === "UNKNOWN"
      ? v
      : undefined;
  };

  if (get("PPC") === "FORBIDDEN") {
    hits.push({
      rule: "PPC",
      verdict: "FORBIDDEN",
      reason: "Offer terms forbid paid search / PPC promotion.",
    });
  }

  if (opts.trafficMode === "DIRECT_LINK" && get("DIRECT_LINK") === "FORBIDDEN") {
    hits.push({
      rule: "DIRECT_LINK",
      verdict: "FORBIDDEN",
      reason:
        "Offer terms forbid direct linking while DIRECT_LINK traffic mode is selected.",
    });
  }

  if (get("GEO") === "FORBIDDEN") {
    const targets = (opts.geo ?? []).map((g) => g.trim().toUpperCase());
    const forbidden = new Set(
      (opts.forbiddenGeo ?? []).map((g) => g.trim().toUpperCase())
    );
    const blocked = targets.filter((g) => g && forbidden.has(g));
    if (blocked.length > 0) {
      hits.push({
        rule: "GEO",
        verdict: "FORBIDDEN",
        reason: `Target geo(s) ${blocked.join(", ")} are forbidden by offer terms.`,
      });
    }
  }

  return {
    decision: hits.length > 0 ? "DO_NOT_RUN" : "PROCEED",
    hits,
  };
}
