"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";

export function OfferSelector({
  offers,
  selectedId,
}: {
  offers: Array<{ id: string; name: string }>;
  selectedId: string;
}) {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div className="mt-6 flex items-center gap-3">
      <label
        htmlFor="landing-offer-select"
        className="text-sm font-medium text-ink/70"
      >
        {t.entities.forms.offerSelector.label}
      </label>
      <select
        id="landing-offer-select"
        className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none"
        value={selectedId}
        onChange={(e) => {
          router.push(
            `/landing-pages?offerId=${encodeURIComponent(e.target.value)}`
          );
        }}
      >
        {offers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
