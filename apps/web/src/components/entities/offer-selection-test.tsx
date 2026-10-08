"use client";

import { useState, useTransition } from "react";
import { selectOfferAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

export function OfferSelectionTest({
  trackingLinkId,
}: {
  trackingLinkId: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    selectedOfferId: string | null;
    selectedLandingPageId?: string | null;
    reason?: string;
    fallbackUsed?: boolean;
  } | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.offerSelectionTest;

  function onTest() {
    if (pending) return;
    setError(null);
    setResult(null);
    start(async () => {
      const res = await selectOfferAction(trackingLinkId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        selectedOfferId: res.data.selectedOfferId,
        selectedLandingPageId: res.data.selectedLandingPageId,
        reason: res.data.reason,
        fallbackUsed: res.data.fallbackUsed,
      });
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">
            {f.title}
          </h3>
          <p className="mt-1 text-sm text-ink/60">{f.description}</p>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? f.testing : f.runTest}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {result ? (
        <dl className="mt-4 grid grid-cols-[160px_1fr] gap-3 rounded-lg bg-ink/[0.03] p-4 text-sm">
          <dt className="font-medium text-ink/55">{f.selectedOffer}</dt>
          <dd className="break-all font-mono text-[13px] text-ink">
            {result.selectedOfferId ?? "—"}
          </dd>
          <dt className="font-medium text-ink/55">{f.landingPage}</dt>
          <dd className="break-all font-mono text-[13px] text-ink">
            {result.selectedLandingPageId ?? "—"}
          </dd>
          <dt className="font-medium text-ink/55">{f.reason}</dt>
          <dd className="text-ink">{result.reason ?? "—"}</dd>
          <dt className="font-medium text-ink/55">{f.fallbackUsed}</dt>
          <dd className="text-ink">
            {result.fallbackUsed ? t.common.misc.yes : t.common.misc.no}
          </dd>
        </dl>
      ) : null}
    </div>
  );
}
