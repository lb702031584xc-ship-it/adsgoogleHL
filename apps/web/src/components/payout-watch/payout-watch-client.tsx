"use client";

/**
 * Automation pack ③ — payout (commission) change monitoring UI.
 * Offer dropdown + add button, watch table with change highlighting,
 * enable/disable toggle, and expandable change history (latest 5).
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import {
  disablePayoutWatchAction,
  enablePayoutWatchAction,
  listOfferOptionsAction,
  listPayoutWatchesAction,
  type OfferOption,
  type PayoutWatchItem,
} from "@/lib/api/payout-watch-actions";
import { zh as pwZh, en as pwEn } from "@/i18n/dict/payout-watch";

type Dict = typeof pwZh.payoutWatch;

function fmtPayout(v: number | null, unset: string): string {
  return v === null || v === undefined ? unset : String(v);
}

export function PayoutWatchClient() {
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "en";
  }
  const d: Dict = (lang === "en" ? pwEn : pwZh).payoutWatch;

  const [watches, setWatches] = useState<PayoutWatchItem[]>([]);
  const [options, setOptions] = useState<OfferOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [adding, setAdding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  const watchedIds = useMemo(
    () => new Set(watches.map((w) => w.offerId)),
    [watches]
  );
  const availableOptions = useMemo(
    () => options.filter((o) => !watchedIds.has(o.id)),
    [options, watchedIds]
  );

  async function refreshWatches() {
    const res = await listPayoutWatchesAction();
    if (!res.ok) {
      setError(res.error || d.loadFailed);
      return;
    }
    setWatches(res.data.items);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [wRes, oRes] = await Promise.all([
        listPayoutWatchesAction(),
        listOfferOptionsAction(),
      ]);
      setLoading(false);
      if (!wRes.ok) {
        setError(wRes.error || d.loadFailed);
        return;
      }
      setWatches(wRes.data.items);
      if (oRes.ok) setOptions(oRes.data.items);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOfferId) {
      setError(d.needOffer);
      return;
    }
    setError(null);
    setNote(null);
    setAdding(true);
    try {
      const res = await enablePayoutWatchAction(selectedOfferId);
      if (!res.ok) {
        setError(res.error || d.addFailed);
        return;
      }
      const addedName =
        availableOptions.find((o) => o.id === selectedOfferId)?.name ?? "";
      setSelectedOfferId("");
      await refreshWatches();
      if (addedName) setNote(d.added(addedName));
    } finally {
      setAdding(false);
    }
  }

  async function onToggle(watch: PayoutWatchItem) {
    setTogglingId(watch.id);
    setError(null);
    try {
      const res = watch.enabled
        ? await disablePayoutWatchAction(watch.offerId)
        : await enablePayoutWatchAction(watch.offerId);
      if (!res.ok) {
        setError(res.error || d.toggleFailed);
        return;
      }
      setWatches((ws) =>
        ws.map((w) =>
          w.id === watch.id ? { ...w, enabled: !watch.enabled } : w
        )
      );
    } finally {
      setTogglingId(null);
    }
  }

  function changeBadge(w: PayoutWatchItem) {
    if (w.lastPayout === null || w.currentPayout === null) return null;
    if (w.currentPayout === w.lastPayout) return null;
    const up = w.currentPayout > w.lastPayout;
    return (
      <span
        className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
          up ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
        }`}
      >
        {up ? d.changeUp : d.changeDown}
      </span>
    );
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {/* Add form */}
      <form
        onSubmit={onAdd}
        className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-5"
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <label className={labelClass}>{d.offerLabel}</label>
            <select
              className={inputClass}
              value={selectedOfferId}
              onChange={(e) => setSelectedOfferId(e.target.value)}
            >
              <option value="">{d.offerLabel}</option>
              {availableOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}（{o.network}）
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {adding ? d.adding : d.add}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {note && (
        <div className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {note}
        </div>
      )}

      {/* Watch table */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-ink/10 bg-white">
        {loading ? (
          <div className="p-5 text-sm text-ink/60">…</div>
        ) : watches.length === 0 ? (
          <div className="p-5 text-sm text-ink/60">{d.noWatches}</div>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                <th className="px-4 py-3 font-semibold">{d.columns.offer}</th>
                <th className="px-4 py-3 font-semibold">{d.columns.currentPayout}</th>
                <th className="px-4 py-3 font-semibold">{d.columns.lastPayout}</th>
                <th className="px-4 py-3 font-semibold">{d.columns.lastChecked}</th>
                <th className="px-4 py-3 font-semibold">{d.columns.enabled}</th>
                <th className="px-4 py-3 font-semibold">{d.columns.history}</th>
                <th className="px-4 py-3 font-semibold">{d.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => {
                const expanded = expandedId === w.id;
                const history = [...(w.changeHistory ?? [])]
                  .reverse()
                  .slice(0, 5);
                return (
                  <Fragment key={w.id}>
                    <tr className="border-b border-ink/10">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">
                          {w.offerName ?? w.offerId}
                        </div>
                        {w.offerNetwork && (
                          <div className="text-xs text-ink/50">
                            {w.offerNetwork}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-ink">
                          {fmtPayout(w.currentPayout, d.unset)}
                        </span>
                        {changeBadge(w)}
                      </td>
                      <td className="px-4 py-3 text-ink/70">
                        {w.lastPayout === null ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            {d.baselineNote}
                          </span>
                        ) : (
                          fmtPayout(w.lastPayout, d.unset)
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink/60">
                        {w.lastCheckedAt
                          ? formatDateTime(w.lastCheckedAt)
                          : d.neverChecked}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={w.enabled}
                          onClick={() => onToggle(w)}
                          disabled={togglingId === w.id}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                            w.enabled ? "bg-signal" : "bg-ink/20"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              w.enabled ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(expanded ? null : w.id)
                          }
                          className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60 hover:bg-ink/15"
                        >
                          {w.changeCount} {d.changes} ·{" "}
                          {expanded ? d.hideHistory : d.viewHistory}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onToggle(w)}
                          disabled={togglingId === w.id}
                          className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-ink/5 disabled:opacity-50"
                        >
                          {togglingId === w.id
                            ? d.toggling
                            : w.enabled
                              ? d.disable
                              : d.enable}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-ink/[0.02]">
                        <td colSpan={7} className="px-4 py-3">
                          {history.length === 0 ? (
                            <div className="text-xs text-ink/50">
                              {d.noHistory}
                            </div>
                          ) : (
                            <ul className="space-y-1 text-xs text-ink/70">
                              {history.map((h, i) => (
                                <li key={i}>
                                  <span className="text-ink/50">
                                    {d.changedAt}：
                                    {formatDateTime(h.changedAt)}
                                  </span>{" "}
                                  <span className="line-through decoration-red-300">
                                    {fmtPayout(h.oldPayout, d.unset)}
                                  </span>{" "}
                                  →{" "}
                                  <span className="font-medium text-ink">
                                    {fmtPayout(h.newPayout, d.unset)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
