"use client";

/**
 * 功能 1 — 返利比例监控（rate-watch）展示组件。
 * 每行：offer 信息 + 宣传比例/抓取 URL 输入 + 状态徽章 + 立即检查按钮。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as rateWatchZh, en as rateWatchEn } from "@/i18n/dict/cashback-rate-watch";
import {
  checkRateNowAction,
  setRateAndCheckAction,
  type RateCheckStatus,
  type RateWatchRow,
} from "@/lib/api/cashback-rate-watch-actions";
import type { CashbackOffer } from "@/lib/api/cashback";

function StatusBadge({
  status,
  okLabel,
  mismatchLabel,
  unreachableLabel,
}: {
  status: RateCheckStatus | null;
  okLabel: string;
  mismatchLabel: string;
  unreachableLabel: string;
}) {
  if (status === "ok")
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        {okLabel}
      </span>
    );
  if (status === "mismatch")
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        {mismatchLabel}
      </span>
    );
  if (status === "unreachable")
    return (
      <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-600">
        {unreachableLabel}
      </span>
    );
  return null;
}

export function RateWatchClient({
  offers,
  checks,
}: {
  offers: CashbackOffer[];
  checks: RateWatchRow[];
}) {
  const router = useRouter();
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d = lang === "en" ? rateWatchEn : rateWatchZh;

  const checkByOffer = new Map(checks.map((c) => [c.cashbackOfferId, c]));

  const [advertised, setAdvertised] = useState<Record<string, string>>({});
  const [rateUrl, setRateUrl] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  function advertisedFor(offer: CashbackOffer): string {
    return (
      advertised[offer.id] ??
      checkByOffer.get(offer.id)?.advertisedRate ??
      ""
    );
  }
  function rateUrlFor(offer: CashbackOffer): string {
    return rateUrl[offer.id] ?? checkByOffer.get(offer.id)?.rateUrl ?? "";
  }

  async function onSaveAndCheck(offer: CashbackOffer) {
    const adv = advertisedFor(offer).trim();
    if (!adv) {
      setMsg(d.msg.setFirst);
      return;
    }
    setBusy((b) => ({ ...b, [offer.id]: true }));
    setMsg(null);
    try {
      const url = rateUrlFor(offer).trim();
      const res = await setRateAndCheckAction(offer.id, {
        advertisedRate: adv,
        ...(url ? { rateUrl: url } : {}),
      });
      if (res.ok) {
        setMsg(d.msg.updated);
        router.refresh();
      } else {
        setMsg(`${d.page.checkFailed}${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [offer.id]: false }));
    }
  }

  async function onCheckNow(offer: CashbackOffer, check: RateWatchRow) {
    setBusy((b) => ({ ...b, [offer.id]: true }));
    setMsg(null);
    try {
      const res = await checkRateNowAction(offer.id, {
        advertisedRate: check.advertisedRate,
        rateUrl: check.rateUrl,
      });
      if (res.ok) {
        setMsg(d.msg.updated);
        router.refresh();
      } else {
        setMsg(`${d.page.checkFailed}${res.error}`);
      }
    } finally {
      setBusy((b) => ({ ...b, [offer.id]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader title={d.page.title} description={d.page.description} />

      {msg && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      {offers.length === 0 ? (
        <p className="text-sm text-gray-500">{d.page.noOffers}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.network}</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.advertisedRate}</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.rateUrl}</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.detectedRate}</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.status}</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.checkedAt}</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500">{d.columns.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {offers.map((offer) => {
                const check = checkByOffer.get(offer.id);
                const isBusy = !!busy[offer.id];
                return (
                  <tr key={offer.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{offer.cashbackNetwork}</div>
                      <div className="mt-0.5 max-w-56 truncate text-xs text-gray-400" title={offer.originalUrl}>
                        {offer.originalUrl}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={advertisedFor(offer)}
                        onChange={(e) =>
                          setAdvertised((s) => ({ ...s, [offer.id]: e.target.value }))
                        }
                        placeholder={d.form.advertisedRatePlaceholder}
                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={rateUrlFor(offer)}
                        onChange={(e) =>
                          setRateUrl((s) => ({ ...s, [offer.id]: e.target.value }))
                        }
                        placeholder={d.form.rateUrlPlaceholder}
                        className="w-48 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {check?.detectedRate ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {check ? (
                        <StatusBadge
                          status={check.status}
                          okLabel={d.status.ok}
                          mismatchLabel={d.status.mismatch}
                          unreachableLabel={d.status.unreachable}
                        />
                      ) : (
                        <span className="text-xs text-gray-400">{d.status.neverChecked}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {check ? formatDateTime(check.checkedAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSaveAndCheck(offer)}
                          disabled={isBusy}
                          className="rounded-lg bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                        >
                          {isBusy ? d.form.saving : d.form.saveAndCheck}
                        </button>
                        {check && (
                          <button
                            type="button"
                            onClick={() => onCheckNow(offer, check)}
                            disabled={isBusy}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                          >
                            {isBusy ? d.form.checking : d.form.checkNow}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
