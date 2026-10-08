"use client";

import { useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import { useStrategyDict } from "./use-strategy-dict";
import {
  getCampaignPlanAction,
  runStrategyAction,
} from "@/lib/api/strategy-actions";
import { getOfferProfitAction } from "@/lib/api/offer-intel-actions";
import type { StrategyOutput } from "@/lib/api/strategy";
import type { ProfitModel } from "@/lib/api/offer-intel";
import {
  DecisionCard,
  ExperimentsCard,
  KillSwitchCard,
  PlanView,
  ProfitCard,
  ResearchCard,
  ScaleCard,
  TrafficCard,
} from "./strategy-sections";

export interface StrategyOfferOption {
  id: string;
  name: string;
  network: string;
}

/** Phase 5 one-stop strategy page: offer selector → full orchestration. */
export function StrategyClient({ offers }: { offers: StrategyOfferOption[] }) {
  const d = useStrategyDict();
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [output, setOutput] = useState<StrategyOutput | null>(null);
  const [profit, setProfit] = useState<ProfitModel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onGenerate() {
    if (!offerId) {
      setError(d.page.needOffer);
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const [strategyRes, profitRes] = await Promise.all([
        runStrategyAction(offerId),
        getOfferProfitAction(offerId),
      ]);
      if (!strategyRes.ok) {
        // Point the user at the missing-terms path when that's the cause.
        const hint =
          strategyRes.code === "NO_POLICY_DATA" ? ` ${d.page.noTermsHint}` : "";
        setError(`${strategyRes.error}${hint}`);
        return;
      }
      setOutput(strategyRes.data);
      setProfit(profitRes.ok ? profitRes.data : null);
    } finally {
      setGenerating(false);
    }
  }

  function onDownloadPlan() {
    if (!output) return;
    const blob = new Blob([JSON.stringify(output.campaignPlan, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-plan-${output.offerName
      .replace(/[^a-zA-Z0-9-_]+/g, "_")
      .slice(0, 60)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onRefreshPlan() {
    if (!offerId) return;
    const res = await getCampaignPlanAction(offerId);
    if (res.ok && output) {
      setOutput({ ...output, campaignPlan: res.data });
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <EntityPageHeader title={d.page.title} description={d.page.description} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className={labelClass} htmlFor="strategy-offer">
            {d.page.offerLabel}
          </label>
          <select
            id="strategy-offer"
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
          >
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.network})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || !offerId}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50"
        >
          {generating ? d.page.generating : d.page.generate}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {output ? (
          <>
            <DecisionCard decision={output.decision} dict={d} />
            <ProfitCard model={profit} dict={d} />
            <TrafficCard traffic={output.traffic} dict={d} />
            <ExperimentsCard experiments={output.experiments} dict={d} />
            <KillSwitchCard killSwitch={output.killSwitch} dict={d} />
            <ResearchCard research={output.research} dict={d} />
            <PlanView
              plan={output.campaignPlan}
              dict={d}
              onDownload={onDownloadPlan}
            />
            <ScaleCard scale={output.scaleRecommendation} dict={d} />
            <button
              type="button"
              onClick={onRefreshPlan}
              className="text-sm text-ink/60 underline hover:text-ink"
            >
              {d.plan.title} · ↻
            </button>
          </>
        ) : !error ? (
          <p className="text-sm text-ink/55">{d.page.noResult}</p>
        ) : null}
      </div>
    </div>
  );
}
