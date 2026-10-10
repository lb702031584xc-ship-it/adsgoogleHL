"use client";

/**
 * 组合测试仪表盘（第九批）：点击排名 + 结论 + 榜单 HTML。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getComboTestAction, type ComboTestDetail } from "@/lib/api/combo-actions";
import type { AmazonComboDict } from "@/i18n/dict/amazon-combo";

export function ComboDetailClient({
  dict: d,
  runId,
}: {
  dict: AmazonComboDict;
  runId: string;
}) {
  const [detail, setDetail] = useState<ComboTestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getComboTestAction(runId).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok) setDetail(r.data);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  async function onCopy() {
    if (!detail?.htmlContent) return;
    try {
      await navigator.clipboard.writeText(detail.htmlContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // 忽略剪贴板失败
    }
  }

  if (loading) return <p className="text-sm text-ink/50">…</p>;
  if (error || !detail)
    return <p className="text-sm text-red-600">{d.loadError}：{error}</p>;

  const progress =
    detail.targetClicks > 0
      ? Math.min(100, (detail.totalClicks / detail.targetClicks) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/amazon/combo" className="text-sm text-signal hover:underline">
          {d.backToList}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{detail.name}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              detail.status === "completed"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-sky-100 text-sky-800"
            }`}
          >
            {detail.status === "completed" ? d.completed : d.running}
          </span>
        </div>
      </div>

      {/* 测试进度 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.testProgress}</h2>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink/60">
          <span>
            {d.totalClicks}：<span className="font-semibold text-ink">{detail.totalClicks}</span>
            {" / "}
            {d.targetClicksLabel} {detail.targetClicks}
          </span>
          <span>
            {d.daysElapsed}：{detail.daysElapsed} / {d.testDaysLabel} {detail.testDays}
          </span>
        </div>
        <div className="mt-2 h-2.5 w-full max-w-md overflow-hidden rounded-full bg-ink/10">
          <div
            className={`h-full rounded-full ${progress >= 100 ? "bg-emerald-500" : "bg-signal"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      {/* 结论 */}
      {detail.conclusion && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-base font-semibold text-emerald-900">{d.conclusionTitle}</h2>
          <p className="mt-1 text-sm text-emerald-900">{detail.conclusion}</p>
        </section>
      )}

      {/* 方法论 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.methodTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink/60">{d.methodBody}</p>
      </section>

      {/* 排名 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.rankingTitle}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs text-ink/50">
                <th className="py-2 pr-3">{d.rank}</th>
                <th className="py-2 pr-3">{d.product}</th>
                <th className="py-2 pr-3">{d.clicks}</th>
                <th className="py-2 pr-3">{d.share}</th>
                <th className="py-2 pr-3">{d.conversions}</th>
              </tr>
            </thead>
            <tbody>
              {detail.ranking.map((r) => (
                <tr key={r.publicId} className="border-b border-ink/5">
                  <td className="py-2 pr-3 font-bold text-ink">
                    {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-ink">{r.title}</div>
                    {r.asin && <div className="font-mono text-xs text-ink/50">{r.asin}</div>}
                  </td>
                  <td className="py-2 pr-3 font-semibold text-ink">{r.clicks}</td>
                  <td className="py-2 pr-3 text-ink/70">{r.sharePct}%</td>
                  <td className="py-2 pr-3 text-ink/70">{r.conversions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 榜单 HTML */}
      {detail.htmlContent && (
        <section className="rounded-xl border border-ink/10 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">{d.htmlTitle}</h2>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper"
            >
              {copied ? d.copied : d.copyHtml}
            </button>
          </div>
          <iframe
            title={d.htmlTitle}
            srcDoc={detail.htmlContent}
            className="mt-3 h-[600px] w-full rounded-lg border border-ink/10 bg-white"
            sandbox="allow-same-origin"
          />
        </section>
      )}
    </div>
  );
}
