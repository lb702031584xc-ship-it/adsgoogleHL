/**
 * Research Lab pure view components.
 * Render straight from API-shaped data; take the research dict explicitly
 * (no useDict — keeps them usable from server components and unit tests).
 */
import type {
  ResearchBand,
  ResearchTestStatus,
  ResearchVariantPreset,
  ResearchTestSummary,
  ResearchRequestVariant,
} from "@/lib/api/research";
import type { ResearchDict } from "@/i18n/dict/research";

/** Row shape for the response comparison table (view concern). */
export interface ResearchVariantResult {
  name: string;
  status: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectCount: number | null;
  contentHash: string | null;
}

/** Variant presets offered by the /research/new form (client-safe). */
export const RESEARCH_VARIANT_PRESETS: ResearchVariantPreset[] = [
  "DEFAULT",
  "BOT_VS_HUMAN",
  "GEO_VARIANTS",
  "DEVICE_VARIANTS",
];

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const BOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/**
 * Map a preset to raw request-variant configs for POST /api/v1/research/tests.
 * DEFAULT returns undefined -> the API uses its desktop/mobile x US/DE set.
 */
export function presetVariants(
  preset: ResearchVariantPreset
): ResearchRequestVariant[] | undefined {
  const en = "en-US,en;q=0.9";
  switch (preset) {
    case "DEFAULT":
      return undefined;
    case "BOT_VS_HUMAN":
      return [
        { name: "bot", userAgent: BOT_UA, acceptLanguage: en },
        { name: "human-desktop", userAgent: DESKTOP_UA, acceptLanguage: en },
      ];
    case "GEO_VARIANTS":
      return [
        { name: "desktop-us", userAgent: DESKTOP_UA, acceptLanguage: en },
        { name: "desktop-de", userAgent: DESKTOP_UA, acceptLanguage: "de-DE,de;q=0.9" },
        { name: "desktop-fr", userAgent: DESKTOP_UA, acceptLanguage: "fr-FR,fr;q=0.9" },
        { name: "desktop-jp", userAgent: DESKTOP_UA, acceptLanguage: "ja-JP,ja;q=0.9" },
      ];
    case "DEVICE_VARIANTS":
      return [
        { name: "desktop", userAgent: DESKTOP_UA, acceptLanguage: en },
        { name: "mobile", userAgent: MOBILE_UA, acceptLanguage: en },
      ];
  }
}

/** Warning strip: findings are research-only, never production signals. */
export function ResearchBanner({ dict }: { dict: ResearchDict }) {
  return (
    <div
      role="note"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      {dict.banner}
    </div>
  );
}

const BAND_STYLES: Record<ResearchBand, string> = {
  NORMAL: "bg-green-100 text-green-800",
  MINOR: "bg-sky-100 text-sky-800",
  SUSPICIOUS: "bg-amber-100 text-amber-800",
  HIGH_RISK: "bg-red-100 text-red-800",
  STRONG: "bg-purple-100 text-purple-800",
};

export function bandLabel(band: ResearchBand, dict: ResearchDict): string {
  return dict.band[band];
}

