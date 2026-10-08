import { describe, expect, it } from "vitest";
import {
  createSeededMemoryRepositories,
  TenantA,
} from "@adlinklab/database";
import { MockGoogleAdsProvider } from "@adlinklab/google-ads";
import { TrackingLinkResolver } from "@adlinklab/tracking";
import { ClickIngestionService } from "./click-ingestion.js";
import { AuditService, OrderConversionService } from "./index.js";
import {
  InMemoryTrafficEventStore,
  TrafficEventService,
  type TrafficEventStore,
} from "./traffic-events.js";

/**
 * Phase 2 Traffic Intelligence — event journal tests.
 *
 * Chain under test: AD_CLICK → LANDING_PAGE_VIEW → AFFILIATE_CLICK
 *                   → MERCHANT_VISIT → CONVERSION → COMMISSION
 * Iron rule: journal writes never change existing Click/Conversion behavior
 * or return values; failures are logged, never thrown.
 */

function createHarness(store?: TrafficEventStore) {
  const repos = createSeededMemoryRepositories();
  const eventStore = store ?? new InMemoryTrafficEventStore();
  const trafficEvents = new TrafficEventService(eventStore);
  const resolver = new TrackingLinkResolver(
    repos.trackingLinks,
    repos.offers,
    repos.landingPages
  );
  const ingestion = new ClickIngestionService(
    resolver,
    repos.clicks,
    repos.unitOfWork,
    trafficEvents,
    repos.adGroupCriteria
  );
  const audit = new AuditService(repos.auditLogs);
  const conversions = new OrderConversionService(
    repos.orders,
    repos.conversions,
    repos.clicks,
    repos.googleAccounts,
    new MockGoogleAdsProvider(),
    repos.unitOfWork,
    audit,
    repos.syncJobs,
    undefined,
    trafficEvents
  );
  return { repos, eventStore, trafficEvents, ingestion, conversions };
}

