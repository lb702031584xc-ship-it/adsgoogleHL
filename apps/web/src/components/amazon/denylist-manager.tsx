"use client";

/**
 * 别碰清单管理（批次5追加）：用户维护"不测什么"名单。
 * 增删 denylist_entries；命中第 6 道门直接杀。
 */
import { useEffect, useState } from "react";
import {
  addDenylistAction,
  deleteDenylistAction,
  listDenylistAction,
  type DenylistEntry,
} from "@/lib/api/amazon-pipeline-actions";

export interface DenylistDict {
  title: string;
  desc: string;
  typeLabel: string;
  valueLabel: string;
  valuePlaceholder: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  add: string;
  adding: string;
  delete: string;
  empty: string;
  loadError: string;
  types: Record<string, string>;
}

const TYPES = ["asin", "keyword", "brand", "category"] as const;

export function DenylistManager({ dict: d }: { dict: DenylistDict }) {
  const [items, setItems] = useState<DenylistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<string>("keyword");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const r = await listDenylistAction();
    setLoading(false);
    if (r.ok) {
      setItems(r.data.items);
    } else {
      setMsg(r.error);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onAdd() {
    if (!value.trim()) return;
    setAdding(true);
    setMsg(null);
    const r = await addDenylistAction({
      type,
      value: value.trim(),
      reason: reason.trim() || undefined,
    });
    setAdding(false);
    if (!r.ok) {
      setMsg(r.error);
      return;
    }
    setValue("");
    setReason("");
    void reload();
  }

  async function onDelete(id: string) {
    const r = await deleteDenylistAction(id);
    if (!r.ok) {
      setMsg(r.error);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-5">
      <h2 className="text-base font-semibold text-ink">🚫 {d.title}</h2>
      <p className="mt-1 text-sm text-ink/60">{d.desc}</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-ink/60">{d.typeLabel}</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {d.types[t] ?? t}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs text-ink/60">{d.valueLabel}</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={d.valuePlaceholder}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="mb-1 block text-xs text-ink/60">{d.reasonLabel}</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={d.reasonPlaceholder}
            className="w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink"
          />
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !value.trim()}
          className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
        >
          {adding ? d.adding : d.add}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/50">…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink/50">{d.empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm"
              >
                <span className="rounded bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/70">
                  {d.types[i.type] ?? i.type}
                </span>
                <span className="font-mono text-ink">{i.value}</span>
                {i.reason && <span className="text-xs text-ink/50">{i.reason}</span>}
                <button
                  type="button"
                  onClick={() => onDelete(i.id)}
                  className="ml-auto text-xs text-red-600 hover:underline"
                >
                  {d.delete}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
