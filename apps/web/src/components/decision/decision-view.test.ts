/**
 * DecisionView: all four decision badges render with their label + color,
 * and the full §32 output is visible.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DecisionView,
  decisionBadgeClass,
} from "@/components/decision/decision-view";
import type {
  DecisionValue,
  OfferDecision,
} from "@/lib/api/offer-intel";

function sampleDecision(decision: DecisionValue): OfferDecision {
  return {
    decision,
    riskScore: 24,
    profitScore: 82,
    policyScore: 94,
    breakEvenCpc: 1.43,
    recommendedMaxCpc: 1.05,
    trafficMode: "LANDING_PAGE",
    directLink: false,
    confidence: 0.91,
    reason: ["Paid search allowed", "US traffic allowed"],
    manualChecks: ["Confirm current affiliate terms before launch"],
    dataQuality: "PREDICTED",
  };
}

const CASES: Array<[DecisionValue, string, string]> = [
  ["RUN", "RUN", "bg-green-100"],
  ["TEST", "TEST", "bg-blue-100"],
  ["MANUAL_REVIEW", "Manual review", "bg-amber-100"],
  ["DO_NOT_RUN", "DO NOT RUN", "bg-red-100"],
];

describe("decisionBadgeClass", () => {
  it.each(CASES)("%s maps to %s", (decision) => {
    const cls = decisionBadgeClass(decision);
    expect(cls).not.toBe("");
  });
});

describe("DecisionView", () => {
  it.each(CASES)(
    "renders the %s badge with its color",
    (decision, label, colorClass) => {
      const html = renderToStaticMarkup(
        createElement(DecisionView, {
          decision: sampleDecision(decision),
          offerId: "offer-1",
        })
      );
      expect(html).toContain(label);
      expect(html).toContain(colorClass);
    }
  );

  it("renders all §32 fields: scores, CPCs, traffic mode, confidence, lists", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionView, {
        decision: sampleDecision("TEST"),
        offerId: "offer-1",
      })
    );
    expect(html).toContain("Risk score");
    expect(html).toContain("Profit score");
    expect(html).toContain("Policy score");
    expect(html).toContain("Break-even CPC");
    expect(html).toContain("Recommended max CPC");
    expect(html).toContain("Traffic mode");
    expect(html).toContain("Landing page");
    expect(html).toContain("Confidence");
    expect(html).toContain("Paid search allowed");
    expect(html).toContain("Confirm current affiliate terms before launch");
    // data-quality badge for the predicted decision
    expect(html).toContain("Predicted");
  });

  it("renders approve/pause buttons when showActions is set", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionView, {
        decision: sampleDecision("TEST"),
        offerId: "offer-1",
        showActions: true,
      })
    );
    expect(html).toContain("Approve");
    expect(html).toContain("Pause");
  });

  it("hides approve/pause buttons by default", () => {
    const html = renderToStaticMarkup(
      createElement(DecisionView, {
        decision: sampleDecision("TEST"),
        offerId: "offer-1",
      })
    );
    expect(html).not.toContain("Approve");
  });
});
