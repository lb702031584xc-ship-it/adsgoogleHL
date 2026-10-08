"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { en as cashbackEn, zh as cashbackZh } from "@/i18n/dict/cashback";
import { en as lpScoreEn, zh as lpScoreZh } from "@/i18n/dict/cashback-lp-score";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  batchLpScoresAction,
  closeAdsPowerBrowserAction,
  createCashbackOfferAction,
  deleteCashbackOfferAction,
  listAdsPowerProfilesAction,
  listCashbackOffersAction,
  openAdsPowerBrowserAction,
  updateCashbackOfferAction,
} from "@/lib/api/cashback-actions";
import type { AdsPowerProfile, CashbackOffer, LpScoreEntry } from "@/lib/api/cashback";

function useCashbackDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? cashbackZh : cashbackEn;
}

/** Feature: lp-cashback-score — dict for the 合规分 column. */
function useLpScoreDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return (lang === "zh" ? lpScoreZh : lpScoreEn).score;
}

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
const monoClass = "font-mono text-[13px]";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

const NETWORKS = ["rakuten", "55haitao", "ebates", "topcashback", "other"] as const;

/** Cashback offers: list + create form (network / URL / AdsPower profile). */
export function CashbackOffersClient() {
  const d = useCashbackDict();
  const sd = useLpScoreDict();
  const [offers, setOffers] = useState<CashbackOffer[]>([]);
  const [lpScores, setLpScores] = useState<Record<string, LpScoreEntry | null>>(
    {}
  );
  const [profiles, setProfiles] = useState<AdsPowerProfile[]>([]);
  const [adspowerOk, setAdspowerOk] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [network, setNetwork] = useState<string>("rakuten");
  const [originalUrl, setOriginalUrl] = useState("");
  const [adspowerProfileId, setAdspowerProfileId] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyProfile, setBusyProfile] = useState<string | null>(null);

  async function refresh() {
    const res = await listCashbackOffersAction();
    if (res.ok) {
      const items = res.data.items;
      setOffers(items);
      // Feature: lp-cashback-score — load compliance scores for each row's
      // tracking link in one batch call.
      const ids = items
        .map((o) => o.trackingLinkId)
        .filter((id): id is string => !!id);
      if (ids.length > 0) {
        const s = await batchLpScoresAction(ids);
        if (s.ok) setLpScores(s.data);
      } else {
        setLpScores({});
      }
    } else setError(res.error);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      await refresh();
      const p = await listAdsPowerProfilesAction();
      if (p.ok) {
        setProfiles(p.data.profiles);
        setAdspowerOk(true);
      } else {
        setAdspowerOk(false);
      }
      setLoading(false);
    })();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!originalUrl.trim()) {
      setError(d.offers.originalUrl);
      return;
    }
    setCreating(true);
    try {
      const res = await createCashbackOfferAction({
        cashbackNetwork: network,
        originalUrl: originalUrl.trim(),
        ...(adspowerProfileId ? { adspowerProfileId } : {}),
      });
      if (res.ok) {
        setNotice(d.offers.created);
        setOriginalUrl("");
        setAdspowerProfileId("");
        await refresh();
      } else {
        setError(res.error);
      }
    } finally {
      setCreating(false);
    }
  }

  async function onToggleStatus(offer: CashbackOffer) {
    const next = offer.status === "active" ? "paused" : "active";
    const res = await updateCashbackOfferAction(offer.id, { status: next });
    if (res.ok) await refresh();
    else setError(res.error);
  }

  async function onDelete(offer: CashbackOffer) {
    if (!window.confirm(d.offers.deleteConfirm)) return;
    const res = await deleteCashbackOfferAction(offer.id);
    if (res.ok) {
      setNotice(d.offers.deleted);
      await refresh();
    } else setError(res.error);
  }

  async function onOpenBrowser(profileId: string) {
    setBusyProfile(profileId);
    setNotice(null);
    const res = await openAdsPowerBrowserAction(profileId);
    setBusyProfile(null);
    if (res.ok) setNotice(d.adspower.opened);
    else setError(res.error);
  }

  async function onCloseBrowser(profileId: string) {
    setBusyProfile(profileId);
    setNotice(null);
    const res = await closeAdsPowerBrowserAction(profileId);
    setBusyProfile(null);
    if (res.ok) setNotice(d.adspower.closed);
    else setError(res.error);
  }

  const profileName = (id: string | null) =>
    profiles.find((p) => p.userId === id)?.name ?? id ?? "—";

  /** Feature: lp-cashback-score — 合规分 badge cell for one offer row. */
  function renderLpScoreCell(o: CashbackOffer) {
    const entry: LpScoreEntry | null =
      o.trackingLinkId != null ? (lpScores[o.trackingLinkId] ?? null) : null;
    if (!entry) {
      return (
        <span className="text-xs text-ink/40" title={sd.noLandingPage}>
          —
        </span>
      );
    }
    const color =
      entry.score >= 80
        ? "bg-emerald-100 text-emerald-800"
        : entry.score >= 70
          ? "bg-amber-100 text-amber-800"
          : "bg-red-100 text-red-800";
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
        title={entry.issues.map((code) => sd.issues[code] ?? code).join("；")}
      >
        {entry.score}
      </span>
    );
  }

  return (
    <div className="space-y-8">
      <EntityPageHeader title={d.offers.title} description={d.offers.description} />

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

      {/* Create form */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">{d.offers.addTitle}</h2>
        <form onSubmit={onCreate} className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink/70">{d.offers.network}</span>
            <select
              className={inputClass}
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
            >
              {NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {d.offers.networks[n]}
                </option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-ink/70">{d.offers.originalUrl}</span>
            <input
              className={`${inputClass} font-mono`}
              placeholder={d.offers.originalUrlPlaceholder}
              value={originalUrl}
              onChange={(e) => setOriginalUrl(e.target.value)}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-ink/70">
              {d.offers.adspowerProfile}
            </span>
            <select
              className={inputClass}
              value={adspowerProfileId}
              onChange={(e) => setAdspowerProfileId(e.target.value)}
            >
              <option value="">{d.offers.adspowerProfileNone}</option>
              {profiles.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink/50">
              {d.offers.adspowerProfileHint}
            </span>
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary} disabled={creating}>
              {creating ? d.offers.creating : d.offers.submit}
            </button>
          </div>
        </form>
      </section>

      {/* AdsPower panel */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">{d.adspower.title}</h2>
        <p className="mt-1 text-sm text-ink/60">{d.adspower.description}</p>
        {adspowerOk === false ? (
          <p className="mt-3 text-sm text-amber-700">{d.adspower.notConfigured}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/10">
            {profiles.map((p) => (
              <li key={p.userId} className="flex items-center justify-between py-2">
                <span className="text-sm text-ink">
                  {p.name}
                  <span className={`${monoClass} ml-2 text-ink/40`}>{p.userId}</span>
                </span>
                <span className="flex gap-2">
                  <button
                    className={btnGhost}
                    disabled={busyProfile === p.userId}
                    onClick={() => onOpenBrowser(p.userId)}
                  >
                    {busyProfile === p.userId ? d.adspower.opening : d.adspower.open}
                  </button>
                  <button
                    className={btnGhost}
                    disabled={busyProfile === p.userId}
                    onClick={() => onCloseBrowser(p.userId)}
                  >
                    {busyProfile === p.userId ? d.adspower.closing : d.adspower.close}
                  </button>
                </span>
              </li>
            ))}
            {adspowerOk && profiles.length === 0 && (
              <li className="py-2 text-sm text-ink/50">—</li>
            )}
          </ul>
        )}
      </section>

      {/* Offer list */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        {loading ? (
          <p className="text-sm text-ink/60">{d.common.loading}</p>
        ) : offers.length === 0 ? (
          <p className="text-sm text-ink/60">{d.offers.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-ink/60">
                  <th className="py-2 pr-4 font-medium">{d.offers.columns.network}</th>
                  <th className="py-2 pr-4 font-medium">{d.offers.columns.originalUrl}</th>
                  <th className="py-2 pr-4 font-medium">{d.offers.columns.trackingLink}</th>
                  <th className="py-2 pr-4 font-medium">{sd.column}</th>
                  <th className="py-2 pr-4 font-medium">{d.offers.columns.adspower}</th>
                  <th className="py-2 pr-4 font-medium">{d.offers.columns.status}</th>
                  <th className="py-2 font-medium">{d.offers.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-b border-ink/5 last:border-0">
                    <td className="py-2 pr-4 text-ink">
                      {d.offers.networks[o.cashbackNetwork as keyof typeof d.offers.networks] ??
                        o.cashbackNetwork}
                    </td>
                    <td className="max-w-[280px] truncate py-2 pr-4" title={o.originalUrl}>
                      <span className={monoClass}>{o.originalUrl}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={monoClass} title={o.trackingLinkId ?? ""}>
                        {o.trackingLink?.publicId ?? "—"}
                      </span>
                    </td>
                    {/* Feature: lp-cashback-score — 合规分 column */}
                    <td className="py-2 pr-4">{renderLpScoreCell(o)}</td>
                    <td className="py-2 pr-4 text-ink/70">
                      {profileName(o.adspowerProfileId)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          o.status === "active"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-ink/10 text-ink/60"
                        }`}
                      >
                        {o.status === "active" ? d.offers.status.active : d.offers.status.paused}
                      </span>
                    </td>
                    <td className="flex gap-2 py-2">
                      <button className={btnGhost} onClick={() => onToggleStatus(o)}>
                        {o.status === "active" ? d.offers.pause : d.offers.activate}
                      </button>
                      <button className={btnGhost} onClick={() => onDelete(o)}>
                        {d.offers.delete}
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
