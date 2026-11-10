"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { en as msEn, zh as msZh } from "@/i18n/dict/cashback-merchant-screening";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  adMeasureAction,
  type DfsMeasureRow,
} from "@/lib/api/keyword-dataforseo-actions";
import { DFS_LOCATIONS } from "@/lib/keywords/dataforseo-locations";
import { hasVolume, sortMeasureDisplay } from "@/components/keywords/keyword-marks";
import {
  applyKeywordTraffic,
  brandSeedKeyword,
  formatConfirmedList,
  formatScreeningSummary,
  parseKeywordTable,
  screenCashbackText,
  type BrandKeywordMeasure,
  type BrandKeywordVerdict,
  type ScreenedMerchant,
  type ScreeningResult,
  type Verdict,
} from "@/lib/cashback-merchant-screening";

function useMerchantScreeningDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? msZh : msEn;
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

const SAMPLE_TEXT = [
  "Eileen Fisher / 最高4%返利 / 5726人获得返利",
  "ROVE Dash Cam / 8%返利 / 50人获得返利",
  "Leatherman / 最高4%返利 / 4.9万人获得返利",
  "White Fox Boutique US / 最高1%返利 / 2.9万人获得返利",
  "SKIMS / 最高2%返利 / 2万人获得返利",
  "Crocs DE / 3.2%返利 / 3人获得返利",
].join("\n");

const US_LOCATION_CODE =
  DFS_LOCATIONS.find((l) => l.country === "US")?.locationCode ?? 2840;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function fmtVolume(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("en-US");
}

function fmtCpc(v: number | null): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

function keywordVerdictBadgeClass(v: BrandKeywordVerdict | null): string {
  switch (v) {
    case "investable":
      return "bg-emerald-500/15 text-emerald-700";
    case "over-breakeven":
      return "bg-red-500/10 text-red-700";
    case "no-volume":
      return "bg-ink/10 text-ink/60";
    default:
      return "bg-amber-500/15 text-amber-700";
  }
}

