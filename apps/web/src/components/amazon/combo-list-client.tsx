"use client";

/**
 * 组合测试列表（第九批）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { listComboTestsAction, type ComboTestSummary } from "@/lib/api/combo-actions";
import type { AmazonComboDict } from "@/i18n/dict/amazon-combo";

export function ComboListClient({ dict: d }: { dict: AmazonComboDict }) {
  const [items, setItems] = useState<ComboTestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listComboTestsAction().then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.ok) setItems(r.data.items);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-sm text-ink/50">…</p>;
  if (error) return <p className="text-sm text-red-600">{d.loadError}：{error}</p>;
  if (items.length === 0) return <p className="text-sm text-ink/50">{d.empty}</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((t) => (
        <div key={t.id} className="rounded-xl border border-ink/10 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">{t.name}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                t.status === "completed"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-sky-100 text-sky-800"
              }`}
            >
              {t.status === "completed" ? d.completed : d.running}
            </span>
          </div>
          <div className="mt-2 flex gap-4 text-sm text-ink/60">
            <span>
              {d.totalClicks}：<span className="font-semibold text-ink">{t.totalClicks}</span>
            </span>
            <span>
              {d.itemCount}：{t.itemCount}
            </span>
          </div>
          <Link
            href={`/amazon/combo/${t.id}`}
            className="mt-3 inline-block rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper"
          >
            {d.viewDetail}
          </Link>
        </div>
      ))}
    </div>
  );
}
