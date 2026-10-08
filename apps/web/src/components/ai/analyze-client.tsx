"use client";

import { useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import { EntityPageHeader } from "@/components/entities/ui";
import { analyzeOfferAction } from "@/lib/api/ai-actions";
import type { AiAnalysis, AiAnalysisSummary } from "@/lib/api/ai";
import { AnalysisReport } from "./analysis-report";

const CURRENCIES = ["USD", "EUR", "CNY", "GBP", "JPY"];

function toSummary(a: AiAnalysis): AiAnalysisSummary {
  return {
    id: a.id,
    merchant: a.merchant,
    network: a.network,
    payout: a.profitability.payout,
    payoutCurrency: a.profitability.payoutCurrency,
    overallRisk: a.analysis.overallRisk,
    riskLevel: a.analysis.riskLevel,
    createdAt: a.analyzedAt,
  };
}

function riskBadge(level: "low" | "medium" | "high"): string {
  if (level === "low") return "bg-green-100 text-green-800";
  if (level === "medium") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

export function AnalyzeClient({
  isAdmin,
  showSetupNudge,
  initialHistory,
}: {
  isAdmin: boolean;
  showSetupNudge: boolean;
  initialHistory: AiAnalysisSummary[];
}) {
  const t = useDict();
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [merchant, setMerchant] = useState("");
  const [network, setNetwork] = useState("");
  const [payout, setPayout] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [cpc, setCpc] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [report, setReport] = useState<AiAnalysis | null>(null);
  const [history, setHistory] = useState(initialHistory);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedText = text.trim();
    if ((mode === "url" && !trimmedUrl) || (mode === "text" && !trimmedText)) {
      setError(t.ai.analyze.form.needInput);
      return;
    }
    setError(null);
    setNotConfigured(false);
    setAnalyzing(true);
    try {
      const payoutNum = payout.trim() === "" ? undefined : Number(payout);
      const cpcNum = cpc.trim() === "" ? undefined : Number(cpc);
      const res = await analyzeOfferAction({
        url: mode === "url" ? trimmedUrl : undefined,
        text: mode === "text" ? trimmedText : undefined,
        merchant: merchant.trim() || undefined,
        network: network.trim() || undefined,
        payout:
          payoutNum !== undefined && Number.isFinite(payoutNum)
            ? payoutNum
            : undefined,
        payoutCurrency: currency,
        estimatedCpc:
          cpcNum !== undefined && Number.isFinite(cpcNum) ? cpcNum : undefined,
      });
      if (res.ok) {
        setReport(res.data);
        setHistory((h) => [
          toSummary(res.data),
          ...h.filter((x) => x.id !== res.data.id),
        ]);
      } else if (res.code === "AI_NOT_CONFIGURED") {
        setNotConfigured(true);
      } else {
        setError(res.error);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function reset() {
    setReport(null);
    setError(null);
    setNotConfigured(false);
  }

  return (
    <div>
      <EntityPageHeader
        title={t.ai.analyze.title}
        description={t.ai.analyze.description}
      />

      {showSetupNudge ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-medium text-amber-900">
            {t.ai.analyze.setupNudge.title}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {t.ai.analyze.setupNudge.description}
          </p>
          <Link
            href="/admin/ai-settings"
            className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
          >
            {t.ai.analyze.setupNudge.goSettings}
          </Link>
        </div>
      ) : null}

      {notConfigured ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-medium text-amber-900">
            {t.ai.analyze.contactAdmin.title}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {t.ai.analyze.contactAdmin.description}
          </p>
          {isAdmin ? (
            <Link
              href="/admin/ai-settings"
              className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper"
            >
              {t.ai.analyze.setupNudge.goSettings}
            </Link>
          ) : null}
        </div>
      ) : null}

      {report ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={reset}
            className="mb-4 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {t.ai.analyze.report.reanalyze}
          </button>
          <AnalysisReport analysis={report} />
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6"
        >
          <div
            className="inline-flex rounded-lg bg-ink/5 p-1"
            role="group"
            aria-label="input mode"
          >
            {(["url", "text"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  mode === m
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink/60 hover:text-ink"
                }`}
              >
                {m === "url"
                  ? t.ai.analyze.form.modeUrl
                  : t.ai.analyze.form.modeText}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {mode === "url" ? (
              <div>
                <label className={labelClass} htmlFor="ai-url">
                  {t.ai.analyze.form.urlLabel}
                </label>
                <input
                  id="ai-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t.ai.analyze.form.urlPlaceholder}
                  className={inputClass}
                />
              </div>
            ) : (
              <div>
                <label className={labelClass} htmlFor="ai-text">
                  {t.ai.analyze.form.textLabel}
                </label>
                <textarea
                  id="ai-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t.ai.analyze.form.textPlaceholder}
                  rows={5}
                  className={inputClass}
                />
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="ai-merchant">
                {t.ai.analyze.form.merchantLabel}
              </label>
              <input
                id="ai-merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder={t.ai.analyze.form.merchantPlaceholder}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-network">
                {t.ai.analyze.form.networkLabel}
              </label>
              <input
                id="ai-network"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder={t.ai.analyze.form.networkPlaceholder}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-payout">
                {t.ai.analyze.form.payoutLabel}
              </label>
              <div className="flex gap-2">
                <input
                  id="ai-payout"
                  type="number"
                  min="0"
                  step="0.01"
                  value={payout}
                  onChange={(e) => setPayout(e.target.value)}
                  placeholder={t.ai.analyze.form.payoutPlaceholder}
                  className={inputClass}
                />
                <select
                  aria-label={t.ai.analyze.form.currencyLabel}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="rounded-lg border border-ink/15 bg-white px-2 py-2 text-sm text-ink"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="ai-cpc">
                {t.ai.analyze.form.cpcLabel}
              </label>
              <input
                id="ai-cpc"
                type="number"
                min="0"
                step="0.01"
                value={cpc}
                onChange={(e) => setCpc(e.target.value)}
                placeholder={t.ai.analyze.form.cpcPlaceholder}
                className={inputClass}
              />
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={analyzing}
            className="mt-5 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {analyzing
              ? t.ai.analyze.form.analyzing
              : t.ai.analyze.form.submit}
          </button>
        </form>
      )}

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.ai.analyze.history.title}
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55">
            {t.ai.analyze.history.empty}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">{t.common.misc.name}</th>
                  <th className="px-3 py-2">{t.ai.analyze.report.overallRisk}</th>
                  <th className="px-3 py-2">{t.ai.analyze.report.payout}</th>
                  <th className="px-3 py-2">{t.common.misc.created}</th>
                  <th className="px-3 py-2">{t.common.misc.actions}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-ink/10">
                    <td className="px-3 py-2 font-medium text-ink">
                      {h.merchant || h.network || h.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadge(h.riskLevel)}`}
                      >
                        {t.ai.analyze.report.riskLevels[h.riskLevel]} ·{" "}
                        {Math.round(h.overallRisk)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {h.payout !== null && h.payoutCurrency
                        ? `${h.payoutCurrency} ${h.payout}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink/60">
                      {formatDateTime(h.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/ai/analyses/${h.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {t.ai.analyze.history.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
