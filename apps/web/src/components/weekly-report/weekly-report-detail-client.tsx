"use client";

import Link from "next/link";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as weeklyReportZh, en as weeklyReportEn } from "@/i18n/dict/weekly-report";
import type { WeeklyReportRow } from "@/lib/api/weekly-report-actions";

/** Automation round 2 — weekly report detail: metric cards + top offers + AI narrative. */
export function WeeklyReportDetailClient({
  report,
}: {
  report: WeeklyReportRow;
}) {
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d = lang === "en" ? weeklyReportEn : weeklyReportZh;
  const data = report.data;

  const cards: Array<{ label: string; value: string }> = [
    { label: d.detail.clicks, value: String(data.clicks) },
    { label: d.detail.conversions, value: String(data.conversions) },
    { label: d.detail.revenue, value: data.revenue.toFixed(2) },
    {
      label: d.detail.spend,
      value: data.spend == null ? d.detail.spendMissing : data.spend.toFixed(2),
    },
    { label: d.detail.alerts, value: String(data.alerts) },
    { label: d.detail.deadLinks, value: String(data.deadLinks) },
    { label: d.detail.newNegatives, value: String(data.newNegatives) },
    { label: d.detail.newTasks, value: String(data.newTasks) },
  ];

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.detail.title}
        description={`${formatDateTime(report.weekStart)} ~ ${formatDateTime(report.weekEnd)}`}
        actions={
          <Link
            href="/reports/weekly"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink/5"
          >
            {d.detail.back}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-ink/10 bg-white px-4 py-3"
          >
            <div className="text-xs text-ink/60">{c.label}</div>
            <div className="mt-1 text-xl font-semibold text-ink">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-ink/10 bg-white">
        <div className="border-b border-ink/10 px-4 py-3 font-medium text-ink">
          {d.detail.topOffers}
        </div>
        {data.topOffers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-ink/60">—</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">Offer</th>
                  <th className="px-3 py-2">{d.detail.offerClicks}</th>
                  <th className="px-3 py-2">{d.detail.offerConversions}</th>
                  <th className="px-3 py-2">{d.detail.offerRevenue}</th>
                  <th className="px-3 py-2">{d.detail.prevRevenue}</th>
                </tr>
              </thead>
              <tbody>
                {data.topOffers.map((o) => (
                  <tr
                    key={o.offerId ?? o.offerName}
                    className="border-t border-ink/10"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{o.offerName}</div>
                      {o.network && (
                        <div className="text-xs text-ink/50">{o.network}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink/70">{o.clicks}</td>
                    <td className="px-3 py-2 text-ink/70">{o.conversions}</td>
                    <td className="px-3 py-2 text-ink/70">
                      {o.revenue.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-ink/70">
                      {o.prevRevenue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-ink/10 bg-white">
        <div className="border-b border-ink/10 px-4 py-3 font-medium text-ink">
          {d.detail.aiSummaryTitle}
        </div>
        <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-ink/90">
          {report.aiSummary}
        </div>
      </div>
    </div>
  );
}
