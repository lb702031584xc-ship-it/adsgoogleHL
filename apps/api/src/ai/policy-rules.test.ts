/**
 * Phase 1 — deterministic Critical Rules engine unit tests.
 * One case per FORBIDDEN combination; UNKNOWN never kills a deal.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateCriticalRules,
  type RuleVerdict,
} from "./policy-rules.js";

const ALL_ALLOWED: Record<string, RuleVerdict> = {
  PPC: "ALLOWED",
  DIRECT_LINK: "ALLOWED",
  BRAND_BIDDING: "ALLOWED",
  NON_BRAND_KEYWORDS: "ALLOWED",
  SEARCH_ADS: "ALLOWED",
  DISPLAY: "ALLOWED",
  SOCIAL: "ALLOWED",
  GEO: "ALLOWED",
  LANDING_PAGE: "ALLOWED",
};

const ALL_UNKNOWN: Record<string, RuleVerdict> = {
  PPC: "UNKNOWN",
  DIRECT_LINK: "UNKNOWN",
  BRAND_BIDDING: "UNKNOWN",
  NON_BRAND_KEYWORDS: "UNKNOWN",
  SEARCH_ADS: "UNKNOWN",
  DISPLAY: "UNKNOWN",
  SOCIAL: "UNKNOWN",
  GEO: "UNKNOWN",
  LANDING_PAGE: "UNKNOWN",
};

describe("evaluateCriticalRules", () => {
  it("PPC=FORBIDDEN → DO_NOT_RUN", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, PPC: "FORBIDDEN" },
      { trafficMode: "LANDING_PAGE", geo: ["US"] }
    );
    expect(r.decision).toBe("DO_NOT_RUN");
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].rule).toBe("PPC");
  });

  it("DIRECT_LINK mode + DIRECT_LINK=FORBIDDEN → DO_NOT_RUN", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, DIRECT_LINK: "FORBIDDEN" },
      { trafficMode: "DIRECT_LINK", geo: [] }
    );
    expect(r.decision).toBe("DO_NOT_RUN");
    expect(r.hits[0].rule).toBe("DIRECT_LINK");
  });

  it("LANDING_PAGE mode + DIRECT_LINK=FORBIDDEN → PROCEED", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, DIRECT_LINK: "FORBIDDEN" },
      { trafficMode: "LANDING_PAGE", geo: [] }
    );
    expect(r.decision).toBe("PROCEED");
    expect(r.hits).toHaveLength(0);
  });

  it("GEO=FORBIDDEN + target geo in forbidden list → DO_NOT_RUN", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, GEO: "FORBIDDEN" },
      { trafficMode: "LANDING_PAGE", geo: ["US", "CN"], forbiddenGeo: ["CN", "RU"] }
    );
    expect(r.decision).toBe("DO_NOT_RUN");
    expect(r.hits[0].rule).toBe("GEO");
    expect(r.hits[0].reason).toContain("CN");
  });

  it("GEO=FORBIDDEN + target geo not forbidden → PROCEED", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, GEO: "FORBIDDEN" },
      { trafficMode: "LANDING_PAGE", geo: ["US"], forbiddenGeo: ["CN"] }
    );
    expect(r.decision).toBe("PROCEED");
  });

  it("GEO=FORBIDDEN with no target geo declared → PROCEED (no declared target to block)", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, GEO: "FORBIDDEN" },
      { trafficMode: "LANDING_PAGE", geo: [], forbiddenGeo: ["CN"] }
    );
    expect(r.decision).toBe("PROCEED");
  });

  it("geo matching is case-insensitive", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, GEO: "FORBIDDEN" },
      { trafficMode: "LANDING_PAGE", geo: ["cn"], forbiddenGeo: ["CN"] }
    );
    expect(r.decision).toBe("DO_NOT_RUN");
  });

  it("multiple FORBIDDEN rules → one hit per rule", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, PPC: "FORBIDDEN", DIRECT_LINK: "FORBIDDEN" },
      { trafficMode: "DIRECT_LINK", geo: [] }
    );
    expect(r.decision).toBe("DO_NOT_RUN");
    expect(r.hits.map((h) => h.rule).sort()).toEqual(["DIRECT_LINK", "PPC"]);
  });

  it("all UNKNOWN → PROCEED (UNKNOWN never kills)", () => {
    const r = evaluateCriticalRules(ALL_UNKNOWN, {
      trafficMode: "DIRECT_LINK",
      geo: ["US"],
      forbiddenGeo: ["US"],
    });
    expect(r.decision).toBe("PROCEED");
    expect(r.hits).toHaveLength(0);
  });

  it("all ALLOWED → PROCEED", () => {
    const r = evaluateCriticalRules(ALL_ALLOWED, {
      trafficMode: "DIRECT_LINK",
      geo: ["US"],
    });
    expect(r.decision).toBe("PROCEED");
    expect(r.hits).toHaveLength(0);
  });

  it("ignores unknown rule names in the record", () => {
    const r = evaluateCriticalRules(
      { ...ALL_ALLOWED, EMAIL: "FORBIDDEN" } as Record<string, RuleVerdict>,
      { trafficMode: "LANDING_PAGE", geo: [] }
    );
    expect(r.decision).toBe("PROCEED");
  });
});
