/**
 * Lander Intel ① — deterministic dimension scoring tests.
 * Good-page vs bad-page HTML fixtures per dimension, bounceRisk high-score
 * case, overallScore weighting, and the LLM suggestion validator's leniency.
 */
import { describe, expect, it } from "vitest";
import {
  analyzeLander,
  buildLanderSuggestionsPrompt,
  computeOverallScore,
  validateLanderSuggestionsShape,
  type LanderScores,
} from "./lander-analyzer.js";

const GOOD_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>超值跑鞋 - 限时优惠</title>
<style>@media (max-width: 768px) { .hero { font-size: 20px; } }</style>
<link rel="stylesheet" href="https://cdn.example.com/app.css">
</head>
<body class="md:flex lg:grid">
<h1>超轻透气跑鞋，跑步更轻松</h1>
<p>原价 ¥899，现价 ¥499，限时优惠仅剩 3 天！</p>
<button>立即购买</button>
<a href="/trial">免费试用</a>
<section>用户评价：★★★★★ 4.9 分，10000+ 条评价</section>
<section>官方认证 · 正品保障 · SSL 安全支付</section>
<section>联系电话：400-123-4567，邮箱 <a href="mailto:hi@example.com">hi@example.com</a></section>
<footer><a href="/privacy">隐私政策</a></footer>
<img src="a.jpg"><img src="b.jpg">
<script src="https://cdn.example.com/app.js"></script>
</body>
</html>`;

const BAD_HTML =
  `<!DOCTYPE html><html><head><title>buy stuff</title></head><body>` +
  `<p>welcome to our store</p>`.repeat(5) +
  Array.from({ length: 50 }, (_, i) => `<img src="p${i}.jpg">`).join("") +
  `<div class="popup">subscribe to our newsletter popup modal</div>` +
  `<video autoplay src="ad.mp4"></video>` +
  `<!-- padding -->${"x".repeat(600 * 1024)}` +
  `</body></html>`;

describe("performance", () => {
  it("scores a fast, lean page high", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    expect(r.scores.performance).toBeGreaterThanOrEqual(85);
    expect(
      r.issues.filter((i) => i.dimension === "performance")
    ).toHaveLength(0);
  });

  it("penalizes slow fetch, huge HTML and many images", () => {
    const r = analyzeLander(BAD_HTML, 5000);
    // -30 (fetch) -20 (600KB) -20 (50 imgs) = 30
    expect(r.scores.performance).toBeLessThanOrEqual(40);
    const perf = r.issues.filter((i) => i.dimension === "performance");
    expect(perf.some((i) => i.severity === "high")).toBe(true);
    expect(perf.some((i) => i.message.includes("5000ms"))).toBe(true);
  });
});

describe("cta", () => {
  it("rewards multiple above-the-fold CTAs", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    expect(r.scores.cta).toBeGreaterThanOrEqual(85);
  });

  it("flags a page with no CTA as high severity", () => {
    const r = analyzeLander(BAD_HTML, 200);
    expect(r.scores.cta).toBe(20);
    const cta = r.issues.filter((i) => i.dimension === "cta");
    expect(cta).toHaveLength(1);
    expect(cta[0].severity).toBe("high");
    expect(cta[0].message).toContain("CTA");
  });

  it("warns on a single CTA", () => {
    const html = `<html><body><a href="/x">立即购买</a><p>${"y".repeat(100)}</p></body></html>`;
    const r = analyzeLander(html, 200);
    expect(r.scores.cta).toBe(65);
    expect(
      r.issues.some(
        (i) => i.dimension === "cta" && i.severity === "medium"
      )
    ).toBe(true);
  });
});

describe("trust", () => {
  it("scores full trust signals at 100", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    expect(r.scores.trust).toBe(100);
    expect(r.issues.filter((i) => i.dimension === "trust")).toHaveLength(0);
  });

  it("scores zero when no trust signal is present", () => {
    const r = analyzeLander(BAD_HTML, 200);
    expect(r.scores.trust).toBe(0);
    expect(r.issues.filter((i) => i.dimension === "trust")).toHaveLength(4);
  });
});

describe("mobile", () => {
  it("scores 100 with viewport + media query + framework classes", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    expect(r.scores.mobile).toBe(100);
  });

  it("flags missing viewport as high severity", () => {
    const r = analyzeLander(BAD_HTML, 200);
    expect(r.scores.mobile).toBe(0);
    const mob = r.issues.filter((i) => i.dimension === "mobile");
    expect(mob.some((i) => i.severity === "high")).toBe(true);
    expect(mob.some((i) => i.message.includes("viewport"))).toBe(true);
  });
});

describe("copy", () => {
  it("rewards a single strong H1, price anchor and urgency", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    expect(r.scores.copy).toBe(100);
  });

  it("penalizes missing H1 and missing price anchor", () => {
    const r = analyzeLander(BAD_HTML, 200);
    expect(r.scores.copy).toBeLessThanOrEqual(40);
    const copy = r.issues.filter((i) => i.dimension === "copy");
    expect(copy.some((i) => i.message.includes("H1"))).toBe(true);
    expect(copy.some((i) => i.message.includes("价格锚点"))).toBe(true);
  });

  it("flags multiple H1s", () => {
    const html = `<html><body><h1>第一标题内容足够长</h1><h1>第二标题内容足够长</h1></body></html>`;
    const r = analyzeLander(html, 200);
    const copy = r.issues.filter((i) => i.dimension === "copy");
    expect(copy.some((i) => i.message.includes("2 个 H1"))).toBe(true);
  });
});

describe("bounceRisk", () => {
  it("scores 0 for a clean page", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    expect(r.scores.bounceRisk).toBe(0);
    expect(
      r.issues.filter((i) => i.dimension === "bounceRisk")
    ).toHaveLength(0);
  });

  it("scores high for popup + autoplay video", () => {
    const r = analyzeLander(BAD_HTML, 200);
    // popup/modal 35 + autoplay 30 + <video> 20 = 85
    expect(r.scores.bounceRisk).toBeGreaterThanOrEqual(60);
    const b = r.issues.filter((i) => i.dimension === "bounceRisk");
    expect(b.some((i) => i.severity === "high")).toBe(true);
  });
});

describe("overallScore weighting", () => {
  it("is 100 for a perfect page", () => {
    expect(
      computeOverallScore({
        performance: 100,
        cta: 100,
        trust: 100,
        mobile: 100,
        copy: 100,
        bounceRisk: 0,
      })
    ).toBe(100);
  });

  it("applies weights 20/25/15/15/15/10 with bounceRisk inverted", () => {
    const scores: LanderScores = {
      performance: 80,
      cta: 60,
      trust: 40,
      mobile: 50,
      copy: 70,
      bounceRisk: 30,
    };
    // 16 + 15 + 6 + 7.5 + 10.5 + 7 = 62
    expect(computeOverallScore(scores)).toBe(62);
  });

  it("treats bounceRisk as a risk (higher hurts)", () => {
    const base: LanderScores = {
      performance: 80,
      cta: 80,
      trust: 80,
      mobile: 80,
      copy: 80,
      bounceRisk: 0,
    };
    const risky = { ...base, bounceRisk: 100 };
    expect(computeOverallScore(risky)).toBeLessThan(
      computeOverallScore(base)
    );
    expect(computeOverallScore(base) - computeOverallScore(risky)).toBe(10);
  });
});

describe("issues ordering", () => {
  it("sorts high severity first", () => {
    const r = analyzeLander(BAD_HTML, 5000);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const ranks = r.issues.map((i) => rank[i.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe("validateLanderSuggestionsShape", () => {
  it("accepts strings and {text} wrappers, stamps PREDICTED", () => {
    const out = validateLanderSuggestionsShape({
      suggestions: [{ text: "在 H1 下方增加价格锚点" }, "压缩首屏图片"],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      text: "在 H1 下方增加价格锚点",
      dataQuality: "PREDICTED",
    });
    expect(out[1].dataQuality).toBe("PREDICTED");
  });

  it("tolerates a capitalized Suggestions key", () => {
    const out = validateLanderSuggestionsShape({
      Suggestions: [{ text: "建议一" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("建议一");
  });

  it("tolerates numeric suggestion texts", () => {
    const out = validateLanderSuggestionsShape({
      suggestions: [{ text: 123 }, 456],
    });
    expect(out[0].text).toBe("123");
    expect(out[1].text).toBe("456");
  });

  it("caps at 5 suggestions", () => {
    const out = validateLanderSuggestionsShape({
      suggestions: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(out).toHaveLength(5);
  });

  it("rejects empty arrays and non-objects", () => {
    expect(() => validateLanderSuggestionsShape({ suggestions: [] })).toThrow();
    expect(() => validateLanderSuggestionsShape(null)).toThrow();
    expect(() => validateLanderSuggestionsShape("nope")).toThrow();
    expect(() => validateLanderSuggestionsShape({})).toThrow();
  });
});

describe("buildLanderSuggestionsPrompt", () => {
  it("bans empty platitudes and passes scores + issues", () => {
    const r = analyzeLander(GOOD_HTML, 200);
    const { system, user } = buildLanderSuggestionsPrompt({
      scores: r.scores,
      issues: r.issues,
      summary: r.summary,
      lang: "zh",
    });
    expect(system).toContain("禁止输出");
    expect(system).toContain("优化用户体验");
    expect(system).toContain("STRICT JSON");
    expect(user).toContain(JSON.stringify(r.scores.performance));
    expect(user).toContain("中文");
  });
});
