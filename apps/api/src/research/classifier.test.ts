/**
 * Phase 4 Research Lab — classifier unit tests.
 * One case per classifier (§22), plus the 差异≠恶意 disclaimer invariant.
 */
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATIONS,
  DIFFERENCE_DISCLAIMER,
  classifyDifferential,
  deriveAxes,
  type ClassifiedResponse,
} from "./classifier.js";
import { compareResponses } from "./detector.js";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function resp(over: Partial<ClassifiedResponse> = {}): ClassifiedResponse {
  return {
    variantName: "desktop-us",
    httpStatus: 200,
    finalUrl: "https://example.com/offer",
    redirectChain: [],
    headers: { "content-type": "text/html" },
    htmlHash: "hash-a",
    contentHash: "content-a",
    textExcerpt: "buy cheap running shoes with free shipping",
    linksCount: 20,
    scriptsCount: 5,
    name: "desktop-us",
    userAgent: DESKTOP_UA,
    acceptLanguage: "en-US,en;q=0.9",
    ...over,
  };
}

function classify(a: ClassifiedResponse, b: ClassifiedResponse) {
  return classifyDifferential(a, b, compareResponses(a, b));
}

describe("deriveAxes", () => {
  it("parses device/language/country from UA + accept-language", () => {
    expect(
      deriveAxes({
        name: "desktop-de",
        userAgent: DESKTOP_UA,
        acceptLanguage: "de-DE,de;q=0.9",
      })
    ).toEqual({ device: "desktop", language: "de", country: "DE" });
    expect(
      deriveAxes({
        name: "mobile-us",
        userAgent: MOBILE_UA,
        acceptLanguage: "en-US,en;q=0.9",
      })
    ).toEqual({ device: "mobile", language: "en", country: "US" });
  });

  it("falls back to the -xx name suffix", () => {
    expect(deriveAxes({ name: "probe-de" })).toMatchObject({
      language: "de",
      country: "DE",
    });
  });
});

