"use client";

/**
 * 自动化套件 2/5 — 搜索词自动否词 UI.
 * 粘贴搜索词报告 → AI 分析 → 建议列表（应用/忽略），状态筛选。
 * Dict is imported directly (not via dictionaries.ts registration).
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { en as stEn, zh as stZh } from "@/i18n/dict/search-terms";
import {
  analyzeSearchTermsAction,
  applySuggestionAction,
  dismissSuggestionAction,
  listSuggestionsAction,
  type SearchTermSuggestionDto,
} from "@/lib/api/search-term-actions";

function useSearchTermDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? stZh : stEn;
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";
const monoClass = "font-mono text-[13px]";

type StatusFilter = "ALL" | "PENDING" | "APPLIED" | "DISMISSED";

function actionBadgeClass(action: string): string {
  switch (action) {
    case "ADD_NEGATIVE_EXACT":
      return "bg-red-100 text-red-800";
    case "ADD_NEGATIVE_PHRASE":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "APPLIED":
      return "bg-emerald-100 text-emerald-800";
    case "DISMISSED":
      return "bg-slate-100 text-slate-500";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

export function SearchTermsClient() {
  const d = useSearchTermDict();
  const [text, setText] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [items, setItems] = useState<SearchTermSuggestionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastNegative, setLastNegative] = useState<{
    id: string;
    text: string;
    queued: boolean;
  } | null>(null);

  async function refresh(status: StatusFilter) {
    const res = await listSuggestionsAction(
      status === "ALL" ? undefined : status,
      1,
      50
    );
    if (res.ok) {
      setItems(res.data.items);
      setTotal(res.data.total);
    } else {
      setError(res.error);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      await refresh(filter);
      setLoading(false);
    })();
  }, [filter]);

  async function onAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLastNegative(null);
    if (!text.trim()) return;
    setAnalyzing(true);
    try {
      const res = await analyzeSearchTermsAction(
        text,
        campaignName.trim() || undefined
      );
      if (res.ok) {
        setNotice(`${d.panel.analyzed}（${res.data.analyzed}）`);
        setText("");
        setFilter("PENDING");
        await refresh("PENDING");
      } else {
        setError(`${d.panel.analyzeFailed}${res.error}`);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function onApply(id: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    setLastNegative(null);
    try {
      const res = await applySuggestionAction(id);
      if (res.ok) {
        setNotice(d.list.applied);
        if (res.data.negativeText) {
          setLastNegative({
            id,
            text: res.data.negativeText,
            queued: !!res.data.taskId,
          });
        }
        await refresh(filter);
      } else {
        setError(res.error);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function onDismiss(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await dismissSuggestionAction(id);
      if (res.ok) {
        setNotice(d.list.dismissed);
        await refresh(filter);
      } else {
        setError(res.error);
      }
    } finally {
      setBusyId(null);
    }
  }

  function actionLabel(action: string): string {
    if (action === "ADD_NEGATIVE_EXACT") return d.list.actionExact;
    if (action === "ADD_NEGATIVE_PHRASE") return d.list.actionPhrase;
    return d.list.actionIgnore;
  }

  function statusLabel(status: string): string {
    if (status === "APPLIED") return d.list.statusApplied;
    if (status === "DISMISSED") return d.list.statusDismissed;
    return d.list.statusPending;
  }

  const filters: StatusFilter[] = ["ALL", "PENDING", "APPLIED", "DISMISSED"];
  const filterLabel = (f: StatusFilter): string => {
    if (f === "ALL") return d.list.filterAll;
    if (f === "PENDING") return d.list.filterPending;
    if (f === "APPLIED") return d.list.filterApplied;
    return d.list.filterDismissed;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{d.panel.title}</h1>
        <p className="mt-1 text-sm text-ink/60">{d.panel.description}</p>
      </div>

      <form onSubmit={onAnalyze} className="space-y-3 rounded-xl border border-ink/10 bg-white p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">
            {d.panel.pasteLabel}
          </label>
          <textarea
            className={`${inputClass} min-h-[140px] ${monoClass}`}
            placeholder={d.panel.pastePlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={20000}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">
            {d.panel.campaignLabel}
          </label>
          <input
            className={inputClass}
            placeholder={d.panel.campaignPlaceholder}
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
          />
        </div>
        <button type="submit" className={btnPrimary} disabled={analyzing || !text.trim()}>
          {analyzing ? d.panel.analyzing : d.panel.analyze}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {lastNegative && (
        <div className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm">
          <div className="font-medium text-ink">{d.list.negativeTextLabel}</div>
          <code className={`${monoClass} mt-1 block break-all rounded bg-slate-100 px-2 py-1`}>
            {lastNegative.text}
          </code>
          {lastNegative.queued && (
            <div className="mt-1 text-xs text-ink/60">{d.list.queuedNote}</div>
          )}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">{d.list.title}</h2>
          <span className="text-xs text-ink/50">({total})</span>
          <div className="ml-auto flex gap-1">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs ${
                  filter === f
                    ? "bg-signal text-white"
                    : "border border-ink/15 bg-white text-ink hover:border-ink/40"
                }`}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-ink/50">…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-ink/10 bg-white p-6 text-center text-sm text-ink/50">
            {d.list.empty}
            <div className="mt-1 text-xs">{d.panel.emptyHint}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-ink/10 bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className={`${monoClass} font-medium text-ink`}>
                    {s.searchTerm}
                  </code>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${actionBadgeClass(
                      s.suggestedAction
                    )}`}
                  >
                    {actionLabel(s.suggestedAction)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(
                      s.status
                    )}`}
                  >
                    {statusLabel(s.status)}
                  </span>
                  {s.status === "PENDING" && (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={busyId === s.id}
                        onClick={() => onApply(s.id)}
                      >
                        {busyId === s.id ? d.list.applying : d.list.apply}
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={busyId === s.id}
                        onClick={() => onDismiss(s.id)}
                      >
                        {busyId === s.id ? d.list.applying : d.list.dismiss}
                      </button>
                    </span>
                  )}
                </div>
                {s.campaignName && (
                  <div className="mt-1 text-xs text-ink/50">{s.campaignName}</div>
                )}
                {s.reason && (
                  <div className="mt-1 text-sm text-ink/70">{s.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
