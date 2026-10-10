"use client";

/**
 * "7 天跑起来"任务流（第十二批）：进度条 + 7 天任务卡 + 毕业撒花。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  listOnboardTasksAction,
  markOnboardDoneAction,
  unmarkOnboardDoneAction,
  type OnboardTasksData,
} from "@/lib/api/onboard-actions";
import type { QuickstartDict } from "@/i18n/dict/quickstart";

export function QuickstartClient({ dict: d }: { dict: QuickstartDict }) {
  const [data, setData] = useState<OnboardTasksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    const r = await listOnboardTasksAction();
    setLoading(false);
    if (r.ok) {
      setData(r.data);
    } else {
      setError(r.error);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function toggle(key: string, currentlyDone: boolean) {
    setBusy(key);
    const r = currentlyDone
      ? await unmarkOnboardDoneAction(key)
      : await markOnboardDoneAction(key);
    setBusy(null);
    if (r.ok) await reload();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">{d.pageTitle}</h1>
        <p className="mt-1 text-sm text-ink/60">{d.pageSubtitle}</p>
      </div>

      {loading ? (
        <p className="text-sm text-ink/50">…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data ? (
        <>
          <div className="rounded-xl border border-ink/10 bg-white p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-ink">
                {d.progress}：{data.doneCount}/{data.total}
              </span>
              <span className="text-ink/60">
                {data.doneCount === data.total
                  ? d.done
                  : `${d.remaining} ${data.total - data.doneCount}`}
              </span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                style={{ width: `${(data.doneCount / data.total) * 100}%` }}
              />
            </div>
            {data.graduated && (
              <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-center">
                <p className="text-lg font-bold text-amber-800">{d.graduateTitle}</p>
                <p className="mt-1 text-sm text-amber-700">{d.graduateBody}</p>
              </div>
            )}
          </div>

          <ol className="space-y-3">
            {data.items.map((item) => {
              const task = d.tasks[item.key];
              if (!task) return null;
              return (
                <li
                  key={item.key}
                  className={`flex items-start gap-3 rounded-xl border p-4 ${
                    item.done
                      ? "border-emerald-200 bg-emerald-50/50"
                      : "border-ink/10 bg-white"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      item.done
                        ? "bg-emerald-500 text-white"
                        : "bg-ink/[0.06] text-ink/60"
                    }`}
                  >
                    {item.done ? "✓" : item.day}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {d.dayLabel} {item.day} · {task.title}
                    </p>
                    <p className="mt-0.5 text-xs text-ink/60">{task.desc}</p>
                    {item.autoDetected && (
                      <p className="mt-1 text-xs text-emerald-600">✓ {d.autoDetected}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <Link
                        href={item.deepLink}
                        className="text-xs font-medium text-signal hover:underline"
                      >
                        {d.goDo}
                      </Link>
                      <button
                        type="button"
                        disabled={busy === item.key || item.autoDetected}
                        onClick={() => toggle(item.key, item.done)}
                        className="text-xs text-ink/50 hover:text-ink disabled:opacity-40"
                      >
                        {busy === item.key ? "…" : item.done ? d.unmark : d.markDone}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </div>
  );
}
