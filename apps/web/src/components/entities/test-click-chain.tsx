"use client";

import { useState, useTransition } from "react";
import { testClickChainAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";
import { zh, en } from "@/i18n/dict/test-click";

export interface TestClickHopView {
  hop: number;
  label: "tracking" | "landing-page" | "affiliate" | "final";
  url: string;
  httpStatus: number | null;
  ms: number;
  expectedUrl?: string;
  deviated: boolean;
  error?: string;
}

export interface TestClickReportView {
  ok: boolean;
  trackingLinkId: string;
  publicId: string;
  clickId: string;
  isTestClick: boolean;
  hops: TestClickHopView[];
  chainOk: boolean;
  conversionPostbackSkipped: boolean;
}

export function TestClickChain({ trackingLinkId }: { trackingLinkId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TestClickReportView | null>(null);
  const { lang } = useI18n();
  const t = (lang === "zh" ? zh : en).testClick;

  function onVerify() {
    if (pending) return;
    setError(null);
    setReport(null);
    start(async () => {
      const res = await testClickChainAction(trackingLinkId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReport(res.data as TestClickReportView);
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">
            {t.title}
          </h3>
          <p className="mt-1 text-sm text-ink/60">{t.description}</p>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? t.testing : t.runTest}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {report ? (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <span
              className={`rounded-full px-3 py-1 font-medium ${
                report.chainOk
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              {report.chainOk ? t.chainOk : t.chainBroken}
            </span>
            <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-ink/70">
              {t.clickRecorded}
            </span>
            <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-ink/70">
              {t.noConversion}
            </span>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-ink/10">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 bg-ink/[0.03] text-ink/60">
                  <th className="px-3 py-2 font-medium">{t.columns.hop}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.stage}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.url}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.status}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.ms}</th>
                  <th className="px-3 py-2 font-medium">{t.columns.deviated}</th>
                </tr>
              </thead>
              <tbody>
                {report.hops.map((h) => (
                  <tr
                    key={h.hop}
                    className={`border-b border-ink/5 last:border-0 ${
                      h.deviated ? "bg-rose-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono">{h.hop}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {t.stages[h.label]}
                    </td>
                    <td
                      className="max-w-[320px] truncate px-3 py-2 font-mono text-[13px]"
                      title={h.url}
                    >
                      {h.url}
                      {h.error ? (
                        <span className="ml-2 text-rose-700">
                          ({t.requestFailed}: {h.error})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {h.httpStatus ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{h.ms}</td>
                    <td
                      className={`px-3 py-2 font-medium ${
                        h.deviated ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {h.deviated ? t.deviatedYes : t.deviatedNo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
