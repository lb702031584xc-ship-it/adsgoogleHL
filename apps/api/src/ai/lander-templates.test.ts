/**
 * Lander Intel ③ — template renderer unit tests.
 * XSS is the review focus: every variable value must be escaped.
 */
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  builtInHtmlTemplate,
  escapeHtml,
  extractTemplateVariables,
  getBuiltInTemplate,
  isTemplateCategory,
  listTemplateVariables,
  renderTemplate,
  sanitizeCtaUrl,
} from "./lander-templates.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("neutralizes a script tag", () => {
    const out = escapeHtml(`<script>alert(1)</script>`);
    expect(out).not.toContain("<script>");
    expect(out).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("neutralizes an onerror attribute injection", () => {
    const out = escapeHtml(`" onerror="alert(1)`);
    expect(out).not.toContain(`" onerror=`);
    expect(out).toBe("&quot; onerror=&quot;alert(1)");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Super Shoes 2026")).toBe("Super Shoes 2026");
  });
});

describe("sanitizeCtaUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(sanitizeCtaUrl("https://example.com/deal?a=1")).toBe(
      "https://example.com/deal?a=1"
    );
    expect(sanitizeCtaUrl("http://example.com")).toBe("http://example.com");
  });

  it("rejects javascript: URIs", () => {
    expect(sanitizeCtaUrl("javascript:alert(1)")).toBe("#");
    expect(sanitizeCtaUrl("JaVaScRiPt:alert(1)")).toBe("#");
  });

  it("rejects data: and other schemes, relative paths and blanks", () => {
    expect(sanitizeCtaUrl("data:text/html,<script>")).toBe("#");
    expect(sanitizeCtaUrl("/relative/path")).toBe("#");
    expect(sanitizeCtaUrl("")).toBe("#");
    expect(sanitizeCtaUrl(null)).toBe("#");
    expect(sanitizeCtaUrl(undefined)).toBe("#");
  });

  it("trims whitespace before checking the scheme", () => {
    expect(sanitizeCtaUrl("  https://example.com  ")).toBe(
      "https://example.com"
    );
    expect(sanitizeCtaUrl(" \tjavascript:alert(1)")).toBe("#");
  });
});

