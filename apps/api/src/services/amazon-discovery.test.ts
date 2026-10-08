import { describe, expect, it } from "vitest";
import {
  validateCriteria,
  filterProducts,
  scoreAndExplain,
  type AmazonProduct,
} from "./amazon-discovery.js";

const mockProduct = (overrides: Partial<AmazonProduct> = {}): AmazonProduct => ({
  asin: "B08N5WRWNW",
  title: "Test Product",
  detailPageUrl: "https://www.amazon.com/dp/B08N5WRWNW",
  price: 99.99,
  currency: "USD",
  rating: 4.5,
  reviewCount: 2000,
  imageUrl: null,
  isPrime: true,
  availability: "In Stock",
  ...overrides,
});

describe("amazon-discovery", () => {
  it("validates criteria with keywords", () => {
    const c = validateCriteria({ keywords: ["earbuds", "keyboard"] });
    expect(c.keywords).toEqual(["earbuds", "keyboard"]);
    expect(c.minPrice).toBeNull();
  });

  it("rejects empty keywords", () => {
    expect(() => validateCriteria({ keywords: [] })).toThrow();
    expect(() => validateCriteria({})).toThrow();
  });

  it("rejects invalid rating", () => {
    expect(() =>
      validateCriteria({ keywords: ["a"], minRating: 6 })
    ).toThrow();
  });

  it("limits keywords to 10", () => {
    const kws = Array.from({ length: 15 }, (_, i) => `kw${i}`);
    const c = validateCriteria({ keywords: kws });
    expect(c.keywords).toHaveLength(10);
  });

  it("filters products by criteria", () => {
    const products = [
      mockProduct(),
      mockProduct({ asin: "B2", rating: 3.0 }), // rating too low
      mockProduct({ asin: "B3", price: 500 }), // price too high
      mockProduct({ asin: "B4", reviewCount: 10 }), // reviews too low
      mockProduct({ asin: "B5", availability: "Out of Stock" }), // OOS
    ];
    const filtered = filterProducts(products, {
      keywords: ["test"],
      minPrice: 50,
      maxPrice: 200,
      minRating: 4.3,
      minReviews: 500,
    });
    expect(filtered.map((p) => p.asin)).toEqual(["B08N5WRWNW"]);
  });

  it("scores and explains products", () => {
    const scored = scoreAndExplain(mockProduct());
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.estimatedCommission).toBeCloseTo(4.0, 1); // 99.99 * 4%
    expect(scored.reasons.length).toBeGreaterThan(0);
  });
});