/** 返利商家粘贴筛选：粘贴 55海淘列表 → 三档结果 + 品牌词流量 + 确认最终清单（纯前端展示）。 */
export function MerchantScreeningClient() {
  const d = useMerchantScreeningDict();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<ScreenedMerchant[] | null>(null);
  const [confirmedCopied, setConfirmedCopied] = useState(false);
  const [keywordText, setKeywordText] = useState("");
  const [keywordInfo, setKeywordInfo] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const lang: "zh" | "en" = d === msZh ? "zh" : "en";

  const runScreen = () => {
    if (text.trim() === "") {
      setError(d.merchantScreening.emptyInput);
      return;
    }
    setError(null);
    setConfirmed(null);
    setConfirmedCopied(false);
    setKeywordInfo(null);
    setFetchError(null);
    const r = screenCashbackText(text);
    setResult(r);
    setSelected(
      new Set(r.merchants.filter((m) => m.verdict === "shortlist").map((m) => m.normalizedName))
    );
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmed(null);
  };

  const confirmFinalList = () => {
    if (!result) return;
    setConfirmed(result.merchants.filter((m) => selected.has(m.normalizedName)));
    setConfirmedCopied(false);
  };

  const copySummary = async () => {
    if (!result) return;
    setCopied(await copyText(formatScreeningSummary(result, lang)));
    window.setTimeout(() => setCopied(false), 2000);
  };

  const copyConfirmed = async () => {
    if (!confirmed) return;
    setConfirmedCopied(await copyText(formatConfirmedList(confirmed, lang)));
    window.setTimeout(() => setConfirmedCopied(false), 2000);
  };

  /** 拉取品牌词流量：只测短名单 + 备选，一次批量调用，不一家发一次。 */
  const fetchKeywordTraffic = async () => {
    if (!result) return;
    const targets = result.merchants.filter(
      (m) => m.verdict === "shortlist" || m.verdict === "backup"
    );
    if (targets.length === 0) return;
    const keywords = [...new Set(targets.map((m) => brandSeedKeyword(m.name)))].filter(Boolean);
    setFetching(true);
    setFetchError(null);
    const res = await adMeasureAction({
      keywords,
      locationCode: US_LOCATION_CODE,
      languageCode: "en",
    });
    setFetching(false);
    if (!res.ok) {
      // 接口返回的 error 原样显示，不编一个量顶上。
      setFetchError(res.error);
      return;
    }
    const measures: BrandKeywordMeasure[] = (res.data.rows as DfsMeasureRow[]).map((row) => ({
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      cpc: row.cpc,
      competition: row.competition,
      lowTopBid: row.lowTopBid,
      highTopBid: row.highTopBid,
    }));
    const applied = applyKeywordTraffic(result, measures);
    setResult(applied.result);
    setKeywordInfo(d.merchantScreening.keyword.fetchedAt);
    setConfirmed(null);
  };

  const importKeywordTable = () => {
    if (!result || keywordText.trim() === "") return;
    const parsed = parseKeywordTable(keywordText);
    const applied = applyKeywordTraffic(result, parsed.rows);
    setResult(applied.result);
    setKeywordInfo(
      d.merchantScreening.keyword.pasteSummary(parsed.parsedCount, parsed.skippedCount, applied.unmatchedCount)
    );
    setConfirmed(null);
  };

  /** 品牌词流量一览：有量在前按 CPC 升序（复用 sortMeasureDisplay）。 */
  const measuredRows = useMemo(() => {
    if (!result) return [];
    const rows = result.merchants
      .filter((m) => m.keywordMeasure != null)
      .map((m) => ({
        brand: m.name,
        keyword: m.keywordMeasure!.keyword,
        searchVolume: m.keywordMeasure!.searchVolume,
        cpc: m.keywordMeasure!.cpc,
        verdict: m.keywordVerdict,
      }));
    return sortMeasureDisplay(rows);
  }, [result]);

  const tier = (v: Verdict) => result?.merchants.filter((m) => m.verdict === v) ?? [];

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.merchantScreening.title}
        description={d.merchantScreening.description}
      />
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {d.merchantScreening.warning}
      </div>

      <div className="rounded-xl border border-ink/10 bg-white px-5 py-4">
        <label className="mb-1 block text-sm font-medium">
          {d.merchantScreening.pasteLabel}
        </label>
        <textarea
          className={`${inputClass} min-h-44 font-mono text-[13px] leading-relaxed`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={d.merchantScreening.placeholder}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} onClick={runScreen}>
            {d.merchantScreening.screen}
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setText(SAMPLE_TEXT);
              setError(null);
            }}
          >
            {d.merchantScreening.loadSample}
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setText("");
              setResult(null);
              setConfirmed(null);
              setError(null);
              setKeywordText("");
              setKeywordInfo(null);
              setFetchError(null);
            }}
          >
            {d.merchantScreening.clear}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>

      {!result && (
        <p className="text-sm text-ink/50">{d.merchantScreening.noResult}</p>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink/60">
              {d.merchantScreening.parsedSummary(result.parsedCount, result.skippedCount)}
            </p>
            <button type="button" className={btnGhost} onClick={() => void copySummary()}>
              {copied ? d.merchantScreening.copied : d.merchantScreening.copySummary}
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={fetching || tier("shortlist").length + tier("backup").length === 0}
              onClick={() => void fetchKeywordTraffic()}
            >
              {fetching
                ? d.merchantScreening.keyword.fetching
                : d.merchantScreening.keyword.fetchButton}
            </button>
            <span className="text-xs text-ink/45">{d.merchantScreening.keyword.fetchHint}</span>
          </div>
          {fetchError && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              {d.merchantScreening.keyword.fetchErrorPrefix}
              {fetchError}
              <p className="mt-1 text-xs text-red-600/80">
                {d.merchantScreening.keyword.notConfiguredHint}
              </p>
            </div>
          )}
          {keywordInfo && <p className="text-sm text-emerald-700">{keywordInfo}</p>}

          <TierSection
            d={d}
            title={d.merchantScreening.sections.shortlist}
            hint={d.merchantScreening.sectionHints.shortlist}
            rows={tier("shortlist")}
            selectable
            selected={selected}
            onToggle={toggleSelect}
          />
          <TierSection
            d={d}
            title={d.merchantScreening.sections.backup}
            hint={d.merchantScreening.sectionHints.backup}
            rows={tier("backup")}
            selectable
            selected={selected}
            onToggle={toggleSelect}
          />
          <TierSection
            d={d}
            title={d.merchantScreening.sections.excluded}
            hint={d.merchantScreening.sectionHints.excluded}
            rows={tier("excluded")}
            selectable={false}
            selected={selected}
            onToggle={toggleSelect}
          />

          {measuredRows.length > 0 && (
            <div className="rounded-xl border border-ink/10 bg-white">
              <div className="border-b border-ink/10 px-5 py-3 text-sm font-medium">
                {d.merchantScreening.keyword.trafficTitle}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-ink/60">
                    <th className="px-5 py-2 font-normal">{d.merchantScreening.columns.brand}</th>
                    <th className="px-5 py-2 font-normal">{d.merchantScreening.keyword.columns.volume}</th>
                    <th className="px-5 py-2 font-normal">{d.merchantScreening.keyword.columns.cpc}</th>
                    <th className="px-5 py-2 font-normal">{d.merchantScreening.columns.keyword}</th>
                  </tr>
                </thead>
                <tbody>
                  {measuredRows.map((r) => (
                    <tr key={r.brand} className="border-b border-ink/5 last:border-0">
                      <td className="px-5 py-2 font-medium text-ink">
                        {r.brand}
                        <span className="ml-2 font-mono text-xs text-ink/45">{r.keyword}</span>
                      </td>
                      <td className={`px-5 py-2 font-mono text-[13px] ${hasVolume(r.searchVolume) ? "" : "text-ink/40"}`}>
                        {fmtVolume(r.searchVolume)}
                      </td>
                      <td className="px-5 py-2 font-mono text-[13px]">{fmtCpc(r.cpc)}</td>
                      <td className="px-5 py-2">
                        <KeywordVerdictBadge d={d} verdict={r.verdict} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-xl border border-ink/10 bg-white px-5 py-4">
            <label className="mb-1 block text-sm font-medium">
              {d.merchantScreening.keyword.pasteTitle}
            </label>
            <textarea
              className={`${inputClass} min-h-24 font-mono text-[13px] leading-relaxed`}
              value={keywordText}
              onChange={(e) => setKeywordText(e.target.value)}
              placeholder={d.merchantScreening.keyword.pastePlaceholder}
            />
            <div className="mt-3">
              <button
                type="button"
                className={btnGhost}
                disabled={keywordText.trim() === ""}
                onClick={importKeywordTable}
              >
                {d.merchantScreening.keyword.pasteButton}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ink/10 bg-white px-5 py-4">
            <h3 className="text-sm font-medium">{d.merchantScreening.confirm.title}</h3>
            <p className="mt-1 text-xs text-ink/50">{d.merchantScreening.confirm.hint}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={selected.size === 0}
                onClick={confirmFinalList}
              >
                {d.merchantScreening.confirm.button}（{selected.size}）
              </button>
              {confirmed && (
                <button type="button" className={btnGhost} onClick={() => void copyConfirmed()}>
                  {confirmedCopied
                    ? d.merchantScreening.copied
                    : d.merchantScreening.copyConfirmed}
                </button>
              )}
            </div>
            {confirmed && (
              <div className="mt-4">
                <h4 className="text-sm font-medium">
                  {d.merchantScreening.confirm.confirmedTitle} ·{" "}
                  {d.merchantScreening.groupCount(confirmed.length)}
                </h4>
                {confirmed.length === 0 ? (
                  <p className="mt-2 text-sm text-ink/50">
                    {d.merchantScreening.confirm.confirmedEmpty}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {confirmed.map((m) => (
                      <li key={m.normalizedName} className="text-ink">
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-2 text-xs text-ink/50">
                          {d.merchantScreening.verdicts[m.verdict]}
                        </span>
                        <span className="block text-xs text-ink/60">{m.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-ink/45">
                  {d.merchantScreening.confirm.confirmedNote}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KeywordVerdictBadge({
  d,
  verdict,
}: {
  d: typeof msZh;
  verdict: BrandKeywordVerdict | null;
}) {
  if (verdict == null) {
    return (
      <span className="inline-block rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
        {d.merchantScreening.keyword.verdicts.unmeasured}
      </span>
    );
  }
  const label =
    verdict === "no-volume"
      ? d.merchantScreening.keyword.verdicts.noVolume
      : verdict === "investable"
        ? d.merchantScreening.keyword.verdicts.investable
        : verdict === "over-breakeven"
          ? d.merchantScreening.keyword.verdicts.overBreakeven
          : d.merchantScreening.keyword.verdicts.unknown;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${keywordVerdictBadgeClass(verdict)}`}
    >
      {label}
    </span>
  );
}

function TierSection({
  d,
  title,
  hint,
  rows,
  selectable,
  selected,
  onToggle,
}: {
  d: typeof msZh;
  title: string;
  hint: string;
  rows: ScreenedMerchant[];
  selectable: boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const c = d.merchantScreening.columns;
  return (
    <div className="rounded-xl border border-ink/10 bg-white">
      <div className="border-b border-ink/10 px-5 py-3">
        <span className="text-sm font-medium">
          {title} · {d.merchantScreening.groupCount(rows.length)}
        </span>
        <p className="mt-0.5 text-xs text-ink/45">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-ink/50">
          {d.merchantScreening.noRows}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-ink/60">
                {selectable && <th className="px-3 py-2 font-normal">{c.select}</th>}
                <th className="px-3 py-2 font-normal">{c.brand}</th>
                <th className="px-3 py-2 font-normal">{c.fame}</th>
                <th className="px-3 py-2 font-normal">{c.price}</th>
                <th className="px-3 py-2 font-normal">{c.network}</th>
                <th className="px-3 py-2 font-normal">{c.gift}</th>
                <th className="px-3 py-2 font-normal">{c.cashback}</th>
                <th className="px-3 py-2 font-normal">{c.keyword}</th>
                <th className="px-3 py-2 font-normal">{c.reason}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.normalizedName} className="border-b border-ink/5 align-top last:border-0">
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(m.normalizedName)}
                        onChange={() => onToggle(m.normalizedName)}
                        aria-label={m.name}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-ink">{m.name}</span>
                    <span className="block text-xs text-ink/50">
                      {d.merchantScreening.demand[m.demandTier]}
                      {m.peopleCount != null && ` · ${m.peopleCount.toLocaleString("en-US")}人`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-ink">
                      {d.merchantScreening.fame[m.fame]}
                    </span>
                    <span className="block text-xs text-ink/50">{m.fameEvidence}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[13px]">{m.priceLabel}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[13px]">{m.networkLabel}</span>
                    <span className="block text-xs text-ink/50">
                      {m.commissionLabel}
                      {m.commissionBasis ? `（${m.commissionBasis}）` : ""}
                      {m.breakevenCpcUsd != null &&
                        ` · ${d.merchantScreening.keyword.breakeven(m.breakevenCpcUsd)}`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-ink">
                      {d.merchantScreening.gift[m.giftFit]}
                    </span>
                    <span className="block text-xs text-ink/50">{m.giftReason}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[13px]">
                    {m.cashbackKind === "percent" && m.cashbackPct != null
                      ? `${m.cashbackPct}%`
                      : m.cashbackKind === "fixed" && m.cashbackFixedUsd != null
                        ? `$${m.cashbackFixedUsd}`
                        : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {m.keywordMeasure ? (
                      <>
                        <span className="font-mono text-[13px]">
                          {fmtVolume(m.keywordMeasure.searchVolume)} /{" "}
                          {fmtCpc(m.keywordMeasure.cpc)}
                        </span>
                        <span className="block text-xs text-ink/50">
                          {m.keywordMeasure.competition
                            ? `${d.merchantScreening.keyword.columns.competition} ${m.keywordMeasure.competition}`
                            : ""}
                          {m.keywordMeasure.lowTopBid != null &&
                            m.keywordMeasure.highTopBid != null &&
                            ` · ${d.merchantScreening.keyword.columns.topBid} $${m.keywordMeasure.lowTopBid.toFixed(2)}–$${m.keywordMeasure.highTopBid.toFixed(2)}`}
                        </span>
                        <span className="mt-1 block">
                          <KeywordVerdictBadge d={d} verdict={m.keywordVerdict} />
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-ink/40">
                        {d.merchantScreening.keyword.verdicts.unmeasured}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs leading-relaxed text-ink/70">
                    {m.reason}
                    {m.keywordNote && (
                      <span className="block text-ink/50">{m.keywordNote}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <div className="border-t border-ink/10 px-5 py-3">
          <p className="mb-1 text-xs font-medium text-ink/60">
            {title} · {lang_reasonSummary(d)}
          </p>
          <ul className="space-y-1 text-xs text-ink/60">
            {rows.map((m) => (
              <li key={m.normalizedName}>
                <span className="font-medium text-ink/80">{m.name}</span>：{m.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function lang_reasonSummary(d: typeof msZh): string {
  return d === msZh ? "理由汇总" : "Reasons";
}
