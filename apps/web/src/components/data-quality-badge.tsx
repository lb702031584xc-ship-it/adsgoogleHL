"use client";

import { useDict } from "@/i18n/use-dict";

/**
 * Data-quality badge (§35): every AI number on screen carries one of these.
 * OBSERVED (green) = measured from real data; PREDICTED (amber) = model/AI
 * output or assumptions; UNKNOWN (gray) = no data.
 */
export type DataQuality = "OBSERVED" | "PREDICTED" | "UNKNOWN";

const STYLES: Record<DataQuality, string> = {
  OBSERVED: "bg-green-100 text-green-800",
  PREDICTED: "bg-amber-100 text-amber-800",
  UNKNOWN: "bg-ink/10 text-ink/60",
};

export function DataQualityBadge({
  quality,
  className = "",
}: {
  quality: DataQuality;
  className?: string;
}) {
  const t = useDict();
  const d = t.ai.intel.dataQuality;
  const label =
    quality === "OBSERVED"
      ? d.observed
      : quality === "PREDICTED"
        ? d.predicted
        : d.unknown;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[quality]} ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * Coerce API dataQuality values to the three badge states. §35 lists more
 * granular kinds (ESTIMATED/INFERRED); they render as PREDICTED, never as
 * OBSERVED — predictions must not masquerade as measured data.
 */
export function normalizeDataQuality(q: unknown): DataQuality {
  if (q === "OBSERVED") return "OBSERVED";
  if (q === "PREDICTED" || q === "ESTIMATED" || q === "INFERRED")
    return "PREDICTED";
  return "UNKNOWN";
}
