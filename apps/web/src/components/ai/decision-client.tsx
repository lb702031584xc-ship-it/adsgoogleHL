"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { requestOfferDecisionAction } from "@/lib/api/offer-intel-actions";
import type { OfferDecision } from "@/lib/api/offer-intel";
import { DecisionView } from "@/components/decision/decision-view";

export interface DecisionOfferOption {
  id: string;
  name: string;
  network: string;
}

/** §32 unified decision page: pick an offer, generate, render DecisionView. */
export function DecisionClient({ offers }: { offers: DecisionOfferOption[] }) {
  const t = useDict();
  const d = t.ai.intel.decision;
  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [decision, setDecision] = useState<OfferDecision | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onGenerate() {
    if (!offerId) {
      setError(d.needOffer);
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await requestOfferDecisionAction(offerId);
      if (res.ok) setDecision(res.data);
      else setError(res.error);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <EntityPageHeader title={d.title} description={d.description} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className={labelClass} htmlFor="decision-offer">
            {d.offerLabel}
          </label>
          <select
            id="decision-offer"
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
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {generating ? d.generating : d.generate}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {decision ? (
          <DecisionView
            decision={decision}
            offerId={offerId}
            showActions
          />
        ) : !error ? (
          <p className="text-sm text-ink/55">{d.noDecision}</p>
        ) : null}
      </div>
    </div>
  );
}
