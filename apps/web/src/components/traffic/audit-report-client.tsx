"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader, SectionTitle } from "@/components/entities/ui";
import { getAuditReportAction } from "@/lib/api/traffic-intel-actions";
import {
  downloadJson,
  getAuditReportExportUrl,
} from "@/lib/api/traffic-export";
import type {
  AuditReport,
  AuditReportParams,
} from "@/lib/api/traffic-intel";
import {
  AttributionsTable,
  AuditContext,
  AuditTotals,
  TrafficSourcesTable,
} from "@/components/traffic/audit-report-view";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const buttonClass =
  "rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50";

/** Traffic audit report: filters + totals + sources + attributions + exports. */
export function AuditReportClient() {
  const t = useDict();
  const d = t.ai.intel.traffic.audit;
  const f = d.filters;
  const [merchantId, setMerchantId] = useState("");
  const [offerId, setOfferId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [params, setParams] = useState<AuditReportParams>({});
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchReport(p: AuditReportParams) {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditReportAction(p);
      if (res.ok) setReport(res.data);
      else setError(res.error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchReport({});
  }, []);

  function onApply(e: React.FormEvent) {
    e.preventDefault();
    const p: AuditReportParams = {
      merchantId: merchantId.trim() || undefined,
      offerId: offerId.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    };
    setParams(p);
    fetchReport(p);
  }

  function onReset() {
    setMerchantId("");
    setOfferId("");
    setFrom("");
    setTo("");
    setParams({});
    fetchReport({});
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      <form
        onSubmit={onApply}
        className="mt-6 grid gap-3 rounded-xl border border-ink/10 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div>
          <label className={labelClass}>{f.merchantId}</label>
          <input
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            placeholder={f.merchantIdPlaceholder}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{f.offerId}</label>
          <input
            value={offerId}
            onChange={(e) => setOfferId(e.target.value)}
            placeholder={f.offerIdPlaceholder}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{f.from}</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{f.to}</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={loading} className={buttonClass}>
            {loading ? d.loading : f.apply}
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={loading}
            className="rounded-lg px-3 py-2 text-sm text-ink/60 hover:underline disabled:opacity-50"
          >
            {f.reset}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="mt-6 space-y-8">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle>{d.totalsTitle}</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadJson(
                      `audit-report-${report.period.from}_${report.period.to}.json`,
                      report
                    )
                  }
                  className={buttonClass}
                >
                  {d.exportJson}
                </button>
                <a
                  href={getAuditReportExportUrl(params, "csv")}
                  download
                  className={buttonClass}
                >
                  {d.exportCsv}
                </a>
              </div>
            </div>
            <div className="mt-3">
              <AuditContext report={report} />
            </div>
            <div className="mt-3">
              <AuditTotals report={report} />
            </div>
          </div>

          <div>
            <SectionTitle>{d.trafficSourcesTitle}</SectionTitle>
            <div className="mt-3">
              <TrafficSourcesTable report={report} />
            </div>
          </div>

          <div>
            <SectionTitle>{d.attributionsTitle}</SectionTitle>
            <div className="mt-3">
              <AttributionsTable report={report} />
            </div>
          </div>
        </div>
      ) : loading ? (
        <p className="mt-6 text-sm text-ink/55">{d.loading}</p>
      ) : null}
    </div>
  );
}