describe("Phase 2 Traffic Intelligence — event journal", () => {
  it("1. full chain: redirect → merchant visit → conversion with value yields 6 ordered events", async () => {
    const { ingestion, conversions, trafficEvents } = createHarness();

    const result = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      requestUrl: "https://adtlab.xyz/t/trk_demo_001?gclid=abc123",
      requestMetadata: {
        referer: "https://www.google.com/",
        queryParameters: {
          gclid: "abc123",
          utm_source: "google",
          utm_medium: "cpc",
        },
      },
    });
    expect(result.replayed).toBe(false);

    // Click carries only real observed attribution — never invented.
    expect(result.click.trafficSource).toBe("google");
    expect(result.click.trafficMedium).toBe("cpc");
    expect(result.click.matchType).toBe("PHRASE"); // TenantA.critA1 fixture

    const merchantVisit = await trafficEvents.emitMerchantVisit({
      tenantId: TenantA.id,
      clickId: result.click.id,
      trackingLinkId: result.trackingLinkId,
      destination: "https://merchant.example/checkout",
    });
    expect(merchantVisit).not.toBeNull();
    expect(merchantVisit!.eventType).toBe("MERCHANT_VISIT");

    const { conversion, created } = await conversions.createConversion({
      tenantId: TenantA.id,
      clickId: result.clickId,
      conversionAction: "purchase",
      value: "49.99",
      currency: "USD",
    });
    expect(created).toBe(true);

    const chain = await trafficEvents.getEventChain(
      TenantA.id,
      result.click.id
    );
    expect(chain.map((e) => e.eventType)).toEqual([
      "AD_CLICK",
      "LANDING_PAGE_VIEW",
      "AFFILIATE_CLICK",
      "MERCHANT_VISIT",
      "CONVERSION",
      "COMMISSION",
    ]);

    // parentEventId chain is linear, root → leaf.
    expect(chain[0].parentEventId).toBeNull();
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].parentEventId).toBe(chain[i - 1].id);
    }

    // Every event is observed data; DTO matches the frozen contract shape.
    for (const event of chain) {
      expect(event.dataQuality).toBe("OBSERVED");
      expect(Object.keys(event).sort()).toEqual(
        [
          "id",
          "parentEventId",
          "eventType",
          "clickId",
          "conversionId",
          "trackingLinkId",
          "timestamp",
          "source",
          "destination",
          "metadata",
          "dataQuality",
        ].sort()
      );
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
      expect(event.clickId).toBe(result.click.id);
      expect(event.trackingLinkId).toBe(result.trackingLinkId);
    }

    // AD_CLICK: real referer + real request URL.
    expect(chain[0].source).toBe("https://www.google.com/");
    expect(chain[0].destination).toBe(
      "https://adtlab.xyz/t/trk_demo_001?gclid=abc123"
    );

    // LANDING_PAGE_VIEW: the "user really passed through the LP" evidence.
    expect(chain[1].destination).toBe("https://example.com/offer-a");

    // AFFILIATE_CLICK: parent is the LP view, destination is the redirect URL.
    expect(chain[2].destination).toBe(result.redirectUrl);

    // CONVERSION: parent is the merchant visit; metadata carries real data.
    const conversionEvent = chain[4];
    expect(conversionEvent.conversionId).toBe(conversion.id);
    expect(conversionEvent.metadata).toMatchObject({
      conversionAction: "purchase",
      value: "49.99",
      currency: "USD",
    });

    // COMMISSION: parent is the conversion; only present because value exists.
    const commissionEvent = chain[5];
    expect(commissionEvent.parentEventId).toBe(conversionEvent.id);
    expect(commissionEvent.metadata).toMatchObject({
      value: "49.99",
      currency: "USD",
    });
  });

  it("2. conversion without value records CONVERSION but no COMMISSION", async () => {
    const { ingestion, conversions, trafficEvents } = createHarness();

    const result = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    const { created } = await conversions.createConversion({
      tenantId: TenantA.id,
      clickId: result.clickId,
      conversionAction: "signup",
    });
    expect(created).toBe(true);

    const chain = await trafficEvents.getEventChain(
      TenantA.id,
      result.click.id
    );
    expect(chain.map((e) => e.eventType)).toEqual([
      "AD_CLICK",
      "LANDING_PAGE_VIEW",
      "AFFILIATE_CLICK",
      "CONVERSION",
    ]);
    // Without a merchant visit, CONVERSION's parent is the latest AFFILIATE_CLICK.
    expect(chain[3].parentEventId).toBe(chain[2].id);
  });

  it("3. replayed clicks do not record duplicate event chains", async () => {
    const { ingestion, trafficEvents } = createHarness();

    const first = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      ingestionId: "phase2-dedupe-1",
    });
    const second = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      ingestionId: "phase2-dedupe-1",
    });
    expect(second.replayed).toBe(true);

    const chain = await trafficEvents.getEventChain(
      TenantA.id,
      first.click.id
    );
    expect(chain.map((e) => e.eventType)).toEqual([
      "AD_CLICK",
      "LANDING_PAGE_VIEW",
      "AFFILIATE_CLICK",
    ]);
  });

  it("4. journal write failures never break click ingestion or conversion creation", async () => {
    const failingStore: TrafficEventStore = {
      create: async () => {
        throw new Error("journal down");
      },
      listByClick: async () => {
        throw new Error("journal down");
      },
    };
    const warnings: string[] = [];
    const trafficEvents = new TrafficEventService(failingStore, {
      warn: (message) => warnings.push(message),
    });

    const repos = createSeededMemoryRepositories();
    const resolver = new TrackingLinkResolver(
      repos.trackingLinks,
      repos.offers,
      repos.landingPages
    );
    const ingestion = new ClickIngestionService(
      resolver,
      repos.clicks,
      repos.unitOfWork,
      trafficEvents,
      repos.adGroupCriteria
    );

    // Click ingestion succeeds with an unchanged result shape.
    const result = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      requestMetadata: { queryParameters: { utm_source: "google" } },
    });
    expect(result.replayed).toBe(false);
    expect(result.click.id).toBeTruthy();
    expect(result.click.trafficSource).toBe("google");
    expect(warnings.length).toBeGreaterThan(0);

    // Conversion creation succeeds too.
    const conversions = new OrderConversionService(
      repos.orders,
      repos.conversions,
      repos.clicks,
      repos.googleAccounts,
      new MockGoogleAdsProvider(),
      repos.unitOfWork,
      new AuditService(repos.auditLogs),
      repos.syncJobs,
      undefined,
      trafficEvents
    );
    const { conversion, created } = await conversions.createConversion({
      tenantId: TenantA.id,
      clickId: result.clickId,
      conversionAction: "purchase",
      value: "10.00",
      currency: "USD",
    });
    expect(created).toBe(true);
    expect(conversion.id).toBeTruthy();
  });

  it("5. missing traffic attribution stays empty — never invented", async () => {
    const { ingestion } = createHarness();

    const result = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
    });
    expect(result.click.trafficSource).toBeUndefined();
    expect(result.click.trafficMedium).toBeUndefined();
    // matchType comes from the real criterion lookup (fixture critA1 = PHRASE).
    expect(result.click.matchType).toBe("PHRASE");
  });

  it("6. createConversionFromOrder records CONVERSION + COMMISSION with the merchant order as source", async () => {
    const { ingestion, conversions, trafficEvents } = createHarness();

    const click = await ingestion.recordClick({
      tenantId: TenantA.id,
      trackingLinkPublicId: "trk_demo_001",
      requestMetadata: { queryParameters: { gclid: "xyz" } },
    });

    const { order } = await conversions.createOrder({
      tenantId: TenantA.id,
      orderId: "merchant-order-123",
      clickId: click.clickId,
      value: "79.50",
      currency: "USD",
    });

    const { conversion, created } = await conversions.createConversionFromOrder({
      tenantId: TenantA.id,
      orderId: order.id,
      conversionAction: "purchase",
    });
    expect(created).toBe(true);

    const chain = await trafficEvents.getEventChain(TenantA.id, click.click.id);
    expect(chain.map((e) => e.eventType)).toEqual([
      "AD_CLICK",
      "LANDING_PAGE_VIEW",
      "AFFILIATE_CLICK",
      "CONVERSION",
      "COMMISSION",
    ]);
    const conversionEvent = chain[3];
    expect(conversionEvent.conversionId).toBe(conversion.id);
    // source is merchant-related: the real merchant business order id.
    expect(conversionEvent.source).toBe("merchant-order-123");
    expect(conversionEvent.metadata).toMatchObject({
      conversionAction: "purchase",
      value: "79.50",
      currency: "USD",
    });
  });
});