describe("the eight classifiers", () => {
  it("GEO_PERSONALIZATION — same brand, different country domain", () => {
    const a = resp({ name: "desktop-us" });
    const b = resp({
      name: "desktop-de",
      variantName: "desktop-de",
      acceptLanguage: "de-DE,de;q=0.9",
      finalUrl: "https://example.de/angebot",
      htmlHash: "hash-b",
      textExcerpt: "kaufen laufschuhe versandkostenfrei angebot",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("GEO_PERSONALIZATION");
  });

  it("GEO_PERSONALIZATION — geo-blocking (2xx vs 4xx across countries)", () => {
    const a = resp({ name: "desktop-us" });
    const b = resp({
      name: "desktop-de",
      variantName: "desktop-de",
      acceptLanguage: "de-DE,de;q=0.9",
      httpStatus: 403,
      htmlHash: "hash-b",
      textExcerpt: "access denied forbidden",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("GEO_PERSONALIZATION");
  });

  it("LANGUAGE_VARIATION — translated wording, same structure", () => {
    const a = resp({
      textExcerpt: "buy cheap running shoes free shipping sale now today",
    });
    const b = resp({
      name: "desktop-de",
      variantName: "desktop-de",
      acceptLanguage: "de-DE,de;q=0.9",
      htmlHash: "hash-b",
      textExcerpt: "kaufen billige laufschuhe versandkostenfrei angebot jetzt heute",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("LANGUAGE_VARIATION");
  });

  it("DEVICE_VARIATION — only the device differs", () => {
    const a = resp({
      textExcerpt: "buy cheap running shoes free shipping desktop version sale",
      linksCount: 20,
    });
    const b = resp({
      name: "mobile-us",
      variantName: "mobile-us",
      userAgent: MOBILE_UA,
      htmlHash: "hash-b",
      textExcerpt: "buy cheap shoes free shipping mobile sale",
      linksCount: 8,
    });
    const r = classify(a, b);
    expect(r.classification).toBe("DEVICE_VARIATION");
  });

  it("COOKIE_PERSONALIZATION — only set-cookie headers differ", () => {
    const a = resp({
      name: "v1",
      variantName: "v1",
      headers: { "content-type": "text/html", "set-cookie-count": "0" },
    });
    const b = resp({
      name: "v2",
      variantName: "v2",
      headers: { "content-type": "text/html", "set-cookie-count": "3" },
      htmlHash: "hash-a", // identical bytes
    });
    const r = classify(a, b);
    expect(r.classification).toBe("COOKIE_PERSONALIZATION");
  });

  it("NORMAL_AB_TEST — minor wording tweak", () => {
    const a = resp({
      name: "v1",
      variantName: "v1",
      textExcerpt: "buy cheap running shoes with free shipping and returns",
    });
    const b = resp({
      name: "v2",
      variantName: "v2",
      htmlHash: "hash-b",
      textExcerpt: "buy cheap running shoes with free shipping and exchanges",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("NORMAL_AB_TEST");
  });

  it("NORMAL_AB_TEST — byte-identical responses", () => {
    const a = resp({ name: "v1", variantName: "v1" });
    const b = resp({ name: "v2", variantName: "v2" });
    const r = classify(a, b);
    expect(r.classification).toBe("NORMAL_AB_TEST");
    expect(r.confidence).toBeLessThan(0.1);
  });

  it("REDIRECT_VARIATION — chain differs, bytes identical", () => {
    const a = resp({ name: "v1", variantName: "v1" });
    const b = resp({
      name: "v2",
      variantName: "v2",
      redirectChain: [{ url: "https://t.co/x", status: 301 }],
      // htmlHash identical on purpose
    });
    const r = classify(a, b);
    expect(r.classification).toBe("REDIRECT_VARIATION");
  });

  it("CONTENT_VARIATION — substantial but unexplainable difference", () => {
    const a = resp({
      name: "v1",
      variantName: "v1",
      textExcerpt:
        "buy cheap running shoes free shipping sale discount offer today store",
    });
    const b = resp({
      name: "v2",
      variantName: "v2",
      htmlHash: "hash-b",
      textExcerpt:
        "buy cheap hiking boots free shipping sale discount deal today shop",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("CONTENT_VARIATION");
  });

  it("SUSPICIOUS_CLOAKING — unrelated redirect domains", () => {
    const a = resp({ name: "v1", variantName: "v1" });
    const b = resp({
      name: "v2",
      variantName: "v2",
      finalUrl: "https://totally-different.net/",
      htmlHash: "hash-b",
      textExcerpt: "congratulations winner claim prize now",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("SUSPICIOUS_CLOAKING");
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("SUSPICIOUS_CLOAKING — 2xx vs error with no axis explanation", () => {
    const a = resp({ name: "v1", variantName: "v1" });
    const b = resp({
      name: "v2",
      variantName: "v2",
      httpStatus: 500,
      htmlHash: "hash-b",
      textExcerpt: "internal server error",
    });
    const r = classify(a, b);
    expect(r.classification).toBe("SUSPICIOUS_CLOAKING");
  });
});

describe("classifier contract", () => {
  it("exposes exactly the 8 documented labels", () => {
    expect(CLASSIFICATIONS).toHaveLength(8);
    expect(new Set(CLASSIFICATIONS).size).toBe(8);
  });

  it("every result carries the 差异≠恶意 disclaimer", () => {
    const r = classify(resp({ name: "v1", variantName: "v1" }), resp({ name: "v2", variantName: "v2" }));
    expect(r.disclaimer).toBe(DIFFERENCE_DISCLAIMER);
    expect(r.reasons[r.reasons.length - 1]).toBe(DIFFERENCE_DISCLAIMER);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("confidence is always within 0-1", () => {
    const pairs: Array<[ClassifiedResponse, ClassifiedResponse]> = [
      [resp({ name: "v1", variantName: "v1" }), resp({ name: "v2", variantName: "v2" })],
      [
        resp({ name: "desktop-us" }),
        resp({
          name: "desktop-de",
          variantName: "desktop-de",
          acceptLanguage: "de-DE,de;q=0.9",
          finalUrl: "https://example.de/",
          htmlHash: "z",
          textExcerpt: "völlig anderer inhalt hier",
        }),
      ],
    ];
    for (const [a, b] of pairs) {
      const r = classify(a, b);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});
