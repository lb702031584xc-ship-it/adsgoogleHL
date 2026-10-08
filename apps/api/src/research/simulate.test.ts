/**
 * Phase 4 Research Lab — simulate.ts self-checks.
 * Verifies the detect → score → classify pipeline catches differentials in
 * preset HTML pairs (the same path POST /api/v1/research/simulate uses).
 */
import { describe, expect, it } from "vitest";
import { simulateHtmlComparison } from "./simulate.js";

const EN_HTML = `<!DOCTYPE html><html><head><title>Cheap running shoes</title></head>
<body><h1>Buy cheap running shoes</h1>
<p>Free shipping on all orders. Sale ends today.</p>
<a href="/cart">Cart</a><a href="/size-guide">Size guide</a>
<script src="/app.js"></script></body></html>`;

const DE_HTML = `<!DOCTYPE html><html><head><title>Günstige Laufschuhe</title></head>
<body><h1>Günstige Laufschuhe kaufen</h1>
<p>Versandkostenfrei für alle Bestellungen. Angebot endet heute.</p>
<a href="/warenkorb">Warenkorb</a><a href="/groessen">Größenberatung</a>
<script src="/app.js"></script></body></html>`;

const OTHER_HTML = `<!DOCTYPE html><html><head><title>Winner!</title></head>
<body><h1>Congratulations, you are our lucky winner</h1>
<p>Claim your prize now by entering your details.</p>
<a href="/claim">Claim</a></body></html>`;

const DESKTOP_US = {
  name: "desktop-us",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126",
  acceptLanguage: "en-US,en;q=0.9",
};
const DESKTOP_DE = {
  name: "desktop-de",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126",
  acceptLanguage: "de-DE,de;q=0.9",
};

describe("simulateHtmlComparison", () => {
  it("identical HTML → score 0, NORMAL, no cloaking signal", () => {
    const r = simulateHtmlComparison({ htmlA: EN_HTML, htmlB: EN_HTML });
    expect(r.score).toBe(0);
    expect(r.band).toBe("NORMAL");
    expect(r.metrics.htmlHashEqual).toBe(true);
    expect(r.classification.classification).toBe("NORMAL_AB_TEST");
  });

  it("translated HTML (en→de) → detects the differential", () => {
    const r = simulateHtmlComparison({
      htmlA: EN_HTML,
      htmlB: DE_HTML,
      variantA: DESKTOP_US,
      variantB: DESKTOP_DE,
    });
    expect(r.score).toBeGreaterThan(0);
    expect(r.metrics.htmlHashEqual).toBe(false);
    expect(r.band).not.toBe("NORMAL");
    expect(r.classification.classification).toBe("LANGUAGE_VARIATION");
  });

  it("totally different HTML → high score, suspicious band", () => {
    const r = simulateHtmlComparison({
      htmlA: EN_HTML,
      htmlB: OTHER_HTML,
      variantA: DESKTOP_US,
      variantB: { ...DESKTOP_US, name: "desktop-us-b" },
      finalUrlA: "https://example.com/",
      finalUrlB: "https://totally-different.net/",
    });
    expect(r.score).toBeGreaterThan(40);
    expect(["SUSPICIOUS", "HIGH_RISK", "STRONG"]).toContain(r.band);
    expect(r.classification.classification).toBe("SUSPICIOUS_CLOAKING");
    expect(r.classification.disclaimer).toContain("差异≠恶意");
  });

  it("honours finalUrl / status overrides", () => {
    const r = simulateHtmlComparison({
      htmlA: EN_HTML,
      htmlB: EN_HTML,
      finalUrlA: "https://example.com/",
      finalUrlB: "https://example.de/",
      variantA: DESKTOP_US,
      variantB: DESKTOP_DE,
    });
    // Same bytes, different country domains → redirect/geo-flavoured signal.
    expect(r.metrics.finalUrlDiff).toBe(true);
    expect(r.metrics.htmlHashEqual).toBe(true);
    expect(r.classification.classification).toBe("GEO_PERSONALIZATION");
  });

  it("snapshots carry hashes, excerpts and tag counts", () => {
    const r = simulateHtmlComparison({ htmlA: EN_HTML, htmlB: EN_HTML });
    expect(r.snapshots.a.htmlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.snapshots.a.linksCount).toBe(2);
    expect(r.snapshots.a.scriptsCount).toBe(1);
    expect(r.snapshots.a.textExcerpt).toContain("running shoes");
  });
});
