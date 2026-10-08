import { describe, expect, it } from "vitest";
import {
  buildNegativeKeywords,
  checkBrandConflicts,
  normalizeKeyword,
} from "./brand-check.js";

describe("brand-check", () => {
  it("normalizes keywords (case, trim, whitespace)", () => {
    expect(normalizeKeyword("  Nike   Shoes ")).toBe("nike shoes");
    expect(normalizeKeyword("ADIDAS")).toBe("adidas");
    expect(normalizeKeyword("a\tb\nc")).toBe("a b c");
  });

  it("flags substring conflicts case-insensitively", () => {
    const results = checkBrandConflicts(
      ["Nike running shoes", "cheap sneakers", "ADIDAS official store"],
      ["nike", "adidas"]
    );
    expect(results).toEqual([
      { keyword: "nike running shoes", conflict: true, matchedTerms: ["nike"] },
      { keyword: "cheap sneakers", conflict: false, matchedTerms: [] },
      {
        keyword: "adidas official store",
        conflict: true,
        matchedTerms: ["adidas"],
      },
    ]);
  });

  it("reports all matched terms per keyword", () => {
    const [r] = checkBrandConflicts(["nike adidas sale"], ["nike", "adidas"]);
    expect(r.conflict).toBe(true);
    expect(r.matchedTerms).toEqual(["nike", "adidas"]);
  });

  it("does not flag non-substring keywords", () => {
    const [r] = checkBrandConflicts(["nikon camera"], ["nike"]);
    expect(r.conflict).toBe(false);
  });

  it("ignores empty brand terms", () => {
    const [r] = checkBrandConflicts(["nike shoes"], ["", "  ", "nike"]);
    expect(r.matchedTerms).toEqual(["nike"]);
  });

  it("builds deduplicated exact + phrase negatives", () => {
    const results = checkBrandConflicts(
      ["Nike shoes", "nike shoes", "plain socks"],
      ["nike"]
    );
    const negatives = buildNegativeKeywords(results);
    expect(negatives.exact).toEqual(["[nike shoes]"]);
    expect(negatives.phrase).toEqual(['"nike shoes"']);
  });

  it("returns empty negatives when nothing conflicts", () => {
    const negatives = buildNegativeKeywords(
      checkBrandConflicts(["plain socks"], ["nike"])
    );
    expect(negatives).toEqual({ exact: [], phrase: [] });
  });
});
