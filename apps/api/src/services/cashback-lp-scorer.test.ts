/**
 * Feature: 返利落地页合规评分 (lp-cashback-score).
 * Unit tests for the pure, deterministic scorer (no DB, no network).
 */
import { describe, expect, it } from "vitest";
import {
  LP_SCORE_ISSUES,
  scoreCashbackLandingPage,
} from "./cashback-lp-scorer.js";

const DISCLOSURE_EN =
  "<p>Affiliate Disclosure: we may earn a commission if you buy through our links.</p>";

const DISCLOSURE_ZH =
  "<p>返利声明：通过以下链接购买，我们可能会获得佣金。</p>";

function richPage(disclosure: string, rateLine: string): string {
  const body = Array.from({ length: 40 }, (_, i) =>
    `<p>这是第 ${i + 1} 段实质内容，介绍该商家的返利政策、购物流程与注意事项，帮助用户做出明智的购买决策。</p>`
  ).join("");
  return `<html><head><title>t</title></head><body>
    ${body}
    <nav><a href="/guide">购物指南</a><a href="/faq">常见问题</a><a href="/about">关于我们</a></nav>
    <p>${rateLine}</p>
    ${disclosure}
    <a href="https://www.merchant.example/item/123?tag=abc">前往商家购买</a>
  </body></html>`;
}

describe("scoreCashbackLandingPage", () => {
  it("gives a high score to a rich compliant page (check 1+2)", () => {
    const r = scoreCashbackLandingPage(
      richPage(DISCLOSURE_ZH, "该商家返利 8%。"),
      { detectedRate: "8%" }
    );
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.issues).toEqual([]);
  });

  it("flags missing disclosure (check 2)", () => {
    const r = scoreCashbackLandingPage(richPage("", "返利 8%。"), {
      detectedRate: "8%",
    });
    expect(r.issues).toContain(LP_SCORE_ISSUES.MISSING_DISCLOSURE);
    expect(r.score).toBe(80);
  });

  it("accepts an English affiliate disclosure too", () => {
    const r = scoreCashbackLandingPage(richPage(DISCLOSURE_EN, "8% cashback."), {
      detectedRate: "8%",
    });
    expect(r.issues).not.toContain(LP_SCORE_ISSUES.MISSING_DISCLOSURE);
  });

  it("flags thin content (check 1: 实质内容)", () => {
    const r = scoreCashbackLandingPage(
      `<html><body><p>返利不错。</p>${DISCLOSURE_ZH}<a href="/a">x</a><a href="/b">y</a><a href="/c">z</a></body></html>`,
      {}
    );
    expect(r.issues).toContain(LP_SCORE_ISSUES.CONTENT_TOO_SHORT);
    expect(r.score).toBe(80);
  });

  it("flags pages with no extractable content", () => {
    const r = scoreCashbackLandingPage(
      "<html><body><script>var x = 1;</script></body></html>",
      {}
    );
    expect(r.issues).toEqual([LP_SCORE_ISSUES.NO_CONTENT]);
    expect(r.score).toBe(55);
  });

  it("flags outbound-heavy thin pages (check 1: 非跳转链接占比)", () => {
    const html = `<html><body>
      <p>点击下面链接去商家购买拿返利。</p>${DISCLOSURE_ZH}
      <a href="https://a.example/1">买</a><a href="https://b.example/2">买</a>
      <a href="https://c.example/3">买</a><a href="https://d.example/4">买</a>
      <a href="https://e.example/5">买</a>
    </body></html>`;
    const r = scoreCashbackLandingPage(html, {});
    expect(r.issues).toContain(LP_SCORE_ISSUES.OUTBOUND_HEAVY);
  });

  it("flags rate mismatch when page % differs from detectedRate (check 3)", () => {
    const r = scoreCashbackLandingPage(richPage(DISCLOSURE_ZH, "返利高达 12%！"), {
      detectedRate: "8%",
    });
    expect(r.issues).toContain(LP_SCORE_ISSUES.RATE_MISMATCH);
    expect(r.score).toBe(75);
  });

  it("passes the rate check when page % matches detectedRate within tolerance", () => {
    const r = scoreCashbackLandingPage(richPage(DISCLOSURE_ZH, "返利 8.2%"), {
      detectedRate: "8%",
    });
    expect(r.issues).not.toContain(LP_SCORE_ISSUES.RATE_MISMATCH);
  });

  it("skips the rate check when detectedRate is absent", () => {
    const r = scoreCashbackLandingPage(
      richPage(DISCLOSURE_ZH, "返利高达 50%！"),
      { detectedRate: null }
    );
    expect(r.issues).not.toContain(LP_SCORE_ISSUES.RATE_MISMATCH);
    // also skipped with undefined
    const r2 = scoreCashbackLandingPage(richPage(DISCLOSURE_ZH, "返利高达 50%！"));
    expect(r2.issues).not.toContain(LP_SCORE_ISSUES.RATE_MISMATCH);
  });

  it("flags bridge pages: almost nothing but a jump button (check 4)", () => {
    const html = `<html><body>
      <p>点击领取返利</p>
      <a href="https://www.merchant.example/?tag=abc">立即购买</a>
    </body></html>`;
    const r = scoreCashbackLandingPage(html, {});
    expect(r.issues).toContain(LP_SCORE_ISSUES.BRIDGE_PAGE_RISK);
    // content_too_short (-20) + missing_disclosure (-20) + bridge (-35) + too_few_links (-6) = 19
    expect(r.score).toBe(19);
  });

  it("is deterministic: same input yields identical output", () => {
    const html = richPage(DISCLOSURE_ZH, "返利 8%。");
    const a = scoreCashbackLandingPage(html, { detectedRate: "8%" });
    const b = scoreCashbackLandingPage(html, { detectedRate: "8%" });
    expect(a).toEqual(b);
  });

  it("clamps the score to 0..100", () => {
    const r = scoreCashbackLandingPage("", {});
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(r.score)).toBe(true);
  });
});
