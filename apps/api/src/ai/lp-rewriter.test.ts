/**
 * LP AI rewriter — prompt builder, strict-JSON validator, deterministic
 * before→after applier, and analyzer re-scoring.
 * The LLM client itself is mocked (chatJsonImpl is injected at the route
 * layer); these tests cover prompt content, JSON validation, and the
 * deterministic apply/score helpers.
 */
import { describe, expect, it } from "vitest";
import { AiError } from "./llm.js";
import {
  applyRewritesToHtml,
  buildRewritePrompt,
  pageTextExcerpt,
  rescoreRewrittenHtml,
  validateRewriteShape,
  type LpRewrite,
} from "./lp-rewriter.js";

const SAMPLE_ISSUES = [
  { dimension: "cta", severity: "high", message: "首屏未检测到 CTA 按钮" },
  { dimension: "copy", severity: "medium", message: "未检测到价格锚点" },
];

function goodPayload() {
  return {
    rewrites: [
      {
        element: "首屏 CTA 按钮",
        location: "首屏 H1 下方",
        before: "了解更多",
        after: "立即免费试用 14 天",
        reason: "明确的行动动词降低决策成本",
      },
    ],
    estimatedNewScore: 85,
  };
}

describe("buildRewritePrompt", () => {
  it("embeds the issues, page text, and strict JSON spec", () => {
    const { system, user } = buildRewritePrompt({
      pageName: "Test LP",
      pageUrl: "https://example.com/lp",
      pageText: "了解更多 — 欢迎来到示例落地页",
      issues: SAMPLE_ISSUES,
      lang: "zh",
    });
    expect(system).toContain("rewrites");
    expect(system).toContain("estimatedNewScore");
    expect(system).toContain("before");
    expect(user).toContain("首屏未检测到 CTA 按钮");
    expect(user).toContain("未检测到价格锚点");
    expect(user).toContain("了解更多");
  });

  it("carries the no-fluff clause (concrete copy required)", () => {
    const { system } = buildRewritePrompt({
      pageName: "x",
      pageUrl: "y",
      pageText: "z",
      issues: [],
      lang: "zh",
    });
    expect(system).toContain("禁止空话");
    expect(system).toContain("完整文案");
    expect(system).toContain("逐字引用");
  });

  it("renders an English variant when lang=en", () => {
    const { system, user } = buildRewritePrompt({
      pageName: "x",
      pageUrl: "y",
      pageText: "z",
      issues: SAMPLE_ISSUES,
      lang: "en",
    });
    expect(system).toContain("No fluff");
    expect(user).toContain("Please output in English.");
  });
});

describe("validateRewriteShape", () => {
  it("accepts a well-formed payload", () => {
    const out = validateRewriteShape(goodPayload());
    expect(out.rewrites).toHaveLength(1);
    expect(out.rewrites[0].after).toBe("立即免费试用 14 天");
    expect(out.aiEstimatedNewScore).toBe(85);
  });

  it("rejects a non-object", () => {
    expect(() => validateRewriteShape([1, 2])).toThrow(AiError);
  });

  it("rejects a missing or empty rewrites array", () => {
    expect(() => validateRewriteShape({ estimatedNewScore: 80 })).toThrow(
      AiError
    );
    expect(() =>
      validateRewriteShape({ rewrites: [], estimatedNewScore: 80 })
    ).toThrow(AiError);
  });

  it("rejects a rewrite missing before/after copy", () => {
    const bad = goodPayload();
    (bad.rewrites[0] as { before?: string }).before = "   ";
    expect(() => validateRewriteShape(bad)).toThrow(/before\/after/);
  });

  it("rejects an out-of-range estimatedNewScore", () => {
    const bad = goodPayload();
    bad.estimatedNewScore = 120;
    expect(() => validateRewriteShape(bad)).toThrow(/estimatedNewScore/);
  });

  it("tolerates a capitalized Rewrites key and defaults reason to empty", () => {
    const payload = {
      Rewrites: [
        {
          element: "H1",
          location: "首屏",
          before: "旧标题",
          after: "新标题",
        },
      ],
      estimatedNewScore: 90,
    };
    const out = validateRewriteShape(payload);
    expect(out.rewrites).toHaveLength(1);
    expect(out.rewrites[0].reason).toBe("");
  });
});

describe("applyRewritesToHtml", () => {
  const html =
    "<html><body><h1>旧标题</h1><a>了解更多</a><p>了解更多</p></body></html>";

  function rw(before: string, after: string): LpRewrite {
    return {
      element: "CTA",
      location: "首屏",
      before,
      after,
      reason: "test",
    };
  }

  it("applies a rewrite whose before appears exactly once", () => {
    const report = applyRewritesToHtml(html, [rw("旧标题", "新标题")]);
    expect(report.applied).toBe(1);
    expect(report.html).toContain("新标题");
    expect(report.html).not.toContain("旧标题");
  });

  it("skips not-found and ambiguous rewrites without guessing", () => {
    const report = applyRewritesToHtml(html, [
      rw("不存在的文案", "X"),
      rw("了解更多", "立即试用"),
    ]);
    expect(report.applied).toBe(0);
    expect(report.skipped).toHaveLength(2);
    expect(report.skipped.map((s) => s.reason).join("|")).toContain(
      "not found"
    );
    expect(report.skipped.map((s) => s.reason).join("|")).toContain("multiple");
    // Original HTML untouched.
    expect(report.html).toBe(html);
  });
});

describe("rescoreRewrittenHtml", () => {
  it("reuses the analyzer and returns a finite 0-100 score", () => {
    const html =
      "<html><head><title>T</title><meta name=\"viewport\" content=\"width=device-width\"></head>" +
      "<body><h1>Buy now and save $99 today</h1><a>Buy Now</a><p>contact us at test@example.com. privacy policy.</p></body></html>";
    const score = rescoreRewrittenHtml(html);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("pageTextExcerpt", () => {
  it("strips tags and caps length", () => {
    const text = pageTextExcerpt("<h1>Hi</h1><p>World</p>", 5);
    expect(text).not.toContain("<");
    expect(text.length).toBeLessThanOrEqual(5);
  });
});
