/**
 * Network API framework — Impact adapter unit tests (mock fetch, no network).
 */
import { describe, expect, it, vi } from "vitest";
import {
  IMPACT_DEFAULT_BASE_URL,
  ImpactAdapter,
  mapImpactCampaign,
  NetworkAdapterError,
  parseImpactCredentials,
} from "./impact-adapter.js";
import type { AdapterContext } from "./types.js";

const SID = "IRAbcDeFgHiJ1234567890";
const TOKEN = "secret-auth-token-xyz";

function ctxWith(
  fetchImpl: typeof fetch,
  apiKey = `${SID}:${TOKEN}`
): AdapterContext {
  return {
    apiKey,
    apiBaseUrl: "https://api.impact.test",
    tenantId: "tenant-1",
    fetchImpl,
    ssrfCheck: async () => {},
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function campaign(id: number, overrides: Record<string, unknown> = {}) {
  return {
    CampaignId: id,
    CampaignName: `Campaign ${id}`,
    DefaultPayout: 12.5,
    CampaignDescription: `Description ${id}`,
    ContractTerms: `Terms ${id}`,
    ...overrides,
  };
}

describe("parseImpactCredentials", () => {
  it("splits AccountSID and AuthToken on the first colon", () => {
    const creds = parseImpactCredentials(`${SID}:${TOKEN}`);
    expect(creds.accountSid).toBe(SID);
    expect(creds.authToken).toBe(TOKEN);
  });

  it("rejects credentials without a colon", () => {
    expect(() => parseImpactCredentials("no-colon-here")).toThrowError(
      NetworkAdapterError
    );
  });
});

describe("ImpactAdapter.pullOffers", () => {
  it("sends HTTP Basic Auth with base64(AccountSID:AuthToken)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ Campaigns: [] })
    ) as unknown as typeof fetch;
    const adapter = new ImpactAdapter();
    await adapter.pullOffers(ctxWith(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const expected = `Basic ${Buffer.from(`${SID}:${TOKEN}`, "utf8").toString("base64")}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      expected
    );
  });

  it("hits {baseUrl}/Mediapartners/{AccountSID}/Campaigns with paging params", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ Campaigns: [] })
    ) as unknown as typeof fetch;
    const adapter = new ImpactAdapter();
    await adapter.pullOffers(ctxWith(fetchImpl));

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.impact.test/Mediapartners/${SID}/Campaigns?Page=1&PageSize=100`
    );
  });

  it("maps CampaignName/DefaultPayout/terms to NetworkOffer fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ Campaigns: [campaign(42)] })
    ) as unknown as typeof fetch;
    const offers = await new ImpactAdapter().pullOffers(ctxWith(fetchImpl));

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      externalId: "42",
      name: "Campaign 42",
      payout: 12.5,
      currency: "USD",
    });
    expect(offers[0]!.termsText).toContain("Description 42");
    expect(offers[0]!.termsText).toContain("Terms 42");
    expect(offers[0]!.rawData).toMatchObject({ CampaignId: 42 });
  });

  it("follows @numpages pagination until the last page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => campaign(i + 1));
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("Page=1")) {
        return jsonResponse({
          "@page": "1",
          "@numpages": "2",
          Campaigns: page1,
        });
      }
      return jsonResponse({
        "@page": "2",
        "@numpages": "2",
        Campaigns: [campaign(101), campaign(102)],
      });
    }) as unknown as typeof fetch;

    const offers = await new ImpactAdapter().pullOffers(ctxWith(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(offers).toHaveLength(102);
    expect(offers[0]!.externalId).toBe("1");
    expect(offers[101]!.externalId).toBe("102");
  });

  it("stops after a short page (fewer than PageSize results)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ Campaigns: [campaign(7)] })
    ) as unknown as typeof fetch;
    await new ImpactAdapter().pullOffers(ctxWith(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 401/403 to AUTH_FAILED so the service records a credential error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ Message: "bad credentials" }, 401)
    ) as unknown as typeof fetch;
    const err = await new ImpactAdapter()
      .pullOffers(ctxWith(fetchImpl))
      .catch((e) => e);
    expect(err).toBeInstanceOf(NetworkAdapterError);
    expect((err as NetworkAdapterError).code).toBe("AUTH_FAILED");
    expect((err as NetworkAdapterError).status).toBe(401);
  });

  it("maps 5xx to HTTP_ERROR", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ Message: "boom" }, 500)
    ) as unknown as typeof fetch;
    const err = await new ImpactAdapter()
      .pullOffers(ctxWith(fetchImpl))
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe("HTTP_ERROR");
  });

  it("rejects invalid JSON with BAD_RESPONSE", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;
    const err = await new ImpactAdapter()
      .pullOffers(ctxWith(fetchImpl))
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe("BAD_RESPONSE");
  });

  it("skips campaigns without an ID and handles string payouts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        Campaigns: [
          { CampaignName: "no id" },
          campaign(9, { DefaultPayout: "7.25" }),
        ],
      })
    ) as unknown as typeof fetch;
    const offers = await new ImpactAdapter().pullOffers(ctxWith(fetchImpl));
    expect(offers).toHaveLength(1);
    expect(offers[0]!.externalId).toBe("9");
    expect(offers[0]!.payout).toBe(7.25);
  });

  it("wraps transport failures in NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection reset");
    }) as unknown as typeof fetch;
    const err = await new ImpactAdapter()
      .pullOffers(ctxWith(fetchImpl))
      .catch((e) => e);
    expect((err as NetworkAdapterError).code).toBe("NETWORK_ERROR");
  });

  it("uses the production base URL when none is provided", () => {
    expect(IMPACT_DEFAULT_BASE_URL).toBe("https://api.impact.com");
  });
});

describe("mapImpactCampaign", () => {
  it("falls back to a generated name when CampaignName is missing", () => {
    const offer = mapImpactCampaign({ CampaignId: 5 });
    expect(offer.name).toBe("Campaign 5");
    expect(offer.termsText).toBeNull();
    expect(offer.payout).toBeNull();
  });
});
