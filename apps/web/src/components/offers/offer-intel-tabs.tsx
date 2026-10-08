"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { PolicyTab } from "./policy-tab";
import { ProfitTab } from "./profit-tab";
import { RiskTab } from "./risk-tab";
import { DecisionTab } from "./decision-tab";

type TabKey = "policy" | "profit" | "risk" | "decision";

/**
 * Offer-intelligence tabs appended to the offer detail page.
 * Existing detail content above is untouched; these are purely additive.
 */
export function OfferIntelTabs({ offerId }: { offerId: string }) {
  const t = useDict();
  const d = t.ai.intel.tabs;
  const [active, setActive] = useState<TabKey>("policy");

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "policy", label: d.policy },
    { key: "profit", label: d.profit },
    { key: "risk", label: d.risk },
    { key: "decision", label: d.decision },
  ];

  return (
    <div className="mt-4">
      <div className="flex gap-1 border-b border-ink/10" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              active === tab.key
                ? "border-signal text-signal"
                : "border-transparent text-ink/55 hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="py-6">
        {active === "policy" ? <PolicyTab offerId={offerId} /> : null}
        {active === "profit" ? <ProfitTab offerId={offerId} /> : null}
        {active === "risk" ? <RiskTab offerId={offerId} /> : null}
        {active === "decision" ? <DecisionTab offerId={offerId} /> : null}
      </div>
    </div>
  );
}
