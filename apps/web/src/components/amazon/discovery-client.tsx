"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntityPageHeader } from "@/components/entities/ui";
import type { AmazonDiscoveryDict } from "@/i18n/dict/amazon-discovery";
import {
  runAmazonDiscoveryAction,
  importAmazonProductsAction,
  getTrafficThresholdsAction,
  saveTrafficThresholdsAction,
} from "@/lib/api/amazon-actions";
import type { AmazonScoredProduct, TrafficGate } from "@/lib/api/amazon-types";
import { checkTrafficGateAction } from "@/lib/api/traffic-actions";
import { WatchButton } from "./watch-button";

export function AmazonDiscoveryClient({
  dict,
  initialKeyword = "",
}: {
  dict: AmazonDiscoveryDict;
  /** 热销日历"去选品"跳转时预填的关键词（?keyword=）。 */
  initialKeyword?: string;
}) {
  const d = dict;
  const router = useRouter();
  const [keywords, setKeywords] = useState(initialKeyword);
  const [minPrice, setMinPrice] = useState("50");
  const [maxPrice, setMaxPrice] = useState("200");
  const [minRating, setMinRating] = useState("4.3");
  const [minReviews, setMinReviews] = useState("500");
  // 第八批：机会品模式（阈值可调）
  const [opportunityMode, setOpportunityMode] = useState(false);
  const [oppMinReviews, setOppMinReviews] = useState("2000");
  const [oppMinRating, setOppMinRating] = useState("3.0");
  const [oppMaxRating, setOppMaxRating] = useState("4.0");
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
        opportunityMode,
        opportunityMinReviews: parseInt(oppMinReviews) || null,
        opportunityMinRating: parseFloat(oppMinRating) || null,
        opportunityMaxRating: parseFloat(oppMaxRating) || null,
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

  /** 送入流水线：已选项（无则全部）写入 sessionStorage，跳 /amazon/pipeline。 */
  function sendToPipeline() {
    const list = products.filter((p) => selected.size === 0 || selected.has(p.asin));
    const payload = list.slice(0, 10).map((p) => ({
      asin: p.asin,
      title: p.title,
      brand: p.brand ?? undefined,
      detailPageUrl: p.detailPageUrl,
      price: p.price,
      rating: p.rating,
      reviewCount: p.reviewCount,
      opportunity: p.opportunity === true,
    }));
    try {
      sessionStorage.setItem("adlinklab-pipeline-input", JSON.stringify(payload));
    } catch {
      // 忽略存储失败
    }
    router.push("/amazon/pipeline");
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
        <div className="mt-4 rounded-xl border border-amber-300/70 bg-amber-50/60 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={opportunityMode}
              onChange={(e) => setOpportunityMode(e.target.checked)}
              className="h-4 w-4"
            />
            🔥 {d.opportunityTitle}
          </label>
          <p className="mt-1 text-xs text-ink/60">{d.opportunityDesc}</p>
          {opportunityMode && (
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass}>{d.opportunityMinReviewsLabel}</label>
                <input
                  inputMode="numeric"
                  value={oppMinReviews}
                  onChange={(e) => setOppMinReviews(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{d.opportunityRatingRangeLabel}</label>
                <div className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={oppMinRating}
                    onChange={(e) => setOppMinRating(e.target.value)}
                    className={inputClass}
                  />
                  <span className="text-ink/50">–</span>
                  <input
                    inputMode="decimal"
                    value={oppMaxRating}
                    onChange={(e) => setOppMaxRating(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}
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
            <div className="flex gap-2">
              <button
                type="button"
                onClick={sendToPipeline}
                disabled={products.length === 0}
                className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium text-ink transition hover:bg-ink/5 disabled:opacity-50"
              >
                {d.sendToPipeline} ({selected.size > 0 ? selected.size : products.length})
              </button>
              <button
                type="button"
                onClick={onImport}
                disabled={importing || selected.size === 0}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                {importing ? d.importing : `${d.importSelected} (${selected.size})`}
              </button>
            </div>
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
                {p.opportunity && (
                  <div className="mt-2 rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-1.5">
                    <span className="rounded-full bg-amber-400/80 px-2 py-0.5 text-xs font-semibold text-amber-950">
                      🔥 {d.opportunityBadge}
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900/80">
                      {d.opportunityNote}
                    </p>
                  </div>
                )}
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
                {p.trafficGate ? <ProductGateCard p={p} dict={d} /> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.reasons.map((r, i) => (
                    <span key={i} className="rounded bg-ink/5 px-2 py-0.5 text-xs text-ink/70">
                      {r}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <WatchButton
                    asin={p.asin}
                    title={p.title}
                    dict={{ watch: d.watch, watching: d.watching, watched: d.watched }}
                  />
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

function ProductGateCard({ p, dict }: { p: AmazonScoredProduct; dict: AmazonDiscoveryDict }) {
  const [gate, setGate] = useState<TrafficGate | null>(p.trafficGate ?? null);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [visits, setVisits] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  async function recheck() {
    const b = brand.trim();
    const vRaw = visits.trim();
    let v: number | undefined;
    if (vRaw) {
      const n = Number(vRaw);
      if (!Number.isInteger(n) || n <= 0 || n > 1e12) {
        setManualError(dict.manualInvalid);
        return;
      }
      v = n;
    }
    if (!b && v === undefined) {
      setManualError(dict.manualInvalid);
      return;
    }
    setManualError(null);
    setBusy(true);
    try {
      // 品牌默认取产品 brand；链接是亚马逊商品页，domain 不传（平台域名不视为官网）。
      const res = await checkTrafficGateAction({
        brand: b || p.brand || undefined,
        title: p.title,
        keywords: [],
        manualMonthlyVisits: v,
      });
      if (res.ok) setGate(res.data);
    } finally {
      setBusy(false);
    }
  }

  if (!gate) return null;
  return (
    <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{dict.trafficGateTitle}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            gate.passed === true
              ? "bg-green-100 text-green-800"
              : gate.passed === false
                ? "bg-red-100 text-red-800"
                : "bg-ink/10 text-ink/60"
          }`}
        >
          {gate.passed === true
            ? dict.gatePassed
            : gate.passed === false
              ? dict.gateFailed
              : dict.gateNoData}
        </span>
      </div>
      <div className="mt-2">
        {gate.officialSite?.found ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            {dict.officialSiteFoundLabel}
            {gate.officialSite.domain ? `：${gate.officialSite.domain}` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60">
            {dict.officialSiteNone}
          </span>
        )}
      </div>
      {gate.officialSite?.reason ? (
        <p className="mt-1 text-xs text-ink/55">{gate.officialSite.reason}</p>
      ) : null}
      <p className="mt-1.5 text-xs leading-relaxed text-ink/70">{gate.reason}</p>
      <div className="mt-2 space-y-1">
        {gate.signals.map((sig, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-ink/70">
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                sig.passed === true
                  ? "bg-green-500"
                  : sig.passed === false
                    ? "bg-red-500"
                    : "bg-ink/25"
              }`}
            />
            <span className="flex-1">
              {sig.label}：{sig.value === null ? dict.gateNoData : sig.value} /{" "}
              {dict.thresholdLabel} {sig.threshold ?? "—"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-dashed border-ink/20 p-2">
        <button
          type="button"
          className="flex w-full items-center justify-between text-xs font-medium text-ink"
          onClick={() => setManualOpen(!manualOpen)}
          aria-expanded={manualOpen}
        >
          <span>{dict.manualTitle}</span>
          <span aria-hidden className="text-ink/50">
            {manualOpen ? "▲" : "▼"}
          </span>
        </button>
        {manualOpen ? (
          <div className="mt-2 space-y-2">
            <input
              className="w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs text-ink"
              placeholder={dict.manualBrandPlaceholder}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={64}
            />
            <input
              className="w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs text-ink"
              placeholder={dict.manualVisitsPlaceholder}
              value={visits}
              onChange={(e) => setVisits(e.target.value)}
              inputMode="numeric"
            />
            <p className="text-xs text-ink/50">{dict.manualHint}</p>
            {manualError ? (
              <p className="text-xs text-red-600">{manualError}</p>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              disabled={busy}
              onClick={recheck}
            >
              {busy ? dict.rechecking : dict.recheck}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
