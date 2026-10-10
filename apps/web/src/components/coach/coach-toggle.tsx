"use client";

/**
 * 教练模式开关（第十三批）：侧边栏用户区小开关，老手可关，默认开。
 * 另可设置日预算上限（超限建广告时二次确认）。
 */
import { useEffect, useState } from "react";
import {
  getCoachSettingsAction,
  saveCoachSettingsAction,
} from "@/lib/api/coach-actions";
import type { CoachDict } from "@/i18n/dict/coach";

export function CoachToggle({ dict: d }: { dict: CoachDict }) {
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingLimit, setEditingLimit] = useState(false);

  useEffect(() => {
    void getCoachSettingsAction().then((r) => {
      if (r.ok) {
        setEnabled(r.data.enabled);
        setLimit(r.data.dailyBudgetLimit != null ? String(r.data.dailyBudgetLimit) : "");
      }
      setLoaded(true);
    });
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    const r = await saveCoachSettingsAction({ enabled: next });
    setSaving(false);
    if (!r.ok) setEnabled(!next);
  }

  async function saveLimit() {
    const v = limit.trim() === "" ? null : Number(limit);
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
    setSaving(true);
    const r = await saveCoachSettingsAction({ dailyBudgetLimit: v });
    setSaving(false);
    if (r.ok) setEditingLimit(false);
  }

  if (!loaded) return null;

  return (
    <div className="mt-2 rounded-md bg-white/5 px-2 py-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs text-mist/80">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={saving}
          className="h-3.5 w-3.5 accent-amber-400"
        />
        🧭 {d.toggleLabel}
      </label>
      {editingLimit ? (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="50"
            className="w-20 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white placeholder:text-mist/40"
          />
          <button
            type="button"
            onClick={saveLimit}
            disabled={saving}
            className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
          >
            ✓
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditingLimit(true)}
          className="mt-1 text-[11px] text-mist/50 hover:text-mist"
        >
          {d.budgetLimitLabel}：{limit ? `$${limit}` : "—"}
        </button>
      )}
    </div>
  );
}
