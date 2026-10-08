/**
 * LanderDashboard: renders overall score, dimension bars with OBSERVED
 * badges, severity-colored issues, and PREDICTED AI suggestions.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LanderAnalysis } from "@/lib/api/lander";
import { LanderDashboard } from "@/components/ai/lander-client";

const analysis: LanderAnalysis = {
  id: "a1",
  url: "https://shop.example/product",
  domain: "shop.example",
  overallScore: 72.5,
  scores: {
    performance: 90,
    cta: 65,
    trust: 75,
    mobile: 100,
    copy: 80,
    bounceRisk: 30,
  },
  issues: [
    {
      dimension: "cta",
      severity: "high",
      message: "首屏未检测到明确的 CTA 按钮",
    },
    {
      dimension: "bounceRisk",
      severity: "medium",
      message: "检测到干扰元素",
    },
  ],
  suggestions: [
    { text: "在 H1 下方增加价格锚点", dataQuality: "PREDICTED" },
  ],
  analyzedAt: "2026-10-05T11:00:00.000Z",
};

function render(a: LanderAnalysis = analysis): string {
  return renderToStaticMarkup(createElement(LanderDashboard, { analysis: a }));
}

describe("LanderDashboard", () => {
  it("renders the overall score with an OBSERVED badge", () => {
    const html = render();
    expect(html).toContain("72.5");
    expect(html).toContain("Overall score");
    expect(html).toContain("Observed");
  });

  it("renders all six dimension bars with scores and OBSERVED badges", () => {
    const html = render();
    for (const label of [
      "Performance",
      "Call to action",
      "Trust",
      "Mobile",
      "Copy",
      "Bounce risk",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(">90<");
    expect(html).toContain(">100<");
  });

  it("renders issues with severity colors and labels", () => {
    const html = render();
    expect(html).toContain("Issues found");
    expect(html).toContain("High");
    expect(html).toContain("Medium");
    expect(html).toContain("bg-red-100");
    expect(html).toContain("bg-amber-100");
    expect(html).toContain("首屏未检测到明确的 CTA 按钮");
  });

  it("renders AI suggestions with a PREDICTED badge", () => {
    const html = render();
    expect(html).toContain("AI suggestions");
    expect(html).toContain("Predicted");
    expect(html).toContain("在 H1 下方增加价格锚点");
  });

  it("shows empty states when there are no issues or suggestions", () => {
    const html = render({ ...analysis, issues: [], suggestions: [] });
    expect(html).toContain("No significant issues found.");
    expect(html).toContain("No AI suggestions");
  });
});
