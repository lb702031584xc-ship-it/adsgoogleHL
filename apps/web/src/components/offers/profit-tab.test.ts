/**
 * validateSimulateInput: what-if form validation rules.
 */
import { describe, expect, it } from "vitest";
import { validateSimulateInput } from "@/components/offers/profit-tab";

describe("validateSimulateInput", () => {
  it("accepts valid CPC + CVR without clicks", () => {
    const r = validateSimulateInput("0.80", "2.5", "");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toEqual({ cpc: 0.8, cvr: 2.5 });
    }
  });

  it("accepts valid clicks when provided", () => {
    const r = validateSimulateInput("0.80", "2.5", "1000");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toEqual({ cpc: 0.8, cvr: 2.5, clicks: 1000 });
    }
  });

  it("rejects non-positive or non-numeric CPC", () => {
    for (const bad of ["", "0", "-1", "abc"]) {
      const r = validateSimulateInput(bad, "2.5", "");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.cpc).toBe("cpc");
    }
  });

  it("rejects CVR outside 0–100", () => {
    for (const bad of ["", "-0.5", "101", "abc"]) {
      const r = validateSimulateInput("0.80", bad, "");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.cvr).toBe("cvr");
    }
  });

  it("accepts boundary CVR values 0 and 100", () => {
    expect(validateSimulateInput("0.80", "0", "").ok).toBe(true);
    expect(validateSimulateInput("0.80", "100", "").ok).toBe(true);
  });

  it("rejects non-integer or non-positive clicks", () => {
    for (const bad of ["0", "-5", "1.5", "abc"]) {
      const r = validateSimulateInput("0.80", "2.5", bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.clicks).toBe("clicks");
    }
  });

  it("collects multiple field errors at once", () => {
    const r = validateSimulateInput("abc", "200", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["clicks", "cpc", "cvr"]);
    }
  });
});