describe("renderTemplate", () => {
  it("replaces scalar placeholders", () => {
    const out = renderTemplate("<h1>{{productName}}</h1><p>{{price}}</p>", {
      productName: "Turbo Shoes",
      price: "$49",
    });
    expect(out).toBe("<h1>Turbo Shoes</h1><p>$49</p>");
  });

  it("escapes scalar values", () => {
    const out = renderTemplate("<h1>{{productName}}</h1>", {
      productName: `"><script>alert(1)</script>`,
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("keeps unknown placeholders as-is for debugging", () => {
    const out = renderTemplate("<p>{{known}} {{typoVar}}</p>", {
      known: "yes",
    });
    expect(out).toBe("<p>yes {{typoVar}}</p>");
  });

  it("renders {{pros}}/{{cons}} arrays as escaped <li> lists", () => {
    const out = renderTemplate("<ul>{{pros}}</ul>", {
      pros: ["Lightweight", "<b>Bold</b> claim", "2 & 3"],
    });
    expect(out).toBe(
      "<ul><li>Lightweight</li><li>&lt;b&gt;Bold&lt;/b&gt; claim</li><li>2 &amp; 3</li></ul>"
    );
  });

  it("renders {{products}} as escaped table rows with a CTA cell", () => {
    const out = renderTemplate("<tbody>{{products}}</tbody>", {
      products: [
        {
          name: "A <Pro>",
          price: "$10",
          rating: "4.5",
          ctaUrl: "https://example.com/a",
        },
        {
          name: "B",
          price: "$20",
          rating: "4.0",
          ctaUrl: "javascript:evil()",
        },
      ],
      ctaText: "Buy",
    });
    expect(out).toContain("<td>A &lt;Pro&gt;</td>");
    expect(out).toContain(
      '<a href="https://example.com/a" rel="nofollow sponsored noopener">Buy</a>'
    );
    // malicious ctaUrl degrades to a plain cell, no link
    expect(out).not.toContain("javascript:evil()");
    expect(out).toContain("<td><span>—</span></td>");
  });

  it("marks featured product rows with the highlight class only", () => {
    const out = renderTemplate("{{products}}", {
      products: [{ name: "Pick", featured: true }],
      ctaText: "Go",
    });
    expect(out).toContain('<tr class="lp-featured">');
  });

  it("renders {{products}} as cards with productsLayout: cards", () => {
    const out = renderTemplate(
      "{{products}}",
      {
        products: [
          {
            rank: "1",
            name: "Top <One>",
            blurb: "Best & brightest",
            price: "$9",
            ctaUrl: "https://example.com/1",
          },
        ],
        ctaText: "Grab it",
      },
      { productsLayout: "cards" }
    );
    expect(out).toContain("#1");
    expect(out).toContain("Top &lt;One&gt;");
    expect(out).toContain("Best &amp; brightest");
    expect(out).toContain('href="https://example.com/1"');
    expect(out).toContain("Grab it");
  });

  it("renders malicious variable values with no executable script", () => {
    const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
    const out = renderTemplate(
      "<h1>{{productName}}</h1><a href=\"{{ctaUrl}}\">{{ctaText}}</a><ul>{{pros}}</ul>{{products}}",
      {
        productName: evil,
        ctaUrl: `javascript:alert(3)`,
        ctaText: evil,
        pros: [evil],
        products: [
          {
            name: evil,
            price: evil,
            rating: evil,
            ctaUrl: evil,
          },
        ],
      }
    );
    expect(out).not.toContain("<script>");
    // "onerror=" may appear only as *escaped text content*, never as a real
    // attribute on a real element.
    expect(out).not.toMatch(/<[^>]*\sonerror\s*=/i);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
  });

  it("treats ctaUrl like a normal link when valid, # when not", () => {
    const good = renderTemplate('<a href="{{ctaUrl}}">x</a>', {
      ctaUrl: "https://merchant.example/deal",
    });
    expect(good).toBe('<a href="https://merchant.example/deal">x</a>');
    const bad = renderTemplate('<a href="{{ctaUrl}}">x</a>', {
      ctaUrl: "data:text/html,hi",
    });
    expect(bad).toBe('<a href="#">x</a>');
  });
});

describe("extractTemplateVariables", () => {
  it("returns sorted unique placeholder names", () => {
    expect(
      extractTemplateVariables("<p>{{price}} {{productName}} {{price}}</p>")
    ).toEqual(["price", "productName"]);
  });

  it("returns an empty list when there are no placeholders", () => {
    expect(extractTemplateVariables("<p>static</p>")).toEqual([]);
  });
});

describe("built-in templates", () => {
  it("ships exactly the eight expected templates", () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual([
      "builtin-review",
      "builtin-comparison",
      "builtin-listicle",
      "builtin-review-painstory",
      "builtin-comparison-showdown",
      "builtin-listicle-scenario",
      "builtin-coupon",
      "builtin-guide",
    ]);
    for (const t of BUILT_IN_TEMPLATES) {
      expect(isTemplateCategory(t.category)).toBe(true);
    }
  });

  it("has en+zh HTML with viewport meta, inline CSS, and no external JS", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      for (const html of [t.html.en, t.html.zh]) {
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain('name="viewport"');
        expect(html).toContain("<style>");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("src=\"http");
        expect(html).not.toContain("href=\"http");
      }
    }
  });

  it("review template uses the expected variables", () => {
    const vars = listTemplateVariables("builtin-review");
    expect(vars).not.toBeNull();
    for (const name of [
      "productName",
      "price",
      "originalPrice",
      "ctaUrl",
      "ctaText",
      "rating",
      "reviewCount",
      "pros",
      "cons",
    ]) {
      expect(vars).toContain(name);
    }
  });

  it("comparison and listicle templates use {{products}}", () => {
    expect(listTemplateVariables("builtin-comparison")).toContain("products");
    expect(listTemplateVariables("builtin-listicle")).toContain("products");
  });

  it("builtInHtmlTemplate picks the requested language", () => {
    const en = builtInHtmlTemplate("builtin-review", "en");
    const zh = builtInHtmlTemplate("builtin-review", "zh");
    expect(en).toContain("Review: Is It Worth Your Money?");
    expect(zh).toContain("深度评测");
    expect(builtInHtmlTemplate("builtin-review", undefined)).toBe(zh);
    expect(builtInHtmlTemplate("nope", "en")).toBeNull();
  });

  it("getBuiltInTemplate returns null for unknown ids", () => {
    expect(getBuiltInTemplate("nope")).toBeNull();
    expect(listTemplateVariables("nope")).toBeNull();
  });
});

describe("task 4 — five new high-converting built-ins", () => {
  const NEW_TEMPLATES = [
    { id: "builtin-review-painstory", category: "review" },
    { id: "builtin-comparison-showdown", category: "comparison" },
    { id: "builtin-listicle-scenario", category: "listicle" },
    { id: "builtin-coupon", category: "coupon" },
    { id: "builtin-guide", category: "guide" },
  ] as const;

  it("registers all five templates with valid categories", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(8);
    for (const { id, category } of NEW_TEMPLATES) {
      const tpl = getBuiltInTemplate(id);
      expect(tpl).not.toBeNull();
      expect(tpl!.category).toBe(category);
      expect(isTemplateCategory(category)).toBe(true);
      expect(tpl!.name.zh).toBeTruthy();
      expect(tpl!.name.en).toBeTruthy();
      expect(tpl!.description.zh).toBeTruthy();
      expect(tpl!.description.en).toBeTruthy();
    }
  });

  it("ships an affiliate disclosure in both languages", () => {
    for (const { id } of NEW_TEMPLATES) {
      const tpl = getBuiltInTemplate(id)!;
      expect(tpl.html.en).toContain("affiliate links");
      expect(tpl.html.zh).toContain("推广链接");
    }
  });

  it("renders variables escaped and keeps the document structure", () => {
    const vars = {
      productName: `<script>alert(1)</script>`,
      painPoint: "back pain",
      rating: "4.8",
      reviewCount: "12,300",
      pros: ["quiet", "cheap"],
      cons: ["heavy"],
      trustItems: ["50k users", "4.8★ rated"],
      price: "$49",
      originalPrice: "$99",
      guaranteeText: "30-day guarantee",
      challengerName: "Rival X",
      verdictText: "Ours wins on value.",
      products: [
        { name: "A", price: "$49", rating: "4.8", ctaUrl: "https://a.example/deal", featured: true },
        { name: "B", price: "$59", rating: "4.2", ctaUrl: "javascript:alert(1)" },
      ],
      introText: "Pick by scenario.",
      discountInfo: "40% OFF",
      couponCode: "SAVE40",
      expiryText: "Ends Sunday",
      guideSteps: ["Step one", "Step two"],
      keyPoints: ["Point A"],
      priceHint: "$40-$60",
      ctaText: "Get Deal",
      ctaUrl: "https://merchant.example/deal",
    };
    for (const { id, category } of NEW_TEMPLATES) {
      const html = builtInHtmlTemplate(id, "en")!;
      const out = renderTemplate(html, vars, {
        productsLayout: category === "listicle" ? "cards" : "table",
      });
      // No raw injection survives.
      expect(out).not.toContain("<script>alert(1)</script>");
      expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      // javascript: CTA degrades to a disabled cell, never a link.
      expect(out).not.toContain("javascript:alert(1)");
      // Document skeleton intact.
      expect(out).toContain("<!DOCTYPE html>");
      expect(out).toContain("lp-disclosure");
      expect(out).toContain("Get Deal");
    }
  });

  it("coupon template exposes its coupon variables; guide exposes steps", () => {
    expect(listTemplateVariables("builtin-coupon")).toEqual(
      expect.arrayContaining(["couponCode", "discountInfo", "expiryText"])
    );
    expect(listTemplateVariables("builtin-guide")).toEqual(
      expect.arrayContaining(["guideSteps", "keyPoints"])
    );
    expect(listTemplateVariables("builtin-review-painstory")).toEqual(
      expect.arrayContaining(["painPoint", "trustItems", "guaranteeText"])
    );
    expect(listTemplateVariables("builtin-comparison-showdown")).toEqual(
      expect.arrayContaining(["challengerName", "verdictText", "products"])
    );
    expect(listTemplateVariables("builtin-listicle-scenario")).toEqual(
      expect.arrayContaining(["introText", "products"])
    );
  });
});
