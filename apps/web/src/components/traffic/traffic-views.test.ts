/**
 * Traffic Intelligence view components (Phase 2): pure components render
 * straight from API-shaped data; every figure on screen matches the input.
 * Renders use the English dictionary (useDict falls back when no provider).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EventTimeline,
  PolicyEvidenceList,
  ProvenanceSummary,
  eventTypeBadgeClass,
} from "@/components/traffic/provenance-view";
import {
  AttributionsTable,
  AuditContext,
  AuditTotals,
  TrafficSourcesTable,
} from "@/components/traffic/audit-report-view";
import type {
  AuditReport,
  ProvenanceReport,
} from "@/lib/api/traffic-intel";

function sampleProvenance(): ProvenanceReport {
  return {
    conversionId: "conv-1",
    chain: [
      {
        id: "evt-1",
        parentEventId: null,
        eventType: "AD_CLICK",
        clickId: "click-1",
        conversionId: null,
        trackingLinkId: "tl-1",
        timestamp: "2026-10-05T06:00:00.000Z",
        source: "https://www.google.com/search",
        destination: "https://landing.example.com/",
        metadata: { gclid: "abc123" },
        dataQuality: "OBSERVED",
      },
      {
        id: "evt-2",
        parentEventId: "evt-1",
        eventType: "CONVERSION",
        clickId: "click-1",
        conversionId: "conv-1",
        trackingLinkId: null,
        timestamp: "2026-10-05T07:00:00.000Z",
        source: null,
        destination: null,
        metadata: {},
        dataQuality: "OBSERVED",
      },
    ],
    summary: {
      trafficSource: "google",
      trafficMedium: "cpc",
      campaign: { id: "camp-1", name: "Brand Search" },
      adGroup: { id: "ag-1", name: "Exact" },
      ad: { id: "ad-1", name: "Ad 1" },
      keyword: "buy widget",
      clickId: "click-1",
      landingPage: {
        id: "lp-1",
        name: "LP",
        url: "https://landing.example.com/",
      },
      trackingLink: { id: "tl-1", publicId: "trk-abc" },
      offer: { id: "offer-1", name: "Widget Offer" },
      merchant: { id: "m-1", name: "Acme" },
      conversion: {
        id: "conv-1",
        action: "purchase",
        time: "2026-10-05T07:00:00.000Z",
        value: "49.99",
        currency: "USD",
        status: "CONFIRMED",
      },
      commission: { value: "12.50", currency: "USD" },
    },
    policyEvidence: [
      {
        rule: "PPC_FORBIDDEN",
        matchedText: "No PPC allowed on brand terms",
        confidence: 0.95,
      },
    ],
    generatedAt: "2026-10-05T08:00:00.000Z",
  };
}

function sampleAudit(): AuditReport {
  return {
    merchant: { id: "m-1", name: "Acme" },
    offer: { id: "offer-1", name: "Widget Offer" },
    period: { from: "2026-09-01", to: "2026-10-01" },
    totals: { clicks: 1000, conversions: 25, commission: "312.50 USD" },
    trafficSources: [{ source: "google", clicks: 800 }],
    policyEvidence: [],
    attributions: [
      {
        conversionId: "conv-1",
        clickId: "click-1",
        timestamp: "2026-10-05T07:00:00.000Z",
        trackingLinkPublicId: "trk-abc",
        trafficSource: "google",
        gclid: "abc123",
        value: "49.99",
        currency: "USD",
      },
    ],
    generatedAt: "2026-10-05T08:00:00.000Z",
  };
}

describe("eventTypeBadgeClass", () => {
  it("covers all six event types", () => {
    const types = [
      "AD_CLICK",
      "LANDING_PAGE_VIEW",
      "AFFILIATE_CLICK",
      "MERCHANT_VISIT",
      "CONVERSION",
      "COMMISSION",
    ] as const;
    for (const t of types) {
      expect(eventTypeBadgeClass(t)).toMatch(/bg-\w+-100/);
    }
  });
});

describe("ProvenanceSummary", () => {
  it("renders the full chain overview from the report", () => {
    const html = renderToStaticMarkup(
      createElement(ProvenanceSummary, { report: sampleProvenance() })
    );
    // Field labels (English fallback dictionary)
    expect(html).toContain("Traffic source");
    expect(html).toContain("Campaign");
    expect(html).toContain("Commission");
    // Real values, verbatim
    expect(html).toContain("google");
    expect(html).toContain("Brand Search");
    expect(html).toContain("buy widget");
    expect(html).toContain("trk-abc");
    expect(html).toContain("Widget Offer");
    expect(html).toContain("Acme");
    expect(html).toContain("purchase");
    expect(html).toContain("49.99");
    expect(html).toContain("12.50 USD");
    expect(html).toContain("https://landing.example.com/");
  });
});

describe("EventTimeline", () => {
  it("renders every event in order with type badge, flow, and raw metadata", () => {
    const html = renderToStaticMarkup(
      createElement(EventTimeline, { events: sampleProvenance().chain })
    );
    expect(html).toContain("Ad click");
    expect(html).toContain("Conversion");
    // Flow source → destination
    expect(html).toContain("https://www.google.com/search");
    expect(html).toContain("https://landing.example.com/");
    // Raw metadata folded in <details>
    expect(html).toContain("Raw data");
    expect(html).toContain("abc123");
    // Every event carries the observed (实测) badge
    expect(html.match(/Observed/g)?.length).toBe(2);
  });

  it("renders the empty state when there are no events", () => {
    const html = renderToStaticMarkup(createElement(EventTimeline, {
      events: [],
    }));
    expect(html).toContain("No event chain");
  });
});

describe("PolicyEvidenceList", () => {
  it("renders rule, verbatim matched text, and confidence", () => {
    const html = renderToStaticMarkup(
      createElement(PolicyEvidenceList, {
        evidence: sampleProvenance().policyEvidence,
      })
    );
    expect(html).toContain("PPC_FORBIDDEN");
    expect(html).toContain("No PPC allowed on brand terms");
    expect(html).toContain("0.95");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(PolicyEvidenceList, { evidence: [] })
    );
    expect(html).toContain("No policy evidence");
  });
});

describe("AuditTotals", () => {
  it("renders clicks/conversions/commission verbatim with observed badges", () => {
    const html = renderToStaticMarkup(
      createElement(AuditTotals, { report: sampleAudit() })
    );
    expect(html).toContain("Clicks");
    expect(html).toContain("Conversions");
    expect(html).toContain("1000");
    expect(html).toContain("25");
    expect(html).toContain("312.50 USD");
    expect(html.match(/Observed/g)?.length).toBe(3);
  });
});

describe("TrafficSourcesTable", () => {
  it("renders the real source breakdown", () => {
    const html = renderToStaticMarkup(
      createElement(TrafficSourcesTable, { report: sampleAudit() })
    );
    expect(html).toContain("google");
    expect(html).toContain("800");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(TrafficSourcesTable, {
        report: { ...sampleAudit(), trafficSources: [] },
      })
    );
    expect(html).toContain("No data");
  });
});

describe("AttributionsTable", () => {
  it("renders attribution rows verbatim", () => {
    const html = renderToStaticMarkup(
      createElement(AttributionsTable, { report: sampleAudit() })
    );
    expect(html).toContain("conv-1");
    expect(html).toContain("click-1");
    expect(html).toContain("trk-abc");
    expect(html).toContain("google");
    expect(html).toContain("abc123");
    expect(html).toContain("49.99 USD");
  });
});

describe("AuditContext", () => {
  it("renders merchant, offer, and period scope", () => {
    const html = renderToStaticMarkup(
      createElement(AuditContext, { report: sampleAudit() })
    );
    expect(html).toContain("Acme");
    expect(html).toContain("Widget Offer");
    expect(html).toContain("2026-09-01");
    expect(html).toContain("2026-10-01");
  });
});
