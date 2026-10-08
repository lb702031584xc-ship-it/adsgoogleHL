/**
 * P1 — brand keyword conflict checker (pure helpers, no DB).
 *
 * A keyword CONFLICTS when it contains any brand term as a substring
 * (case-insensitive). Bidding on merchant brand terms is the most common
 * trigger for merchant complaints and affiliate account bans.
 */

/** Lowercase, trim, collapse internal whitespace. */
export function normalizeKeyword(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

export interface BrandCheckResult {
  /** Normalized keyword. */
  keyword: string;
  conflict: boolean;
  /** Normalized brand terms found as substrings. */
  matchedTerms: string[];
}

/** Check each keyword against the brand-term list (substring match). */
export function checkBrandConflicts(
  keywords: string[],
  brandTerms: string[]
): BrandCheckResult[] {
  const terms = brandTerms.map(normalizeKeyword).filter(Boolean);
  return keywords.map((k) => {
    const keyword = normalizeKeyword(k);
    const matchedTerms = keyword
      ? terms.filter((t) => keyword.includes(t))
      : [];
    return { keyword, conflict: matchedTerms.length > 0, matchedTerms };
  });
}

/**
 * Build Google Ads negative keyword lists from conflicting keywords:
 * exact-match `[kw]` and phrase-match `"kw"` variants, deduplicated.
 */
export function buildNegativeKeywords(
  results: BrandCheckResult[]
): { exact: string[]; phrase: string[] } {
  const conflicting = [
    ...new Set(
      results.filter((r) => r.conflict).map((r) => r.keyword)
    ),
  ];
  return {
    exact: conflicting.map((k) => `[${k}]`),
    phrase: conflicting.map((k) => `"${k}"`),
  };
}
