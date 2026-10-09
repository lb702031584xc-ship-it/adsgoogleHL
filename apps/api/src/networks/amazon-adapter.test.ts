import { describe, expect, it } from "vitest";
import {
  parseAmazonCredentials,
  parseSearchItemsResponse,
  scoreAmazonProduct,
  signPaApiRequest,
} from "./amazon-adapter.js";

describe("amazon-adapter", () => {
  it("parses credentials correctly", () => {
    const c = parseAmazonCredentials("AK|SK|mytag-20|UK");
    expect(c.accessKey).toBe("AK");
    expect(c.secretKey).toBe("SK");
    expect(c.partnerTag).toBe("mytag-20");
    expect(c.region).toBe("UK");
  });

  it("defaults region to US", () => {
    const c = parseAmazonCredentials("AK|SK|mytag-20");
    expect(c.region).toBe("US");
  });

  it("rejects incomplete credentials", () => {
    expect(() => parseAmazonCredentials("AK|SK")).toThrow();
    expect(() => parseAmazonCredentials("")).toThrow();
  });

  it("rejects invalid region", () => {
    expect(() => parseAmazonCredentials("AK|SK|tag|XX")).toThrow();
  });

  it("parses SearchItems response", () => {
    const data = {
      SearchResult: {
        Items: [
          {
            ASIN: "B08N5WRWNW",
            DetailPageURL: "https://www.amazon.com/dp/B08N5WRWNW",
            ItemInfo: { Title: { DisplayValue: "Test Product" } },
            Offers: {
              Listings: [
                {
                  Price: { Amount: 99.99, Currency: "USD" },
                  Availability: { Message: "In Stock" },
                  DeliveryInfo: { IsPrimeEligible: true },
                },
              ],
            },
            CustomerReviews: { StarRating: { Value: 4.5 }, Count: 2500 },
            Images: { Primary: { Large: { URL: "https://img.jpg" } } },
          },
        ],
      },
    };
    const products = parseSearchItemsResponse(data);
    expect(products).toHaveLength(1);
    expect(products[0].asin).toBe("B08N5WRWNW");
    expect(products[0].price).toBe(99.99);
    expect(products[0].rating).toBe(4.5);
    expect(products[0].reviewCount).toBe(2500);
    expect(products[0].isPrime).toBe(true);
  });

  it("parses brand from ByLineInfo", () => {
    const withBrand = parseSearchItemsResponse({
      SearchResult: {
        Items: [
          {
            ASIN: "B08N5WRWNW",
            ItemInfo: {
              Title: { DisplayValue: "Anker 737 Power Bank" },
              ByLineInfo: { Brand: { DisplayValue: "Anker" } },
            },
          },
        ],
      },
    });
    expect(withBrand[0]?.brand).toBe("Anker");

    const withoutBrand = parseSearchItemsResponse({
      SearchResult: { Items: [{ ASIN: "B08N5WRWNW", ItemInfo: {} }] },
    });
    expect(withoutBrand[0]?.brand).toBe(null);
  });

  it("returns empty for missing items", () => {
    expect(parseSearchItemsResponse({})).toEqual([]);
    expect(parseSearchItemsResponse({ SearchResult: {} })).toEqual([]);
  });

  it("scores products sensibly", () => {
    const good = scoreAmazonProduct({
      asin: "A",
      title: "t",
      detailPageUrl: "u",
      price: 99.99,
      currency: "USD",
      rating: 4.7,
      reviewCount: 5000,
      imageUrl: null,
      isPrime: true,
      availability: "In Stock",
      brand: "Anker",
    });
    const bad = scoreAmazonProduct({
      asin: "B",
      title: "t",
      detailPageUrl: "u",
      price: 5,
      currency: "USD",
      rating: 3.0,
      reviewCount: 5,
      imageUrl: null,
      isPrime: false,
      availability: "Out of Stock",
      brand: null,
    });
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeGreaterThan(70);
    expect(bad).toBeLessThan(40);
  });

  it("generates a valid AWS4 signature header", () => {
    const creds = {
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      partnerTag: "tag-20",
      region: "US",
    };
    const auth = signPaApiRequest(
      creds,
      "POST",
      "/paapi5/searchitems",
      '{"Keywords":"test"}',
      "20261008T120000Z",
      "20261008"
    );
    expect(auth).toContain("AWS4-HMAC-SHA256");
    expect(auth).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(auth).toContain("Signature=");
  });
});
