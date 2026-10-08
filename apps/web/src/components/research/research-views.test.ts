/**
 * Research Lab view components: pure components render straight from
 * API-shaped data. Uses the English research dictionary directly
 * (does not depend on the aggregated dictionaries.ts).
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en as dict } from "@/i18n/dict/research";
import {
  BandBadge,
  ClassificationBadge,
  ResearchBanner,
  ResearchListView,
  ScoreBar,
  StatusBadge,
  VariantTable,
  bandLabel,
  presetVariants,
  type ResearchVariantResult,
} from "@/components/research/research-views";
import type {
  ResearchBand,
  ResearchTestStatus,
  ResearchTestSummary,
} from "@/lib/api/research";

function sampleSummary(
  over: Partial<ResearchTestSummary> = {}
): ResearchTestSummary {
  return {
    id: "test-1",
    tenantId: "tenant-1",
    name: "Nike cloaking check",
    targetUrl: "https://example.com/offer",
    status: "COMPLETED",
    variants: [],
    createdBy: null,
    score: 72,
    band: "SUSPICIOUS",
    createdAt: "2026-10-05T09:00:00.000Z",
    updatedAt: "2026-10-05T09:05:00.000Z",
    ...over,
  };
}

function sampleVariant(
  over: Partial<ResearchVariantResult> = {}
): ResearchVariantResult {
  return {
    name: "bot",
    status: "ok",
    httpStatus: 200,
    finalUrl: "https://example.com/offer?x=1",
    redirectCount: 2,
    contentHash: "abcdef0123456789abcdef0123456789",
    ...over,
  };
}

function el<P extends Record<string, unknown>>(
  type: (props: P) => ReactElement | null,
  props: P
): ReactElement {
  return createElement(type, props);
}

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const BANDS: ResearchBand[] = [
  "NORMAL",
  "MINOR",
  "SUSPICIOUS",
  "HIGH_RISK",
  "STRONG",
];
const STATUSES: ResearchTestStatus[] = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
];

describe("research views", () => {
  it("1. banner shows the research-only warning", () => {
    const out = html(el(ResearchBanner, { dict }));
    expect(out).toContain("research only");
    expect(out).toContain("production traffic decisions");
  });

  it("2. band badge renders all five bands with labels", () => {
    for (const b of BANDS) {
      const out = html(el(BandBadge, { band: b, dict }));
      expect(out).toContain(bandLabel(b, dict));
      expect(out).toContain("rounded-full");
    }
    expect(html(el(BandBadge, { band: null, dict }))).toContain("—");
  });

  it("3. score bar shows 0-100 score and five band blocks", () => {
    const out = html(el(ScoreBar, { score: 72, band: "SUSPICIOUS", dict }));
    expect(out).toContain("72");
    expect(out).toContain("/100");
    expect(out).toContain("Suspicious");
    expect(html(el(ScoreBar, { score: null, band: null, dict }))).toContain(
      dict.detail.noScore
    );
  });

  it("4. classification badge labels the 8 classifier values", () => {
    expect(
      html(el(ClassificationBadge, { classification: "SUSPICIOUS_CLOAKING", dict }))
    ).toContain(dict.classification.SUSPICIOUS_CLOAKING);
    expect(
      html(el(ClassificationBadge, { classification: "GEO_PERSONALIZATION", dict }))
    ).toContain(dict.classification.GEO_PERSONALIZATION);
    // unknown values pass through verbatim
    expect(
      html(el(ClassificationBadge, { classification: "SOME_FUTURE_LABEL", dict }))
    ).toContain("SOME_FUTURE_LABEL");
    expect(
      html(el(ClassificationBadge, { classification: null, dict }))
    ).toContain(dict.detail.noClassification);
  });

  it("5. status badge labels every test status", () => {
    for (const s of STATUSES) {
      expect(html(el(StatusBadge, { status: s, dict }))).toContain(
        dict.status[s]
      );
    }
  });

  it("6. variant table shows per-variant status/final URL/redirects/hash", () => {
    const out = html(
      el(VariantTable, {
        variants: [sampleVariant(), sampleVariant({ name: "human" })],
        dict,
      })
    );
    expect(out).toContain("bot");
    expect(out).toContain("human");
    expect(out).toContain("https://example.com/offer?x=1");
    expect(out).toContain("abcdef0123456789");
    expect(html(el(VariantTable, { variants: [], dict }))).toContain(
      dict.detail.noVariants
    );
  });

  it("7. list view renders rows with score and band, empty state otherwise", () => {
    const out = html(
      el(ResearchListView, {
        items: [
          sampleSummary(),
          sampleSummary({ id: "test-2", score: null, band: null }),
        ],
        dict,
      })
    );
    expect(out).toContain("Nike cloaking check");
    expect(out).toContain("https://example.com/offer");
    expect(out).toContain("72");
    expect(out).toContain("Suspicious");
    expect(html(el(ResearchListView, { items: [], dict }))).toContain(
      dict.list.empty
    );
  });

  it("8. list view name cell links to detail when hrefFor is given", () => {
    const out = html(
      el(ResearchListView, {
        items: [sampleSummary()],
        dict,
        hrefFor: (id: string) => `/research/${id}`,
      })
    );
    expect(out).toContain('href="/research/test-1"');
  });

  it("9. presetVariants maps presets to request variants (DEFAULT -> API default)", () => {
    expect(presetVariants("DEFAULT")).toBeUndefined();
    const bot = presetVariants("BOT_VS_HUMAN");
    expect(bot).toHaveLength(2);
    expect(bot?.[0]?.name).toBe("bot");
    expect(bot?.[0]?.userAgent).toContain("Googlebot");
    expect(presetVariants("GEO_VARIANTS")).toHaveLength(4);
    expect(presetVariants("DEVICE_VARIANTS")).toHaveLength(2);
  });
});
