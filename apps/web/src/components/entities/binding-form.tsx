"use client";

import { useState, useTransition, type FormEvent } from "react";
import { replaceTrackingLinkBindingsAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

const inputClassName =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClassName = "mb-1 block text-sm font-medium text-ink/70";

export interface BindingInput {
  offerId: string;
  priority?: number;
  isFallback?: boolean;
}

export function BindingForm({
  trackingLinkId,
  bindings,
}: {
  trackingLinkId: string;
  bindings: BindingInput[];
}) {
  const [pending, start] = useTransition();
  const [offerId, setOfferId] = useState("");
  const [priority, setPriority] = useState("100");
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.binding;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !offerId.trim()) return;
    setError(null);
    const priorityNum = Number(priority);
    const next: BindingInput[] = [
      ...bindings,
      {
        offerId: offerId.trim(),
        priority: Number.isFinite(priorityNum) ? Math.floor(priorityNum) : 100,
        isFallback,
      },
    ];
    start(async () => {
      const result = await replaceTrackingLinkBindingsAction(
        trackingLinkId,
        next
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOfferId("");
      setPriority("100");
      setIsFallback(false);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm"
    >
      <h3 className="font-display text-lg font-semibold text-ink">
        {f.title}
      </h3>
      <p className="mt-1 text-sm text-ink/60">{f.description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <div>
          <label htmlFor="binding-offer" className={labelClassName}>
            {f.offerId} *
          </label>
          <input
            id="binding-offer"
            className={`${inputClassName} font-mono`}
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            placeholder={f.offerIdPlaceholder}
          />
        </div>
        <div>
          <label htmlFor="binding-priority" className={labelClassName}>
            {f.priority}
          </label>
          <input
            id="binding-priority"
            type="number"
            className={inputClassName}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm font-medium text-ink/70">
          <input
            type="checkbox"
            checked={isFallback}
            onChange={(e) => setIsFallback(e.target.checked)}
            className="h-4 w-4 rounded border-ink/20 accent-signal"
          />
          {f.fallback}
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !offerId.trim()}
        className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending ? f.adding : f.submit}
      </button>
    </form>
  );
}
