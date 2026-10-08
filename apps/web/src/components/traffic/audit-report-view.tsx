/**
 * Audit report presentational components (Phase 2).
 * Pure components — no data fetching — rendering straight from the
 * API response. All totals, source breakdowns, and attribution rows
 * are shown exactly as returned.
 */
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import type { AuditReport } from "@/lib/api/traffic-intel";
import { DataQualityBadge } from "@/components/data-quality-badge";

function mono(value: string | null | undefined) {
  return value ?? "—";
}

/* ---------- Totals ---------- */

export function AuditTotals({ report }: { report: AuditReport }) {
  const t = useDict();
  const d = t.ai.intel.traffic.audit;
  const cards: Array<[string, string]> = [
    [d.totals.clicks, String(report.totals.clicks)],
    [d.totals.conversions, String(report.totals.conversions)],
    [d.totals.commission, report.totals.commission],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map(([label, value]) => (
        <div
          key={label}
          className="rounded-xl border border-ink/10 bg-white px-4 py-3"
        >
          <p className="flex items-center gap-2 text-sm text-ink/55">
            {label}
            <DataQualityBadge quality="OBSERVED" />
          </p>
          <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------- Traffic sources ---------- */

export function TrafficSourcesTable({ report }: { report: AuditReport }) {
  const t = useDict();
  const d = t.ai.intel.traffic.audit;
  if (report.trafficSources.length === 0) {
    return <p className="text-sm text-ink/55">{d.empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-ink/55">
            <th className="px-4 py-2.5 font-medium">
              {d.trafficSourcesColumns.source}
            </th>
            <th className="px-4 py-2.5 font-medium">
              {d.trafficSourcesColumns.clicks}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {report.trafficSources.map((row) => (
            <tr key={row.source}>
              <td className="px-4 py-2.5 font-medium text-ink">{row.source}</td>
              <td className="px-4 py-2.5 text-ink">
                <span className="mr-2 font-mono">{row.clicks}</span>
                <DataQualityBadge quality="OBSERVED" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Attributions ---------- */

export function AttributionsTable({ report }: { report: AuditReport }) {
  const t = useDict();
  const d = t.ai.intel.traffic.audit;
  const c = d.attributionColumns;
  if (report.attributions.length === 0) {
    return <p className="text-sm text-ink/55">{d.empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-ink/55">
            <th className="px-4 py-2.5 font-medium">{c.timestamp}</th>
            <th className="px-4 py-2.5 font-medium">{c.conversionId}</th>
            <th className="px-4 py-2.5 font-medium">{c.clickId}</th>
            <th className="px-4 py-2.5 font-medium">{c.trackingLink}</th>
            <th className="px-4 py-2.5 font-medium">{c.trafficSource}</th>
            <th className="px-4 py-2.5 font-medium">{c.gclid}</th>
            <th className="px-4 py-2.5 font-medium">
              {c.value} / {c.currency}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {report.attributions.map((a) => (
            <tr key={a.conversionId}>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink/70">
                {formatDateTime(a.timestamp)}
              </td>
              <td className="max-w-40 truncate px-4 py-2.5 font-mono text-xs text-ink">
                {a.conversionId}
              </td>
              <td className="max-w-40 truncate px-4 py-2.5 font-mono text-xs text-ink/70">
                {a.clickId}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-ink/70">
                {a.trackingLinkPublicId}
              </td>
              <td className="px-4 py-2.5 text-ink/70">
                {mono(a.trafficSource)}
              </td>
              <td className="max-w-32 truncate px-4 py-2.5 font-mono text-xs text-ink/70">
                {mono(a.gclid)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink">
                {[a.value, a.currency].filter(Boolean).join(" ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Report context line ---------- */

export function AuditContext({ report }: { report: AuditReport }) {
  const t = useDict();
  const d = t.ai.intel.traffic.audit;
  const scope = [
    report.merchant?.name,
    report.offer?.name,
    d.period(report.period.from, report.period.to),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <p className="flex items-center gap-2 text-sm text-ink/60">
      <span>{scope}</span>
      <DataQualityBadge quality="OBSERVED" />
    </p>
  );
}