/** Band badge (five differentiation bands). */
export function BandBadge({
  band,
  dict,
}: {
  band: ResearchBand | null;
  dict: ResearchDict;
}) {
  if (!band) {
    return (
      <span className="inline-block rounded-full bg-ink/10 px-2.5 py-0.5 text-xs text-ink/60">
        —
      </span>
    );
  }
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BAND_STYLES[band]}`}
    >
      {bandLabel(band, dict)}
    </span>
  );
}

const BAND_ORDER: ResearchBand[] = [
  "NORMAL",
  "MINOR",
  "SUSPICIOUS",
  "HIGH_RISK",
  "STRONG",
];

/**
 * Differentiation score (0-100) + five band color blocks.
 * The active band's block (and all lower ones) is filled.
 */
export function ScoreBar({
  score,
  band,
  dict,
}: {
  score: number | null;
  band: ResearchBand | null;
  dict: ResearchDict;
}) {
  if (score == null) {
    return <p className="text-sm text-ink/50">{dict.detail.noScore}</p>;
  }
  const activeIdx = band ? BAND_ORDER.indexOf(band) : -1;
  return (
    <div>
      <p className="font-display text-4xl text-ink">
        {Math.round(score)}
        <span className="text-lg text-ink/50">/100</span>
      </p>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {BAND_ORDER.map((b, i) => (
          <div
            key={b}
            title={bandLabel(b, dict)}
            className={`h-2.5 flex-1 rounded-full ${
              i <= activeIdx ? BAND_STYLES[b].split(" ")[0] : "bg-ink/10"
            }`}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {BAND_ORDER.map((b, i) => (
          <span
            key={b}
            className={`flex-1 text-center text-[10px] ${
              i === activeIdx ? "font-semibold text-ink" : "text-ink/40"
            }`}
          >
            {bandLabel(b, dict)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Classification badge. The 8 classifier labels come from the Phase 4
 * classifier (apps/api/src/research/classifier.ts); known values get an
 * i18n label, unknown values pass through verbatim so new labels render
 * without a web change.
 */
export function ClassificationBadge({
  classification,
  dict,
}: {
  classification: string | null;
  dict: ResearchDict;
}) {
  if (!classification) {
    return <p className="text-sm text-ink/50">{dict.detail.noClassification}</p>;
  }
  const label =
    classification in dict.classification
      ? dict.classification[
          classification as keyof typeof dict.classification
        ]
      : classification;
  return (
    <span className="inline-block rounded-full bg-ink px-3 py-1 text-xs font-medium text-white">
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<ResearchTestStatus, string> = {
  PENDING: "bg-ink/10 text-ink/60",
  RUNNING: "bg-sky-100 text-sky-800",
  COMPLETED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

export function StatusBadge({
  status,
  dict,
}: {
  status: ResearchTestStatus;
  dict: ResearchDict;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {dict.status[status]}
    </span>
  );
}

/** Response comparison table: per-variant status / final URL / redirects / hash. */
export function VariantTable({
  variants,
  dict,
}: {
  variants: ResearchVariantResult[];
  dict: ResearchDict;
}) {
  if (variants.length === 0) {
    return <p className="text-sm text-ink/50">{dict.detail.noVariants}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/15">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-ink/5 text-left text-xs uppercase tracking-wide text-ink/60">
            <th className="px-3 py-2">{dict.detail.variant}</th>
            <th className="px-3 py-2">{dict.detail.variantStatus}</th>
            <th className="px-3 py-2">{dict.detail.finalUrl}</th>
            <th className="px-3 py-2">{dict.detail.redirects}</th>
            <th className="px-3 py-2">{dict.detail.contentHash}</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.name} className="border-t border-ink/10">
              <td className="px-3 py-2 font-medium text-ink">{v.name}</td>
              <td className="px-3 py-2 text-ink/70">
                {v.httpStatus != null ? `${v.status} (${v.httpStatus})` : v.status}
              </td>
              <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-ink/70">
                {v.finalUrl ?? "—"}
              </td>
              <td className="px-3 py-2 text-ink/70">
                {v.redirectCount != null ? v.redirectCount : "—"}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-ink/70">
                {v.contentHash ? v.contentHash.slice(0, 16) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Research test list table. */
export function ResearchListView({
  items,
  dict,
  hrefFor,
}: {
  items: ResearchTestSummary[];
  dict: ResearchDict;
  /** When given, the name cell renders as a link (detail navigation). */
  hrefFor?: (id: string) => string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink/50">{dict.list.empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/15 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-ink/5 text-left text-xs uppercase tracking-wide text-ink/60">
            <th className="px-3 py-2">{dict.list.name}</th>
            <th className="px-3 py-2">{dict.list.targetUrl}</th>
            <th className="px-3 py-2">{dict.list.status}</th>
            <th className="px-3 py-2">{dict.list.score}</th>
            <th className="px-3 py-2">{dict.list.band}</th>
            <th className="px-3 py-2">{dict.list.createdAt}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-t border-ink/10">
              <td className="px-3 py-2 font-medium text-ink">
                {hrefFor ? (
                  <a
                    href={hrefFor(t.id)}
                    className="text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                  >
                    {t.name || t.id.slice(0, 8)}
                  </a>
                ) : (
                  t.name || t.id.slice(0, 8)
                )}
              </td>
              <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-ink/70">
                {t.targetUrl}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={t.status} dict={dict} />
              </td>
              <td className="px-3 py-2 text-ink/80">
                {t.score != null ? Math.round(t.score) : "—"}
              </td>
              <td className="px-3 py-2">
                <BandBadge band={t.band} dict={dict} />
              </td>
              <td className="px-3 py-2 text-xs text-ink/60">
                {t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
