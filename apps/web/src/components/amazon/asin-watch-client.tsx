"use client";

/**
 * 需求监控页（第十批）：跟踪列表 + 异动徽标 + 阈值设置。
 */
import { useEffect, useState } from "react";
import {
  checkAsinWatchAction,
  deleteAsinWatchAction,
  listAsinWatchesAction,
  saveWatchThresholdsAction,
  type AsinWatchItem,
  type SurgeThresholds,
} from "@/lib/api/asin-watch-actions";
import type { AmazonWatchDict } from "@/i18n/dict/amazon-watch";

export function AsinWatchClient({ dict: d }: { dict: AmazonWatchDict }) {
  const [items, setItems] = useState<AsinWatchItem[]>([]);
  const [, setThresholds] = useState<SurgeThresholds>({ growthPct: 50, growthAbs: 500 });
  const [pct, setPct] = useState("50");
  const [abs, setAbs] = useState("500");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    const r = await listAsinWatchesAction();
    setLoading(false);
    if (r.ok) {
      setItems(r.data.items);
      setThresholds(r.data.thresholds);
      setPct(String(r.data.thresholds.growthPct));
      setAbs(String(r.data.thresholds.growthAbs));
    } else {
      setError(r.error);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onSave() {
    setSaving(true);
    setMsg(null);
    const r = await saveWatchThresholdsAction({
      growthPct: Number(pct),
      growthAbs: Number(abs),
    });
    setSaving(false);
    if (r.ok) {
      setThresholds(r.data.thresholds);
      setMsg(d.saved);
    } else {
      setMsg(r.error);
    }
  }

  async function onCheck() {
    setChecking(true);
    setMsg(null);
    const r = await checkAsinWatchAction();
    setChecking(false);
    if (r.ok) {
      setMsg(`${d.checkDone}：快照 ${r.data.snapshots}，异动 ${r.data.surges}`);
      void reload();
    } else {
      setMsg(r.error);
    }
  }

  async function onDelete(id: string) {
    const r = await deleteAsinWatchAction(id);
    if (r.ok) setItems((prev) => prev.filter((i) => i.id !== id));
    else setMsg(r.error);
  }

  const surgedCount = items.filter((i) => i.surged).length;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {d.title}
              {surgedCount > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">
                  🔥 {surgedCount} {d.surged}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-ink/60">{d.description}</p>
            <p className="mt-1 text-xs text-ink/50">{d.methodNote}</p>
          </div>
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {checking ? d.checking : d.checkNow}
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-ink/70">{msg}</p>}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.thresholdsTitle}</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-ink/70">{d.growthPctLabel}</label>
            <input
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">{d.growthAbsLabel}</label>
            <input
              inputMode="numeric"
              value={abs}
              onChange={(e) => setAbs(e.target.value)}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-ink/50">{d.thresholdsHint}</p>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="mt-3 rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? d.saving : d.save}
        </button>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5">
        {loading ? (
          <p className="text-sm text-ink/50">…</p>
        ) : error ? (
          <p className="text-sm text-red-600">{d.loadError}：{error}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink/50">{d.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs text-ink/50">
                  <th className="py-2 pr-3">{d.asin}</th>
                  <th className="py-2 pr-3">{d.title_col}</th>
                  <th className="py-2 pr-3">{d.latestReviews}</th>
                  <th className="py-2 pr-3">{d.latestRating}</th>
                  <th className="py-2 pr-3">{d.growth7d}</th>
                  <th className="py-2 pr-3">{d.status}</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-ink/5">
                    <td className="py-2 pr-3 font-mono text-xs">{i.asin}</td>
                    <td className="py-2 pr-3 text-ink/80">{i.title ?? "—"}</td>
                    <td className="py-2 pr-3">{i.latest?.reviewCount ?? d.noData}</td>
                    <td className="py-2 pr-3">{i.latest?.rating ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {i.growthPct !== null ? (
                        <span className={i.surged ? "font-semibold text-red-600" : "text-ink/70"}>
                          {i.growthPct > 0 ? "+" : ""}{i.growthPct}%
                          {i.growthAbs !== null && ` (${i.growthAbs > 0 ? "+" : ""}${i.growthAbs})`}
                        </span>
                      ) : (
                        <span className="text-ink/40">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {i.surged ? (
                        <span
                          title={i.surgeReason ?? ""}
                          className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
                        >
                          🔥 {d.surged}
                        </span>
                      ) : (
                        <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
                          {d.normal}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete(i.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {d.unwatch}
                      </button>
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
