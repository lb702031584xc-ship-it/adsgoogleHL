/**
 * Traffic Intelligence API client tests (Phase 2).
 * fetch is stubbed; session headers are mocked; redirect is never hit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/session", () => ({
  sessionHeaders: async () => ({ Cookie: "alk_session=test" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  TrafficIntelApiError,
  getAuditReport,
  getEventChain,
  getProvenance,
} from "@/lib/api/traffic-intel";
import {
  getAuditReportExportUrl,
  getProvenanceExportUrl,
} from "@/lib/api/traffic-export";
import type {
  AuditReport,
  ProvenanceReport,
  TrafficEventDto,
} from "@/lib/api/traffic-intel";

const API_BASE = "https://api.example.test";

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = API_BASE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


function callArg(fetchImpl: { mock: { calls: unknown[][] } }, index: number): unknown {
  return fetchImpl.mock.calls[0]?.[index];
}

function sampleEvent(overrides: Partial<TrafficEventDto> = {}): TrafficEventDto {
  return {
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
    ...overrides,
  };
}

function sampleProvenance(): ProvenanceReport {
  return {
    conversionId: "conv-1",
    chain: [
      sampleEvent(),
      sampleEvent({
        id: "evt-2",
        parentEventId: "evt-1",
        eventType: "CONVERSION",
        conversionId: "conv-1",
      }),
    ],
    summary: {
      trafficSource: "google",
      trafficMedium: "cpc",
      campaign: { id: "camp-1", name: "Brand Search" },
      adGroup: { id: "ag-1", name: "Exact" },
      ad: { id: "ad-1", name: "Ad 1" },
      keyword: "buy widget",
      clickId: "click-1",
      landingPage: { id: "lp-1", name: "LP", url: "https://landing.example.com/" },
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
      { rule: "PPC_FORBIDDEN", matchedText: "No PPC allowed", confidence: 0.95 },
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
    policyEvidence: [
      { rule: "PPC_FORBIDDEN", matchedText: "No PPC allowed", confidence: 0.95 },
    ],
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

describe("getEventChain", () => {
  it("GETs /api/v1/traffic/events with the clickId and returns items", async () => {
    const events = [sampleEvent()];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: events, total: 1, page: 1, pageSize: 50 })
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await getEventChain("click-1");

    expect(result).toEqual(events);
    const [url, init] = (fetchImpl.mock.calls[0] ?? []) as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `${API_BASE}/api/v1/traffic/events?clickId=click-1`
    );
    expect((init.headers as Record<string, string>).Cookie).toBe(
      "alk_session=test"
    );
  });

  it("defaults to [] when the backend omits events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    expect(await getEventChain("click-1")).toEqual([]);
  });

  it("throws TrafficIntelApiError with the backend message on 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ message: "click not found" }, 404)
      )
    );
    const err = await getEventChain("nope").catch((e) => e);
    expect(err).toBeInstanceOf(TrafficIntelApiError);
    expect((err as TrafficIntelApiError).status).toBe(404);
    expect((err as Error).message).toBe("click not found");
  });

  it("throws TrafficIntelApiError(0) on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      })
    );
    const err = await getEventChain("click-1").catch((e) => e);
    expect(err).toBeInstanceOf(TrafficIntelApiError);
    expect((err as TrafficIntelApiError).status).toBe(0);
  });
});

describe("getProvenance", () => {
  it("GETs the conversion provenance endpoint and returns the report", async () => {
    const report = sampleProvenance();
    const fetchImpl = vi.fn(async () => jsonResponse(report));
    vi.stubGlobal("fetch", fetchImpl);

    const result = await getProvenance("conv-1");

    expect(result).toEqual(report);
    expect(callArg(fetchImpl, 0)).toBe(
      `${API_BASE}/api/v1/traffic/provenance/conv-1`
    );
    expect(result.summary.trafficSource).toBe("google");
    expect(result.chain).toHaveLength(2);
    expect(result.policyEvidence[0].confidence).toBe(0.95);
  });

  it("URL-encodes the conversion id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(sampleProvenance()));
    vi.stubGlobal("fetch", fetchImpl);
    await getProvenance("conv/1");
    expect(callArg(fetchImpl, 0)).toContain("conv%2F1");
  });
});

describe("getAuditReport", () => {
  it("passes merchantId/offerId/from/to as query params", async () => {
    const report = sampleAudit();
    const fetchImpl = vi.fn(async () => jsonResponse(report));
    vi.stubGlobal("fetch", fetchImpl);

    const result = await getAuditReport({
      merchantId: "m-1",
      offerId: "offer-1",
      from: "2026-09-01",
      to: "2026-10-01",
    });

    expect(result).toEqual(report);
    const url = String(callArg(fetchImpl, 0));
    expect(url).toContain("/api/v1/traffic/audit-report?");
    expect(url).toContain("merchantId=m-1");
    expect(url).toContain("offerId=offer-1");
    expect(url).toContain("from=2026-09-01");
    expect(url).toContain("to=2026-10-01");
  });

  it("omits empty params entirely", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(sampleAudit()));
    vi.stubGlobal("fetch", fetchImpl);
    await getAuditReport({});
    expect(callArg(fetchImpl, 0)).toBe(
      `${API_BASE}/api/v1/traffic/audit-report`
    );
  });

  it("returns real totals and attributions unmodified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(sampleAudit())));
    const result = await getAuditReport({});
    expect(result.totals).toEqual({
      clicks: 1000,
      conversions: 25,
      commission: "312.50 USD",
    });
    expect(result.trafficSources).toEqual([{ source: "google", clicks: 800 }]);
    expect(result.attributions[0].gclid).toBe("abc123");
  });
});

describe("export URLs", () => {
  it("builds a provenance CSV export URL with format=csv", () => {
    const url = getProvenanceExportUrl("conv-1", "csv");
    expect(url).toBe(
      `${API_BASE}/api/v1/traffic/provenance/conv-1/export?format=csv`
    );
  });

  it("builds an audit CSV export URL carrying the filters", () => {
    const url = getAuditReportExportUrl(
      { merchantId: "m-1", from: "2026-09-01", to: "2026-10-01" },
      "csv"
    );
    expect(url).toContain("/api/v1/traffic/audit-report/export?");
    expect(url).toContain("merchantId=m-1");
    expect(url).toContain("format=csv");
    expect(url).not.toContain("offerId=");
  });
});
