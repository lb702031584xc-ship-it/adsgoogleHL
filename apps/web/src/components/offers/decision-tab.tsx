"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { requestOfferDecisionAction } from "@/lib/api/offer-intel-actions";
import type { OfferDecision } from "@/lib/api/offer-intel";
import { DecisionView } from "@/components/decision/decision-view";

/** Decision tab: generate the §32 unified decision, then show actions. */
export function DecisionTab({ offerId }: { offerId: string }) {
  const t = useDict();
  const d = t.ai.intel.decision;
  const [decision, setDecision] = useState<OfferDecision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await requestOfferDecisionAction(offerId);
      if (res.ok) setDecision(res.data);
      else setError(res.error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
  }, [offerId]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">{d.title}</h3>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
        >
          {loading ? d.generating : d.regenerate}
        </button>
      </div>
      <p className="mt-1 text-sm text-ink/60">{d.description}</p>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/55">{d.generating}</p>
        ) : decision ? (
          <DecisionView decision={decision} offerId={offerId} showActions />
        ) : (
          <p className="text-sm text-ink/55">{d.noDecision}</p>
        )}
      </div>
    </div>
  );
}
