import { describe, expect, it } from "vitest";
import { mostCommon, pct } from "./offer-performance.js";

describe("offer-performance math", () => {
  it("pct computes 2dp percentages, null on zero denominator", () => {
    expect(pct(5, 100)).toBe(5);
    expect(pct(1, 3)).toBe(33.33);
    expect(pct(0, 100)).toBe(0);
    expect(pct(5, 0)).toBe(null);
    expect(pct(5, -1)).toBe(null);
  });

  it("mostCommon returns the dominant value, null when empty", () => {
    expect(mostCommon(["USD", "EUR", "USD"])).toBe("USD");
    expect(mostCommon([])).toBe(null);
    expect(mostCommon(["EUR"])).toBe("EUR");
  });
});
