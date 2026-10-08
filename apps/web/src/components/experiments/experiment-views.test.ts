/**
 * Experiment view components (Phase 3): pure components render straight
 * from API-shaped data. Uses the English experiment dictionary directly
 * (does not depend on the aggregated dictionaries.ts).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en as dict } from "@/i18n/dict/experiment";
import {
  ExperimentListView,
  MetricsCompareTable,
  PreconditionList,
  StatusBadge,
  VariantCard,
  WinnerBadge,
  WinnerPanel,
} from "@/components/experiments/experiment-views";
import type { Experiment } from "@/lib/api/experiments";

function sampleExperiment(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "exp-1",
    tenantId: "t-1",
    offerId: "offer-1",
    name: "LP vs 直链",
    status: "COMPLETED",
    variantA: {
      type: "LANDING_PAGE",
      trackingLinkId: "tl-a",
      label: "落地页",
    },
    variantB: {
      type: "DIRECT_LINK",
      trackingLinkId: "tl-b",
      label: "直链",
    },
    trafficSplitA: 50,
    splitSeed: "abcdef0123456789abcdef0123456789",
    metricsA: { clicks: 1000, cvr: 0.05, profit: 320 },
    metricsB: { clicks: 1000, cvr: 0.04, profit: 180 },
    winner: "A",
    confidence: 0.97,
    preconditionCheck: {
      passedAt: "2026-10-05T08:00:00.000Z",
      policyId: "pol-1",
      directLinkRule: "ALLOWED",
      trafficSplitA: 50,
      checks: [
        { check: "policy_scan", passed: true, detail: "policy ok" },
        { check: "direct_link_policy_B", passed: true, detail: "direct ok" },
      ],
    },
    startedAt: "2026-10-05T07:00:00.000Z",
    endedAt: "2026-10-05T09:00:00.000Z",
    createdAt: "2026-10-05T06:00:00.000Z",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...over,
  };
}

describe("experiment list view", () => {
  it("renders rows with status and winner badges", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentListView, {
        items: [sampleExperiment()],
        dict,
      })
    );
    expect(html).toContain("LP vs 直链");
    expect(html).toContain(dict.status.COMPLETED);
    expect(html).toContain(dict.winnerLabel.A);
    expect(html).toContain("/experiments/exp-1");
  });

  it("renders the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(ExperimentListView, { items: [], dict })
    );
    expect(html).toContain(dict.list.empty);
  });
});

describe("experiment detail views", () => {
  it("renders variant cards with type labels and traffic share", () => {
    const e = sampleExperiment();
    const html = renderToStaticMarkup(
      createElement("div", null,
        createElement(VariantCard, {
          side: "A",
          variant: e.variantA,
          trafficShare: 50,
          dict,
        }),
        createElement(VariantCard, {
          side: "B",
          variant: e.variantB,
          trafficShare: 50,
          dict,
        })
      )
    );
    expect(html).toContain(dict.variantType.LANDING_PAGE);
    expect(html).toContain(dict.variantType.DIRECT_LINK);
    expect(html).toContain("tl-a");
  });

  it("renders the metrics comparison table", () => {
    const html = renderToStaticMarkup(
      createElement(MetricsCompareTable, {
        experiment: sampleExperiment(),
        dict,
      })
    );
    expect(html).toContain(dict.detail.field.profit);
    expect(html).toContain("320");
    expect(html).toContain("180");
  });

  it("renders winner panel with confidence", () => {
    const html = renderToStaticMarkup(
      createElement(WinnerPanel, { experiment: sampleExperiment(), dict })
    );
    expect(html).toContain(dict.winnerLabel.A);
    expect(html).toContain("97%");
  });

  it("hides the winner panel when not completed", () => {
    const html = renderToStaticMarkup(
      createElement(WinnerPanel, {
        experiment: sampleExperiment({ status: "RUNNING", winner: null }),
        dict,
      })
    );
    expect(html).toBe("");
  });

  it("renders precondition check evidence", () => {
    const html = renderToStaticMarkup(
      createElement(PreconditionList, {
        experiment: sampleExperiment(),
        dict,
      })
    );
    expect(html).toContain(dict.detail.precondition);
    expect(html).toContain("policy ok");
  });

  it("badges cover all statuses and undecided winner", () => {
    const draft = renderToStaticMarkup(
      createElement(StatusBadge, { status: "DRAFT", dict })
    );
    expect(draft).toContain(dict.status.DRAFT);
    const running = renderToStaticMarkup(
      createElement(StatusBadge, { status: "RUNNING", dict })
    );
    expect(running).toContain(dict.status.RUNNING);
    const undecided = renderToStaticMarkup(
      createElement(WinnerBadge, { winner: null, dict })
    );
    expect(undecided).toContain(dict.winnerLabel.none);
  });
});
