"use client";

/**
 * 首单进度卡片（第十五批）：累计花费 / 累计点击 / 预估转化 + 距首单进度条。
 * 花费无现有数据来源，支持手动录入；转化数为估算（明确标注）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getFirstWinAction,
  saveManualSpendAction,
  type FirstWinData,
} from "@/lib/api/first-win-actions";

export interface FirstWinDict {
  title: string;
  spend: string;
  clicks: string;
  estConversions: string;
  estNote: string;
  manualSpendHint: string;
  save: string;
  progressToFirst: string;
  doneMsg: string;
  insight: string;
  goQuickstart: string;
}

function interp(tpl: string, params: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

export function FirstWinCard({ dict: d }: { dict: FirstWinDict }) {
  const [data, setData] = useState<FirstWinData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spendInput, setSpendInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getFirstWinAction().then((r) => {
      if (r.ok) {
        setData(r.data);
        setSpendInput(String(r.data.manualSpend));
      } else {
        setError(r.error);
      }
    });
  }, []);

  async function onSave() {
    const v = Number(spendInput);
    if (!Number.isFinite(v) || v < 0) return;
    setSaving(true);
    const r = await saveManualSpendAction(v);
    setSaving(false);
    if (r.ok) {
      setData(r.data);
      setEditing(false);
    }
  }

  if (error) return null;
  if (!data) {
    return (
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <p className="text-sm text-ink/50">…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-ink">🎯 {d.title}</h2>
        <Link href="/quickstart" className="text-xs text-signal hover:underline">
          {d.goQuickstart} →
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/70 p-3">
          <p className="text-xs text-ink/55">{d.spend}</p>
          <p className="mt-0.5 text-xl font-bold text-ink">${data.manualSpend.toFixed(2)}</p>
          {editing ? (
            <div className="mt-1 flex items-center gap-1">
              <input
                inputMode="decimal"
                value={spendInput}
                onChange={(e) => setSpendInput(e.target.value)}
                className="w-20 rounded border border-ink/15 px-1.5 py-0.5 text-xs"
              />
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="rounded bg-ink px-2 py-0.5 text-xs text-white disabled:opacity-50"
              >
                {d.save}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-1 text-[11px] text-signal hover:underline"
            >
              {d.manualSpendHint}
            </button>
          )}
        </div>
        <div className="rounded-lg bg-white/70 p-3">
          <p className="text-xs text-ink/55">{d.clicks}</p>
          <p className="mt-0.5 text-xl font-bold text-ink">{data.clicks}</p>
        </div>
        <div className="rounded-lg bg-white/70 p-3">
          <p className="text-xs text-ink/55">{d.estConversions}</p>
          <p className="mt-0.5 text-xl font-bold text-ink">{data.estimatedConversions}</p>
          <p className="text-[10px] text-ink/40">{d.estNote}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-ink/70">{d.progressToFirst}</span>
          <span className="text-ink/55">{data.progressPct}%</span>
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-ink/[0.08]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
            style={{ width: `${data.progressPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink/60">
          {data.firstOrderDone
            ? d.doneMsg
            : interp(d.insight, {
                clicks: data.clicks,
                left: data.clicksToFirstOrder,
                cvr: data.estimatedCvrPct,
              })}
        </p>
      </div>
    </div>
  );
}
