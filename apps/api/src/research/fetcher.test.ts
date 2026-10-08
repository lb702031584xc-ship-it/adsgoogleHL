/**
 * Phase 4 Research Lab — fetcher unit tests.
 * No real network: failures (unresolvable host, blocked private IP) must be
 * recorded in meta.error, never thrown.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VARIANTS,
  fetchAllVariants,
  fetchVariant,
} from "./fetcher.js";

const VARIANT = {
  name: "desktop-us",
  userAgent: "test-agent",
  acceptLanguage: "en-US,en;q=0.9",
};

describe("DEFAULT_VARIANTS", () => {
  it("ships desktop-us, mobile-us and desktop-de", () => {
    expect(DEFAULT_VARIANTS.map((v) => v.name)).toEqual([
      "desktop-us",
      "mobile-us",
      "desktop-de",
    ]);
  });
});

describe("fetchVariant failure handling", () => {
  it("unresolvable host records error instead of throwing", async () => {
    const r = await fetchVariant("https://nonexistent.invalid/", VARIANT);
    expect(r.httpStatus).toBeNull();
    expect(r.variantName).toBe("desktop-us");
    expect(typeof r.meta.error).toBe("string");
    expect((r.meta.error as string).length).toBeGreaterThan(0);
  });

  it("private IP target is blocked by the SSRF guard (recorded, not thrown)", async () => {
    const r = await fetchVariant("http://127.0.0.1/", VARIANT);
    expect(r.httpStatus).toBeNull();
    expect(typeof r.meta.error).toBe("string");
  });

  it("non-http(s) scheme is rejected as a recorded error", async () => {
    const r = await fetchVariant("ftp://example.com/", VARIANT);
    expect(r.httpStatus).toBeNull();
    expect(r.meta.error).toContain("http(s)");
  });

  it("invalid URL is recorded, not thrown", async () => {
    const r = await fetchVariant("not a url", VARIANT);
    expect(r.httpStatus).toBeNull();
    expect(typeof r.meta.error).toBe("string");
  });
});

describe("fetchAllVariants", () => {
  it("returns one result per variant, in order", async () => {
    const results = await fetchAllVariants("https://nonexistent.invalid/", [
      { ...VARIANT, name: "a" },
      { ...VARIANT, name: "b" },
    ]);
    expect(results.map((r) => r.variantName)).toEqual(["a", "b"]);
    for (const r of results) {
      expect(r.fetchedAt).toBeInstanceOf(Date);
      expect(typeof r.meta.error).toBe("string");
    }
  });
});
