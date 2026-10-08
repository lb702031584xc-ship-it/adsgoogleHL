/**
 * Phase 4 Research Lab — detector unit tests (pure functions).
 * Covers: band boundaries (§21), pairwise comparison, weighted scoring.
 */
import { describe, expect, it } from "vitest";
import {
  bandForScore,
  compareResponses,
  normalizeUrl,
  scoreDifferential,
  textSimilarity,
  type DifferentialMetrics,
  type ResponseSnapshot,
} from "./detector.js";

function snap(over: Partial<ResponseSnapshot> = {}): ResponseSnapshot {
  return {
    variantName: "desktop-us",
    httpStatus: 200,
    finalUrl: "https://example.com/offer",
    redirectChain: [],
    headers: { "content-type": "text/html" },
    htmlHash: "aaa",
    contentHash: "bbb",
    textExcerpt: "buy cheap shoes now with free shipping",
    linksCount: 10,
    scriptsCount: 3,
    ...over,
  };
}

function zeroMetrics(): DifferentialMetrics {
  return {
    statusDiff: false,
    finalUrlDiff: false,
    redirectChainDiff: false,
    headerDiffCount: 0,
    headerDiffKeys: [],
    htmlHashEqual: true,
    textSimilarity: 1,
    contentDiffPct: 0,
  };
}

describe("bandForScore — §21 five bands", () => {
  const cases: Array<[number, string]> = [
    [0, "NORMAL"],
    [20, "NORMAL"],
    [21, "MINOR"],
    [40, "MINOR"],
    [41, "SUSPICIOUS"],
    [60, "SUSPICIOUS"],
    [61, "HIGH_RISK"],
    [80, "HIGH_RISK"],
    [81, "STRONG"],
    [100, "STRONG"],
  ];
  for (const [score, band] of cases) {
    it(`score ${score} → ${band}`, () => {
      expect(bandForScore(score)).toBe(band);
    });
  }
  it("clamps out-of-range scores", () => {
    expect(bandForScore(-5)).toBe("NORMAL");
    expect(bandForScore(500)).toBe("STRONG");
  });
});

describe("compareResponses", () => {
  it("identical snapshots → no differential", () => {
    const m = compareResponses(snap(), snap());
    expect(m.statusDiff).toBe(false);
    expect(m.finalUrlDiff).toBe(false);
    expect(m.redirectChainDiff).toBe(false);
    expect(m.headerDiffCount).toBe(0);
    expect(m.headerDiffKeys).toEqual([]);
    expect(m.htmlHashEqual).toBe(true);
    expect(m.textSimilarity).toBe(1);
    expect(m.contentDiffPct).toBe(0);
    expect(scoreDifferential(m)).toBe(0);
  });

  it("detects status difference", () => {
    const m = compareResponses(snap(), snap({ httpStatus: 403 }));
    expect(m.statusDiff).toBe(true);
    expect(scoreDifferential(m)).toBeGreaterThanOrEqual(20);
  });

  it("ignores trailing-slash-only URL differences", () => {
    const m = compareResponses(
      snap({ finalUrl: "https://example.com/offer" }),
      snap({ finalUrl: "https://example.com/offer/" })
    );
    expect(m.finalUrlDiff).toBe(false);
  });

  it("detects final URL host differences", () => {
    const m = compareResponses(
      snap({ finalUrl: "https://example.com/offer" }),
      snap({ finalUrl: "https://other.net/offer" })
    );
    expect(m.finalUrlDiff).toBe(true);
  });

  it("detects redirect chain differences", () => {
    const m = compareResponses(
      snap(),
      snap({ redirectChain: [{ url: "https://t.co/x", status: 301 }] })
    );
    expect(m.redirectChainDiff).toBe(true);
  });

  it("counts header differences by name", () => {
    const m = compareResponses(
      snap({ headers: { "content-type": "text/html", server: "nginx" } }),
      snap({ headers: { "content-type": "text/html", server: "apache" } })
    );
    expect(m.headerDiffCount).toBe(1);
    expect(m.headerDiffKeys).toEqual(["server"]);
  });

  it("null html hashes are never 'equal'", () => {
    const m = compareResponses(
      snap({ htmlHash: null }),
      snap({ htmlHash: null })
    );
    expect(m.htmlHashEqual).toBe(false);
  });
});

describe("textSimilarity", () => {
  it("empty/empty → 1, one empty → 0", () => {
    expect(textSimilarity(null, null)).toBe(1);
    expect(textSimilarity("hello world foo", null)).toBe(0);
    expect(textSimilarity("", "")).toBe(1);
  });

  it("identical text → 1, disjoint → 0", () => {
    expect(textSimilarity("buy cheap shoes now", "buy cheap shoes now")).toBe(1);
    expect(textSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });

  it("partial overlap is between 0 and 1", () => {
    const s = textSimilarity(
      "buy cheap running shoes with free shipping",
      "buy cheap running boots with free returns"
    );
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("normalizeUrl", () => {
  it("lowercases host and drops trailing slash", () => {
    expect(normalizeUrl("https://EXAMPLE.com/offer/")).toBe(
      "https://example.com/offer"
    );
  });
  it("null → null", () => {
    expect(normalizeUrl(null)).toBeNull();
  });
});

describe("scoreDifferential — weighted 0-100", () => {
  it("zero metrics → 0", () => {
    expect(scoreDifferential(zeroMetrics())).toBe(0);
  });

  it("maximal differential → 100", () => {
    const m: DifferentialMetrics = {
      statusDiff: true, // 20
      finalUrlDiff: true, // 20
      redirectChainDiff: true, // 10
      headerDiffCount: 9, // capped 5*3 = 15
      headerDiffKeys: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      htmlHashEqual: false, // 15
      textSimilarity: 0,
      contentDiffPct: 100, // 20
    };
    expect(scoreDifferential(m)).toBe(100);
  });

  it("content-only difference scores proportionally", () => {
    const m: DifferentialMetrics = {
      ...zeroMetrics(),
      htmlHashEqual: false, // 15
      textSimilarity: 0.5,
      contentDiffPct: 50, // 10
    };
    expect(scoreDifferential(m)).toBe(25);
  });
});
