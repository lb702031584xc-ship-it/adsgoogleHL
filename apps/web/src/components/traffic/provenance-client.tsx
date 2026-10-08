"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader, SectionTitle } from "@/components/entities/ui";
import { getProvenanceAction } from "@/lib/api/traffic-intel-actions";
import {
  downloadJson,
  getProvenanceExportUrl,
} from "@/lib/api/traffic-export";
import type { ProvenanceReport } from "@/lib/api/traffic-intel";
import {
  EventTimeline,
  PolicyEvidenceList,
  ProvenanceSummary,
} from "@/components/traffic/provenance-view";

const buttonClass =
  "rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50";

/** Conversion provenance explorer: ?conversionId= loads the evidence chain. */
export function ProvenanceClient({
  initialConversionId,
}: {
  initialConversionId: string | null;
}) {
  const t = useDict();
  const d = t.ai.intel.traffic.provenance;
  const [input, setInput] = useState(initialConversionId ?? "");
  const [conversionId, setConversionId] = useState<string | null>(
    initialConversionId
  );
  const [report, setReport] = useState<ProvenanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversionId) return;
    (async () => {
      setLoading(true);
      setError(null);
      setReport(null);
      try {
        const res = await getProvenanceAction(conversionId);
        if (res.ok) setReport(res.data);
        else setError(res.error);
      } finally {
        setLoading(false);
      }
    })();
  }, [conversionId]);

  function onLoad(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) {
      setError(d.needId);
      return;
    }
    setConversionId(input.trim());
    const url = new URL(window.location.href);
    url.searchParams.set("conversionId", input.trim());
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      <form onSubmit={onLoad} className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium text-ink/80">
            {d.conversionIdLabel}
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={d.conversionIdPlaceholder}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none"
          />
        </div>
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? d.loading : d.load}
        </button>
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
              <SectionTitle>{d.summaryTitle}</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadJson(
                      `provenance-${report.conversionId}.json`,
                      report
                    )
                  }
                  className={buttonClass}
                >
                  {d.exportJson}
                </button>
                <a
                  href={getProvenanceExportUrl(report.conversionId, "csv")}
                  download
                  className={buttonClass}
                >
                  {d.exportCsv}
                </a>
                <Link
                  href="/traffic/audit-report"
                  className="text-sm text-signal hover:underline"
                >
                  {d.viewAuditReport}
                </Link>
              </div>
            </div>
            <div className="mt-3">
              <ProvenanceSummary report={report} />
            </div>
          </div>

          <div>
            <SectionTitle>{d.timelineTitle}</SectionTitle>
            <div className="mt-3">
              <EventTimeline events={report.chain} />
            </div>
          </div>

          <div>
            <SectionTitle>{d.evidenceTitle}</SectionTitle>
            <div className="mt-3">
              <PolicyEvidenceList evidence={report.policyEvidence} />
            </div>
          </div>
        </div>
      ) : !loading && !error ? (
        <p className="mt-6 text-sm text-ink/55">
          {conversionId ? d.noChain : d.needId}
        </p>
      ) : null}
    </div>
  );
}
