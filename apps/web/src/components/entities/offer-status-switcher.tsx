"use client";

import { useState, useTransition } from "react";
import { changeOfferStatusAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

const STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

export function OfferStatusSwitcher({
  offerId,
  current,
}: {
  offerId: string;
  current: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.offerStatusSwitcher;

  function onChange(status: string) {
    if (pending || status === current) return;
    setError(null);
    start(async () => {
      const result = await changeOfferStatusAction(offerId, status);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink/60">{f.changeStatus}</span>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending || s === current}
            onClick={() => onChange(s)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              s === current
                ? "bg-ink text-white"
                : "border border-ink/15 bg-white/70 hover:bg-white"
            }`}
          >
            {s}
          </button>
        ))}
        {pending ? (
          <span className="text-sm text-ink/50">{f.updating}</span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
