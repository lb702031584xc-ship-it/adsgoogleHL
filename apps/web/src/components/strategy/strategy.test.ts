/**
 * Strategy sections: decision/plan/research/scale render with English copy
 * in isolated renders (useStrategyDict degrades gracefully when
 * t.strategy is not registered in the aggregated dictionary).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignPlan,
  ResearchResult,
  ScaleRecommendation,
  StrategyDecision,
} from "@/lib/api/strategy";
import { en as strategyEn } from "@/i18n/dict/strategy";
import {
  DecisionCard,
  PlanView,
  ResearchCard,
  ScaleCard,
} from "@/components/strategy/strategy-sections";

const decision: StrategyDecision = {
  decision: "RUN",
  riskScore: 20,
  profitScore: 80,
  policyScore: 90,
  breakEvenCpc: 0.6,
  recommendedMaxCpc: 0.42,
  trafficMode: "LANDING_PAGE",
  directLink: false,
  confidence: 0.85,
  reason: ["Paid search allowed by terms."],
  manualChecks: ["Confirm terms before launch."],
  dataQuality: "PREDICTED",
};

const plan: CampaignPlan = {
  offerId: "offer-1",
  offerName: "Acme Shoes",
  trafficMode: "LANDING_PAGE",
  campaigns: [
    {
      name: "Acme Shoes — Search",
      trafficMode: "LANDING_PAGE",
      adGroups: [
        {
          name: "Exact match",
          matchType: "EXACT",
          keywords: [
            {
              text: "cheap running shoes",
              matchType: "EXACT",
              suggestedBid: 0.42,
              dataQuality: "OBSERVED",
            },
          ],
        },
        {
          name: "Phrase match",
          matchType: "PHRASE",
          keywords: [
            {
              text: "buy shoes online",
              matchType: "PHRASE",
              suggestedBid: 0.42,
              dataQuality: "PREDICTED",
            },
          ],
        },
      ],
    },
  ],
  negatives: {
    exact: ["[acme shoes]"],
    phrase: ['"acme shoes"'],
    dataQuality: "PREDICTED",
  },
  budget: {
    dailyBudget: 7.14,
    totalTestBudget: 50,
    budgetByScenario: { worst: 40, base: 50, best: 60 },
    breakEvenCpc: 0.6,
    recommendedMaxCpc: 0.42,
    dataQuality: "OBSERVED",
    reason: [],
    currency: "USD",
  },
  notes: ["Planning document only."],
  dataQuality: "OBSERVED",
  generatedAt: "2026-10-05T00:00:00.000Z",
};

const noDataResearch: ResearchResult = {
  status: "NO_DATA",
  score: null,
  band: null,
  classification: null,
  summary: "Phase 4 research is not available yet (NO_DATA).",
};

const scale: ScaleRecommendation = {
  eligible: true,
  multiplier: 1.5,
  currentDailyBudget: 7.14,
  suggestedDailyBudget: 10.71,
  reason: ["Base scenario projects profit."],
  dataQuality: "OBSERVED",
  note: "Advisory only.",
};

describe("DecisionCard", () => {
  it("renders the verdict label, confidence and scores", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionCard, { decision, dict: strategyEn })
    );
    expect(html).toContain("Run");
    expect(html).toContain("85%");
    expect(html).toContain("Paid search allowed by terms.");
    expect(html).toContain("Confirm terms before launch.");
    expect(html).toContain("0.42");
  });
});

describe("PlanView", () => {
  it("renders keyword hierarchy with match syntax, bids and negatives", () => {
    const html = renderToStaticMarkup(
      createElement(PlanView, {
        plan,
        dict: strategyEn,
        onDownload: () => {},
      })
    );
    expect(html).toContain("[cheap running shoes]");
    expect(html).toContain("&quot;buy shoes online&quot;");
    expect(html).toContain("0.42");
    expect(html).toContain("[acme shoes]");
    expect(html).toContain("Download JSON");
    expect(html).toContain("Planning document only.");
    // Data-quality badges ride along on keywords and budget.
    expect(html).toContain("Observed");
    expect(html).toContain("Predicted");
  });
});

describe("ResearchCard", () => {
  it("shows the graceful NO_DATA state", () => {
    const html = renderToStaticMarkup(
      createElement(ResearchCard, { research: noDataResearch, dict: strategyEn })
    );
    expect(html).toContain("No research findings yet");
    expect(html).toContain("not available yet");
  });
});

describe("ScaleCard", () => {
  it("renders eligible scale advice with suggested budget", () => {
    const html = renderToStaticMarkup(
      createElement(ScaleCard, { scale, dict: strategyEn })
    );
    expect(html).toContain("10.71");
    expect(html).toContain("Advisory only");
  });

  it("renders nothing when there is no recommendation", () => {
    const html = renderToStaticMarkup(
      createElement(ScaleCard, { scale: null, dict: strategyEn })
    );
    expect(html).toBe("");
  });
});
