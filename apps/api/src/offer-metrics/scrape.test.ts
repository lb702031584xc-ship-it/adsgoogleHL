/**
 * 指标抓取单测：JSON-LD 解析、文本模式兜底（中英）、缺失字段、抓取失败不抛错。
 */
import { describe, expect, it, vi } from "vitest";
import { scrapeOfferMetrics } from "./scrape.js";

const jsonLdAmazon = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Test Widget Pro",
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"12834"},
 "offers":{"@type":"Offer","price":"29.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
</script>
</head><body><h1>Test Widget Pro</h1></body></html>`;

const textAmazon = `
<html><body>
<span>4.3 out of 5</span>
<span>2,345 ratings</span>
<span class="a-offscreen">$49.95</span>
<span>1K+ bought in past month</span>
<span>Best Sellers Rank #12,304 in Tools</span>
</body></html>`;

const textCn = `
<html><body><div>商品标题测试</div><div>已售 5,678 件</div><div>4.8 out of 5</div><div>999条评价</div></body></html>`;

const noData = `<html><body><p>hello world</p></body></html>`;

function fakeFetch(html: string) {
  return vi.fn(async () => ({
    finalUrl: "https://www.example.com/p/1",
    html,
    text: html,
    statusCode: 200,
    redirectChain: [],
    fetchMs: 10,
  }));
}

describe("scrapeOfferMetrics", () => {
  it("JSON-LD 优先：评分/评论数/价格/库存", async () => {
    const m = await scrapeOfferMetrics("https://www.example.com/p/1", {
      fetchHtml: fakeFetch(jsonLdAmazon) as never,
    });
    expect(m.finalUrl).toBe("https://www.example.com/p/1");
    expect(m.title).toBe("Test Widget Pro");
    expect(m.rating).toBe(4.6);
    expect(m.reviewCount).toBe(12834);
    expect(m.price).toBe(29.99);
    expect(m.currency).toBe("USD");
    expect(m.availability).toBe("InStock");
  });

  it("文本兜底：out of 5 / ratings / $价格 / bought in past month / BSR", async () => {
    const m = await scrapeOfferMetrics("https://www.amazon.com/dp/x", {
      fetchHtml: fakeFetch(textAmazon) as never,
    });
    expect(m.rating).toBe(4.3);
    expect(m.reviewCount).toBe(2345);
    expect(m.price).toBe(49.95);
    expect(m.currency).toBe("USD");
    // "1K+ bought"：K 不在数字模式内，soldCount 取不到 → null（不硬猜）
    expect(m.soldCount).toBe(null);
    expect(m.bsr).toBe(12304);
  });

  it("中文兜底：已售 X 件 / 条评价", async () => {
    const m = await scrapeOfferMetrics("https://www.example.com/p/2", {
      fetchHtml: fakeFetch(textCn) as never,
    });
    expect(m.soldCount).toBe(5678);
    expect(m.reviewCount).toBe(999);
    expect(m.rating).toBe(4.8);
  });

  it("bought in past month 纯数字 → soldCount", async () => {
    const m = await scrapeOfferMetrics("https://www.amazon.com/dp/y", {
      fetchHtml: fakeFetch(`<html><body>3,000+ bought in past month</body></html>`) as never,
    });
    expect(m.soldCount).toBe(3000);
  });

  it("无数据 → 各字段 null + failures 记录，不抛错", async () => {
    const m = await scrapeOfferMetrics("https://www.example.com/empty", {
      fetchHtml: fakeFetch(noData) as never,
    });
    expect(m.rating).toBe(null);
    expect(m.reviewCount).toBe(null);
    expect(m.price).toBe(null);
    expect(m.soldCount).toBe(null);
    expect(m.failures.length).toBeGreaterThan(0);
    expect(m.failures).toContain("未获取到评分");
  });

  it("抓取失败（403）→ failures 记录，不抛错", async () => {
    const boom = vi.fn(async () => {
      throw new Error("Page fetch failed (status 403)");
    });
    const m = await scrapeOfferMetrics("https://www.amazon.com/dp/z", {
      fetchHtml: boom as never,
    });
    expect(m.finalUrl).toBe(null);
    expect(m.failures.some((f) => f.includes("403"))).toBe(true);
  });

  it("非法 URL → failures 记录，不抛错", async () => {
    const boom = vi.fn(async () => {
      throw new Error("Invalid URL");
    });
    const m = await scrapeOfferMetrics("not-a-url", {
      fetchHtml: boom as never,
    });
    expect(m.failures.some((f) => f.includes("Invalid URL"))).toBe(true);
  });
});
