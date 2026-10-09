"use client";

import { useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import type { AmazonDiscoveryDict } from "@/i18n/dict/amazon-discovery";
import {
  runAmazonDiscoveryAction,
  importAmazonProductsAction,
  getTrafficThresholdsAction,
  saveTrafficThresholdsAction,
} from "@/lib/api/amazon-actions";
import type { AmazonScoredProduct } from "@/lib/api/amazon-types";

export function AmazonDiscoveryClient({ dict }: { dict: AmazonDiscoveryDict }) {
  const d = dict;
  const [keywords, setKeywords] = useState("");
  const [minPrice, setMinPrice] = useState("50");
  const [maxPrice, setMaxPrice] = useState("200");
  const [minRating, setMinRating] = useState("4.3");
  const [minReviews, setMinReviews] = useState("500");
  const [region, setRegion] = useState("US");
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [products, setProducts] = useState<AmazonScoredProduct[]>([]);
  const [stats, setStats] = useState<{ found: number; kept: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 流量门阈值（加载前展示文档默认值，展开后从 GET 回填）
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const [thresholdsLoaded, setThresholdsLoaded] = useState(false);
  const [thOfficialVisits, setThOfficialVisits] = useState("50000");
  const [thBrandInterest, setThBrandInterest] = useState("25");
  const [thKeywordInterest, setThKeywordInterest] = useState("25");
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [thresholdsMsg, setThresholdsMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onDiscover() {
    const kws = keywords.split("\n").map((s) => s.trim()).filter(Boolean);
    if (kws.length === 0) {
      setError(d.keywordsLabel + " required");
      return;
    }
    setDiscovering(true);
    setError(null);
    setNotice(null);
    setProducts([]);
    try {
      const res = await runAmazonDiscoveryAction({
        keywords: kws,
        minPrice: parseFloat(minPrice) || null,
        maxPrice: parseFloat(maxPrice) || null,
        minRating: parseFloat(minRating) || null,
        minReviews: parseInt(minReviews) || null,
        region,
        maxResults: 30,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRunId(res.data.runId);
      setProducts(res.data.products);
      setStats({ found: res.data.totalFound, kept: res.data.totalKept });
      setSelected(new Set());
      if (res.data.errors.length > 0) {
        setError(res.data.errors.join("; "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "选品失败");
    } finally {
      setDiscovering(false);
    }
  }

  function toggleSelect(asin: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });
  }

  async function onImport() {
    if (!runId || selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await importAmazonProductsAction(runId, Array.from(selected));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(`${d.imported}: ${res.data.count}`);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function loadThresholds() {
    const res = await getTrafficThresholdsAction();
    if (res.ok) {
      setThOfficialVisits(String(res.data.officialSiteMonthlyVisits));
      setThBrandInterest(String(res.data.brandInterest));
      setThKeywordInterest(String(res.data.keywordInterest));
    }
    // 加载失败时保留默认 50000 / 25 / 25
  }

  function toggleThresholds() {
    const next = !thresholdsOpen;
    setThresholdsOpen(next);
    if (next && !thresholdsLoaded) {
      setThresholdsLoaded(true);
      void loadThresholds();
    }
  }

  async function onSaveThresholds() {
    const officialSiteMonthlyVisits = parseInt(thOfficialVisits, 10);
    const brandInterest = parseInt(thBrandInterest, 10);
    const keywordInterest = parseInt(thKeywordInterest, 10);
    const valid =
      Number.isFinite(officialSiteMonthlyVisits) && officialSiteMonthlyVisits >= 0 &&
      Number.isFinite(brandInterest) && brandInterest >= 0 && brandInterest <= 100 &&
      Number.isFinite(keywordInterest) && keywordInterest >= 0 && keywordInterest <= 100;
    if (!valid) {
      setThresholdsMsg({ text: d.thresholdsSaveFailed, ok: false });
      return;
    }
    setSavingThresholds(true);
    setThresholdsMsg(null);
    try {
      const res = await saveTrafficThresholdsAction({
        officialSiteMonthlyVisits,
        brandInterest,
        keywordInterest,
      });
      if (!res.ok) {
        setThresholdsMsg({ text: res.error, ok: false });
        return;
      }
      setThOfficialVisits(String(res.data.officialSiteMonthlyVisits));
      setThBrandInterest(String(res.data.brandInterest));
      setThKeywordInterest(String(res.data.keywordInterest));
      setThresholdsMsg({ text: d.thresholdsSaved, ok: true });
    } finally {
      setSavingThresholds(false);
    }
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-800">
          {d.paidTrafficWarningTitle}
        </p>
        <p className="mt-1 text-sm text-amber-700">{d.paidTrafficWarningBody}</p>
      </div>

      <div className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6">
        <h3 className="text-sm font-semibold text-ink">{d.criteriaTitle}</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelClass}>{d.keywordsLabel}</label>
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={d.keywordsPlaceholder}
              rows={3}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink/55">{d.keywordsHint}</p>
          </div>
          <div>
            <label className={labelClass}>{d.priceRangeLabel}</label>
            <div className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className={inputClass}
              />
              <span className="text-ink/50">~</span>
              <input
                inputMode="decimal"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>{d.regionLabel}</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputClass}>
              {["US", "UK", "DE", "JP", "CA", "AU"].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{d.minRatingLabel}</label>
            <input
              inputMode="decimal"
              value={minRating}
              onChange={(e) => setMinRating(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{d.minReviewsLabel}</label>
            <input
              inputMode="numeric"
              value={minReviews}
              onChange={(e) => setMinReviews(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onDiscover}
          disabled={discovering}
          className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {discovering ? d.discovering : d.discover}
        </button>

        <div className="mt-5 rounded-xl border border-dashed border-signal/60 bg-signal/5">
          <button
            type="button"
            onClick={toggleThresholds}
            aria-expanded={thresholdsOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-ink">🚦 {d.thresholdsTitle}</span>
            <span className="text-xs text-ink/60">
              {thresholdsOpen ? `▲ ${d.collapse}` : `▼ ${d.expand}`}
            </span>
          </button>
          {thresholdsOpen && (
            <div className="border-t border-signal/20 px-4 pb-4 pt-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className={labelClass}>{d.officialSiteVisitsLabel}</label>
                  <input
                    inputMode="numeric"
                    value={thOfficialVisits}
                    onChange={(e) => setThOfficialVisits(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{d.brandInterestLabel}</label>
                  <input
                    inputMode="numeric"
                    value={thBrandInterest}
                    onChange={(e) => setThBrandInterest(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>{d.keywordInterestLabel}</label>
                  <input
                    inputMode="numeric"
                    value={thKeywordInterest}
                    onChange={(e) => setThKeywordInterest(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="mt-3 text-xs text-ink/55">{d.thresholdsHint}</p>
              {thresholdsMsg ? (
                <p
                  className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                    thresholdsMsg.ok
                      ? "border-green-200 bg-green-50 text-green-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {thresholdsMsg.text}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onSaveThresholds}
                disabled={savingThresholds}
                className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                {savingThresholds ? d.savingThresholds : d.saveThresholds}
              </button>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {products.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink">
              {d.resultsTitle}（{d.totalFound} {stats?.found}，{d.totalKept} {stats?.kept}）
            </h3>
            <button
              type="button"
              onClick={onImport}
              disabled={importing || selected.size === 0}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            >
              {importing ? d.importing : `${d.importSelected} (${selected.size})`}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink/50">{d.signalCaption}</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <div
                key={p.asin}
                className={`rounded-xl border p-4 ${
                  selected.has(p.asin) ? "border-signal bg-signal/5" : "border-ink/10 bg-white/70"
                }`}
              >
                <div className="flex gap-3">
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt="" className="h-20 w-20 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium text-ink">{p.title}</p>
                    <p className="mt-1 text-xs text-ink/55 font-mono">{p.asin}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-white">
                    {d.scoreLabel} {p.score}
                  </span>
                  <span className="text-sm font-semibold text-ink">
                    {p.price !== null ? `$${p.price}` : "—"}
                  </span>
                </div>
                <div className="mt-2 text-xs text-ink/60">
                  ⭐ {p.rating ?? "—"}（{p.reviewCount ?? 0}）{p.isPrime ? "· Prime" : ""}
                </div>
                {p.brand && (
                  <div className="mt-1 text-xs text-ink/60">
                    {d.brandLabel}：{p.brand}
                  </div>
                )}
                {p.estimatedCommission !== null && (
                  <div className="mt-1 text-xs text-ink/60">
                    {d.commissionLabel}: ${p.estimatedCommission}
                  </div>
                )}
                {p.trafficGate && (
                  <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink">{d.trafficGateTitle}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.trafficGate.passed === true
                            ? "bg-green-100 text-green-800"
                            : p.trafficGate.passed === false
                              ? "bg-red-100 text-red-800"
                              : "bg-ink/10 text-ink/60"
                        }`}
                      >
                        {p.trafficGate.passed === true
                          ? d.gatePassed
                          : p.trafficGate.passed === false
                            ? d.gateFailed
                            : d.gateNoData}
                      </span>
                    </div>
                    <div className="mt-2">
                      {p.trafficGate.officialSite?.found ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          {d.officialSiteFoundLabel}
                          {p.trafficGate.officialSite.domain
                            ? `：${p.trafficGate.officialSite.domain}`
                            : ""}
                        </span>
                      ) : (
                        <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60">
                          {d.officialSiteNone}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink/70">
                      {p.trafficGate.reason}
                    </p>
                    <div className="mt-2 space-y-1">
                      {p.trafficGate.signals.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-ink/70">
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                              s.passed === true
                                ? "bg-green-500"
                                : s.passed === false
                                  ? "bg-red-500"
                                  : "bg-ink/25"
                            }`}
                          />
                          <span className="flex-1">
                            {s.label}：{s.value === null ? d.gateNoData : s.value} /{" "}
                            {d.thresholdLabel} {s.threshold ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.reasons.map((r, i) => (
                    <span key={i} className="rounded bg-ink/5 px-2 py-0.5 text-xs text-ink/70">
                      {r}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => toggleSelect(p.asin)}
                  className={`mt-3 w-full rounded-lg px-3 py-1.5 text-sm ${
                    selected.has(p.asin)
                      ? "bg-signal text-white"
                      : "border border-ink/15 text-ink"
                  }`}
                >
                  {selected.has(p.asin) ? "✓ 已选" : d.import}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
