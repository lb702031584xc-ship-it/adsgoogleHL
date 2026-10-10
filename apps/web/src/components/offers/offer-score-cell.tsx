"use client";

import { useState } from "react";
import {
  fetchOfferMetricsAction,
  type MetricsSummary,
  type FetchMetricsResult,
} from "@/lib/api/offer-metrics-actions";

/**
 * Offer 列表"推荐指数"单元格：分数 badge + 等级颜色，无数据时显示"—"。
 * "抓取指标"按钮调用后端抓取最终落地页真实指标并刷新 badge；
 * badge 点击展开 breakdown（各分项得分+数据来源，缺失项标"未获取"）。
 */
export interface OfferScoreCellDict {
  scoreColumn: string;
  fetchMetrics: string;
  fetching: string;
  noData: string;
  breakdownTitle: string;
  rating: string;
  reviewCount: string;
  soldCount: string;
  notFetched: string;
  formulaHint: string;
  gradeStrong: string;
  gradeGood: string;
  gradeCaution: string;
  gradeAvoid: string;
  fetchedAt: string;
  failuresLabel: string;
}

function gradeStyle(grade: string | null): string {
  switch (grade) {
    case "strong":
      return "bg-emerald-100 text-emerald-800";
    case "good":
      return "bg-sky-100 text-sky-800";
    case "caution":
      return "bg-amber-100 text-amber-800";
    case "avoid":
      return "bg-red-100 text-red-800";
    default:
      return "bg-ink/10 text-ink/60";
  }
}

function gradeLabel(grade: string | null, d: OfferScoreCellDict): string {
  switch (grade) {
    case "strong":
      return d.gradeStrong;
    case "good":
      return d.gradeGood;
    case "caution":
      return d.gradeCaution;
    case "avoid":
      return d.gradeAvoid;
    default:
      return d.noData;
  }
}

export function OfferScoreCell({
  offerId,
  initial,
  dict: d,
}: {
  offerId: string;
  initial: MetricsSummary | null | undefined;
  dict: OfferScoreCellDict;
}) {
  const [summary, setSummary] = useState<MetricsSummary | null>(initial ?? null);
  const [detail, setDetail] = useState<FetchMetricsResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFetch(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const r = await fetchOfferMetricsAction(offerId);
      if (r.ok) {
        setSummary(r.data.metricsSummary);
        setDetail(r.data);
        setExpanded(true);
      } else {
        setError(r.error);
      }
    } finally {
      setBusy(false);
    }
  }

  const itemLabel: Record<string, string> = {
    rating: d.rating,
    reviewCount: d.reviewCount,
    soldCount: d.soldCount,
  };

  return (
    <span className="inline-flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex items-center gap-2">
        {summary && summary.score !== null ? (
          <button
            type="button"
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${gradeStyle(summary.grade)}`}
            title={d.breakdownTitle}
            onClick={() => setExpanded(!expanded)}
          >
            {summary.score} · {gradeLabel(summary.grade, d)}
          </button>
        ) : (
          <span className="text-xs text-ink/40">{d.noData}</span>
        )}
        <button
          type="button"
          className="rounded border border-ink/15 px-1.5 py-0.5 text-xs text-ink/70 transition hover:bg-ink/5 disabled:opacity-50"
          disabled={busy}
          onClick={onFetch}
        >
          {busy ? d.fetching : d.fetchMetrics}
        </button>
      </span>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      {expanded && detail ? (
        <span className="block rounded-lg border border-ink/10 bg-ink/[0.02] p-2 text-xs text-ink/70">
          <span className="font-medium text-ink/80">{d.breakdownTitle}</span>
          <ul className="mt-1 space-y-0.5">
            {detail.breakdown.map((b) => (
              <li key={b.key}>
                {itemLabel[b.key] ?? b.key}（{Math.round(b.weight * 100)}%）：
                {b.contributed && b.score !== null
                  ? `${b.score}（${b.rawValue}）`
                  : d.notFetched}
              </li>
            ))}
          </ul>
          <span className="mt-1 block text-ink/50">{d.formulaHint}</span>
          {detail.metrics.failures.length > 0 ? (
            <span className="mt-1 block text-ink/50">
              {d.failuresLabel}：{detail.metrics.failures.join("；")}
            </span>
          ) : null}
          <span className="mt-1 block text-ink/40">
            {d.fetchedAt}：{detail.metrics.fetchedAt}
          </span>
        </span>
      ) : null}
    </span>
  );
}
