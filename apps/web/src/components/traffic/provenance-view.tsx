/**
 * Provenance report presentational components (Phase 2).
 * Pure components — no data fetching, no hooks beyond useDict —
 * so they render with `renderToStaticMarkup` in tests.
 * Every source/attribution figure on screen comes straight from the
 * API response; nothing here is computed or "beautified".
 */
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import type {
  ProvenanceReport,
  TrafficEventDto,
  TrafficEventType,
} from "@/lib/api/traffic-intel";
import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";

/* ---------- Event type badges ---------- */

const EVENT_TYPE_STYLES: Record<TrafficEventType, string> = {
  AD_CLICK: "bg-sky-100 text-sky-800",
  LANDING_PAGE_VIEW: "bg-indigo-100 text-indigo-800",
  AFFILIATE_CLICK: "bg-violet-100 text-violet-800",
  MERCHANT_VISIT: "bg-teal-100 text-teal-800",
  CONVERSION: "bg-emerald-100 text-emerald-800",
  COMMISSION: "bg-amber-100 text-amber-800",
};

export function eventTypeBadgeClass(eventType: TrafficEventType): string {
  return EVENT_TYPE_STYLES[eventType];
}

function mono(value: string | null | undefined) {
  return value ?? "—";
}

function namedRef(ref: { name: string } | null) {
  return ref ? ref.name : "—";
}

/* ---------- Summary chain ---------- */

/**
 * One-line chain overview: traffic source → campaign → ad group → ad →
 * click → tracking link → offer → merchant → conversion → commission.
 */
export function ProvenanceSummary({
  report,
}: {
  report: ProvenanceReport;
}) {
  const t = useDict();
  const d = t.ai.intel.traffic.provenance;
  const f = d.fields;
  const s = report.summary;

  const rows: Array<[string, string]> = [
    [f.trafficSource, mono(s.trafficSource)],
    [f.trafficMedium, mono(s.trafficMedium)],
    [f.campaign, namedRef(s.campaign)],
    [f.adGroup, namedRef(s.adGroup)],
    [f.ad, namedRef(s.ad)],
    [f.keyword, mono(s.keyword)],
    [f.clickId, s.clickId],
    [f.landingPage, s.landingPage ? s.landingPage.url : "—"],
    [f.trackingLink, s.trackingLink.publicId],
    [f.offer, namedRef(s.offer)],
    [f.merchant, namedRef(s.merchant)],
    [
      f.conversion,
      `${s.conversion.action} · ${formatDateTime(s.conversion.time)}`,
    ],
    [f.value, mono(s.conversion.value)],
    [f.currency, mono(s.conversion.currency)],
    [f.status, s.conversion.status],
    [
      f.commission,
      s.commission && (s.commission.value || s.commission.currency)
        ? [s.commission.value, s.commission.currency].filter(Boolean).join(" ")
        : "—",
    ],
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <dl className="divide-y divide-ink/10">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2.5"
          >
            <dt className="text-sm text-ink/55">{label}</dt>
            <dd className="flex items-center gap-2 text-sm font-medium text-ink">
              <span className="break-all font-mono text-[13px]">{value}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-ink/10 px-4 py-2.5 text-xs text-ink/50">
        {d.generatedAt(formatDateTime(report.generatedAt))}
      </p>
    </div>
  );
}

/* ---------- Event timeline ---------- */

export function EventNode({ event }: { event: TrafficEventDto }) {
  const t = useDict();
  const d = t.ai.intel.traffic.provenance;
  const l = d.eventLabels;
  const flow =
    event.source || event.destination
      ? `${mono(event.source)} → ${mono(event.destination)}`
      : "—";

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      <div className="flex flex-col items-center">
        <span className="mt-1 h-3 w-3 rounded-full bg-signal" aria-hidden />
        <span className="w-px flex-1 bg-ink/15" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-ink/10 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${eventTypeBadgeClass(
              event.eventType
            )}`}
          >
            {d.eventTypes[event.eventType] ?? event.eventType}
          </span>
          <DataQualityBadge quality={normalizeDataQuality(event.dataQuality)} />
          <span className="text-xs text-ink/50">
            {l.time}: {formatDateTime(event.timestamp)}
          </span>
        </div>
        <p className="mt-2 break-all text-sm text-ink/80">{flow}</p>
        <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs text-ink/60">
          <dt>{l.clickId}</dt>
          <dd className="break-all font-mono">{mono(event.clickId)}</dd>
          <dt>{l.conversionId}</dt>
          <dd className="break-all font-mono">{mono(event.conversionId)}</dd>
          <dt>{l.trackingLinkId}</dt>
          <dd className="break-all font-mono">{mono(event.trackingLinkId)}</dd>
        </dl>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-signal hover:underline">
            {l.metadata}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-ink/5 p-2 font-mono text-[11px] text-ink/75">
            {JSON.stringify(event.metadata ?? {}, null, 2)}
          </pre>
        </details>
      </div>
    </li>
  );
}

export function EventTimeline({ events }: { events: TrafficEventDto[] }) {
  const t = useDict();
  const d = t.ai.intel.traffic.provenance;
  if (events.length === 0) {
    return <p className="text-sm text-ink/55">{d.noChain}</p>;
  }
  return (
    <ol>
      {events.map((event) => (
        <EventNode key={event.id} event={event} />
      ))}
    </ol>
  );
}

/* ---------- Policy evidence ---------- */

export function PolicyEvidenceList({
  evidence,
}: {
  evidence: ProvenanceReport["policyEvidence"];
}) {
  const t = useDict();
  const d = t.ai.intel.traffic.provenance.evidenceLabels;
  if (evidence.length === 0) {
    return <p className="text-sm text-ink/55">{d.noEvidence}</p>;
  }
  return (
    <ul className="space-y-3">
      {evidence.map((e, i) => (
        <li
          key={`${e.rule}-${i}`}
          className="rounded-xl border border-ink/10 bg-white px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-ink/10 px-2 py-0.5 font-mono text-xs font-semibold text-ink">
              {e.rule}
            </span>
            <span className="text-xs text-ink/55">
              {d.confidence}: {e.confidence}
            </span>
          </div>
          <blockquote className="mt-2 border-l-2 border-signal pl-3 text-sm text-ink/80">
            {e.matchedText}
          </blockquote>
        </li>
      ))}
    </ul>
  );
}
