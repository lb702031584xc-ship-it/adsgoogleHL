"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import {
  createMerchantAction,
  createNetworkAction,
  listMerchantsAction,
  listNetworksAction,
} from "@/lib/api/offer-intel-actions";
import type {
  AffiliateNetwork,
  Merchant,
} from "@/lib/api/offer-intel";

/** Merchant list + create form, plus affiliate-network management. */
export function MerchantsClient() {
  const t = useDict();
  const d = t.ai.intel.merchants;
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [networks, setNetworks] = useState<AffiliateNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fName, setFName] = useState("");
  const [fDomain, setFDomain] = useState("");
  const [fNetworkId, setFNetworkId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [nName, setNName] = useState("");
  const [nWebsite, setNWebsite] = useState("");
  const [addingNetwork, setAddingNetwork] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [m, n] = await Promise.all([
          listMerchantsAction(),
          listNetworksAction(),
        ]);
        if (m.ok) setMerchants(m.data);
        else setError(m.error);
        if (n.ok) setNetworks(n.data);
        else if (!m.ok) setError(n.error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!fName.trim()) {
      setCreateError(d.needName);
      return;
    }
    setCreating(true);
    try {
      const res = await createMerchantAction({
        name: fName.trim(),
        domain: fDomain.trim() || undefined,
        networkId: fNetworkId || undefined,
      });
      if (res.ok) {
        setMerchants((ms) => [...ms, res.data]);
        setFName("");
        setFDomain("");
        setFNetworkId("");
      } else {
        setCreateError(res.error);
      }
    } finally {
      setCreating(false);
    }
  }

  async function onAddNetwork(e: React.FormEvent) {
    e.preventDefault();
    setNetworkError(null);
    if (!nName.trim()) {
      setNetworkError(d.needNetworkName);
      return;
    }
    setAddingNetwork(true);
    try {
      const res = await createNetworkAction({
        name: nName.trim(),
        website: nWebsite.trim() || undefined,
      });
      if (res.ok) {
        setNetworks((ns) => [...ns, res.data]);
        setNName("");
        setNWebsite("");
      } else {
        setNetworkError(res.error);
      }
    } finally {
      setAddingNetwork(false);
    }
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <h2 className="mt-6 text-base font-semibold text-ink">{d.listTitle}</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">{d.columns.name}</th>
              <th className="px-3 py-2">{d.columns.domain}</th>
              <th className="px-3 py-2">{d.columns.riskScore}</th>
              <th className="px-3 py-2">{d.columns.riskLevel}</th>
              <th className="px-3 py-2">{d.columns.offerCount}</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => (
              <tr key={m.id} className="border-t border-ink/10">
                <td className="px-3 py-2 font-medium text-ink">{m.name}</td>
                <td className="px-3 py-2 text-ink/70">{m.domain ?? "—"}</td>
                <td className="px-3 py-2 text-ink/80">
                  {m.riskScore !== null ? Math.round(m.riskScore) : "—"}
                </td>
                <td className="px-3 py-2 text-ink/70">{m.riskLevel ?? "—"}</td>
                <td className="px-3 py-2 text-ink/70">{m.offerCount}</td>
              </tr>
            ))}
            {!loading && merchants.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={5}>
                  {d.empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-base font-semibold text-ink">{d.newTitle}</h2>
      <form
        onSubmit={onCreate}
        className="mt-3 grid gap-4 rounded-xl border border-ink/10 bg-white/70 p-6 md:grid-cols-2"
      >
        <div>
          <label className={labelClass} htmlFor="merchant-name">
            {d.nameLabel}
          </label>
          <input
            id="merchant-name"
            value={fName}
            onChange={(e) => setFName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="merchant-domain">
            {d.domainLabel}
          </label>
          <input
            id="merchant-domain"
            value={fDomain}
            onChange={(e) => setFDomain(e.target.value)}
            placeholder="example.com"
            className={inputClass}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="merchant-network">
            {d.networkLabel}
          </label>
          <select
            id="merchant-network"
            value={fNetworkId}
            onChange={(e) => setFNetworkId(e.target.value)}
            className={inputClass}
          >
            <option value="">{d.networkNone}</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {creating ? d.creating : d.create}
          </button>
          {createError ? (
            <p className="mt-2 text-sm text-red-700">{createError}</p>
          ) : null}
        </div>
      </form>

      <h2 className="mt-8 text-base font-semibold text-ink">{d.networkTitle}</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">{d.networkNameLabel}</th>
              <th className="px-3 py-2">{d.websiteLabel}</th>
              <th className="px-3 py-2">API</th>
            </tr>
          </thead>
          <tbody>
            {networks.map((n) => (
              <tr key={n.id} className="border-t border-ink/10">
                <td className="px-3 py-2 font-medium text-ink">{n.name}</td>
                <td className="px-3 py-2 text-ink/70">{n.website ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      n.apiConfigured
                        ? "bg-green-100 text-green-800"
                        : "bg-ink/10 text-ink/60"
                    }`}
                  >
                    {n.apiConfigured ? d.apiConfigured : d.apiNotConfigured}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && networks.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-ink/50" colSpan={3}>
                  {d.empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={onAddNetwork}
        className="mt-3 grid gap-4 rounded-xl border border-ink/10 bg-white/70 p-6 md:grid-cols-2"
      >
        <div>
          <label className={labelClass} htmlFor="network-name">
            {d.networkNameLabel}
          </label>
          <input
            id="network-name"
            value={nName}
            onChange={(e) => setNName(e.target.value)}
            placeholder="Impact"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="network-website">
            {d.websiteLabel}
          </label>
          <input
            id="network-website"
            value={nWebsite}
            onChange={(e) => setNWebsite(e.target.value)}
            placeholder="https://impact.com"
            className={inputClass}
          />
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={addingNetwork}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {addingNetwork ? d.adding : d.addNetwork}
          </button>
          {networkError ? (
            <p className="mt-2 text-sm text-red-700">{networkError}</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
