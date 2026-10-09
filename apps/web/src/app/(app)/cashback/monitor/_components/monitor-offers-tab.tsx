"use client";

/**
 * 返利监控统一页面 — Offer 列表 tab。
 *
 * Offer 增删复用已有的 createCashbackOfferAction / deleteCashbackOfferAction /
 * listCashbackOffersAction（@/lib/api/cashback-actions），不重写 API 调用逻辑。
 *
 * 「返利网络名称」为 combobox：<input list> + <datalist>，建议项来自
 * 已有 offer 去重后的网络名 + 常用常量；用户可手打任意新名称
 * （API 已放开白名单：trim 后 1–64 字符）。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/api/entities-config";
import {
  createCashbackOfferAction,
  deleteCashbackOfferAction,
  listCashbackOffersAction,
} from "@/lib/api/cashback-actions";
import type { CashbackOffer } from "@/lib/api/cashback";
import type { CashbackMonitorDict } from "@/i18n/dict/cashback-monitor";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const monoClass = "font-mono text-[13px]";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

/** 常用返利网络建议（仅前端建议，非白名单）。 */
const NETWORK_SUGGESTIONS = [
  "rakuten",
  "55haitao",
  "ebates",
  "topcashback",
] as const;

function asHttpUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

export function MonitorOffersTab({
  dict,
  initialOffers,
}: {
  dict: CashbackMonitorDict["offers"];
  initialOffers: CashbackOffer[];
}) {
  const router = useRouter();
  const [offers, setOffers] = useState<CashbackOffer[]>(initialOffers);
  const [network, setNetwork] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** datalist 建议：已有 offer 的网络名（去重）+ 常用常量。 */
  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const o of offers) {
      const n = o.cashbackNetwork?.trim();
      if (n) set.add(n);
    }
    for (const n of NETWORK_SUGGESTIONS) set.add(n);
    return [...set];
  }, [offers]);

  async function refresh() {
    const res = await listCashbackOffersAction();
    if (res.ok) setOffers(res.data.items);
    // 让其它 tab 的 server 数据也刷新。
    router.refresh();
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const name = network.trim();
    if (!name || name.length > 64) {
      setError(dict.networkRequired);
      return;
    }
    const url = asHttpUrl(originalUrl);
    if (!url) {
      setError(dict.urlRequired);
      return;
    }
    setCreating(true);
    try {
      const res = await createCashbackOfferAction({
        cashbackNetwork: name,
        originalUrl: url,
      });
      if (res.ok) {
        setNotice(dict.created);
        setNetwork("");
        setOriginalUrl("");
        await refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(offer: CashbackOffer) {
    if (!window.confirm(dict.deleteConfirm)) return;
    setError(null);
    setNotice(null);
    setBusyId(offer.id);
    try {
      const res = await deleteCashbackOfferAction(offer.id);
      if (res.ok) {
        setNotice(dict.deleted);
        await refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-lg border border-emerald-600/30 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-600/30 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Add form — 网络名为 combobox（input + datalist，可手打任意名称） */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">{dict.addTitle}</h2>
        <form onSubmit={onCreate} className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink/70">{dict.network}</span>
            <input
              className={inputClass}
              list="monitor-network-suggestions"
              placeholder={dict.networkPlaceholder}
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              maxLength={64}
              autoComplete="off"
            />
            <datalist id="monitor-network-suggestions">
              {suggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <span className="mt-1 block text-xs text-ink/50">{dict.networkHint}</span>
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-ink/70">{dict.originalUrl}</span>
            <input
              className={`${inputClass} font-mono`}
              placeholder={dict.originalUrlPlaceholder}
              value={originalUrl}
              onChange={(e) => setOriginalUrl(e.target.value)}
              inputMode="url"
            />
          </label>
          <div className="flex items-end md:col-span-3">
            <button type="submit" className={btnPrimary} disabled={creating}>
              {creating ? dict.adding : dict.submit}
            </button>
          </div>
        </form>
      </section>

      {/* Offer list */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        {offers.length === 0 ? (
          <p className="text-sm text-ink/60">{dict.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-ink/60">
                  <th className="py-2 pr-4 font-medium">{dict.columns.network}</th>
                  <th className="py-2 pr-4 font-medium">{dict.columns.originalUrl}</th>
                  <th className="py-2 pr-4 font-medium">{dict.columns.trackingLink}</th>
                  <th className="py-2 pr-4 font-medium">{dict.columns.status}</th>
                  <th className="py-2 pr-4 font-medium">{dict.columns.createdAt}</th>
                  <th className="py-2 font-medium">{dict.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-b border-ink/5 last:border-0">
                    <td className="py-2 pr-4 text-ink">{o.cashbackNetwork}</td>
                    <td className="max-w-[280px] truncate py-2 pr-4" title={o.originalUrl}>
                      <span className={monoClass}>{o.originalUrl}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={monoClass} title={o.trackingLinkId ?? ""}>
                        {o.trackingLink?.publicId ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          o.status === "active"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-ink/10 text-ink/60"
                        }`}
                      >
                        {o.status === "active" ? dict.status.active : dict.status.paused}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-ink/70">
                      {formatDateTime(o.createdAt)}
                    </td>
                    <td className="py-2">
                      <button
                        className={btnGhost}
                        disabled={busyId === o.id}
                        onClick={() => onDelete(o)}
                      >
                        {dict.delete}
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
