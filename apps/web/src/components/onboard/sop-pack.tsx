"use client";

/**
 * 开户 SOP 包（第十四批）：并入 /quickstart Day1。
 * 三个手把手向导（Associates / PA-API / Google Ads）+ 网站就绪检查。
 */
import { useState } from "react";
import Link from "next/link";
import type { QuickstartDict } from "@/i18n/dict/quickstart";

interface SiteCheckItem {
  key: "disclosure" | "privacy" | "contact" | "articles";
  ok: boolean;
  url: string | null;
  detail: string;
}

interface SiteCheckResult {
  domain: string;
  items: SiteCheckItem[];
  articleCount: number;
}

async function siteCheckAction(
  domain: string
): Promise<{ ok: true; data: SiteCheckResult } | { ok: false; error: string }> {
  const { checkSiteReadinessAction } = await import("@/lib/api/onboard-actions");
  return checkSiteReadinessAction(domain);
}

const TABS = ["associates", "paapi", "googleAds"] as const;

export function SopPack({ dict: d }: { dict: QuickstartDict }) {
  const sop = d.sop;
  const [tab, setTab] = useState<(typeof TABS)[number]>("associates");
  const [domain, setDomain] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SiteCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCheck() {
    if (!domain.trim() || checking) return;
    setChecking(true);
    setError(null);
    setResult(null);
    const r = await siteCheckAction(domain.trim());
    setChecking(false);
    if (r.ok) setResult(r.data);
    else setError(r.error);
  }

  const steps = sop.wizards[tab];

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-4">
      <h2 className="text-base font-bold text-ink">{sop.title}</h2>
      <p className="mt-1 text-xs text-ink/60">{sop.subtitle}</p>

      <div className="mt-3 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === t ? "bg-ink text-white" : "bg-ink/[0.05] text-ink/70 hover:bg-ink/10"
            }`}
          >
            {sop.tabNames[t]}
          </button>
        ))}
      </div>

      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-xs font-bold text-ink/70">
              {i + 1}
            </span>
            <div>
              <p className="font-medium text-ink">{s.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink/60">{s.body}</p>
              {s.link ? (
                <Link
                  href={s.link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-signal hover:underline"
                >
                  {s.linkLabel ?? s.link} →
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-ink/10 pt-4">
        <h3 className="text-sm font-bold text-ink">{sop.siteCheck.title}</h3>
        <p className="mt-0.5 text-xs text-ink/60">{sop.siteCheck.subtitle}</p>
        <div className="mt-2 flex gap-2">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={sop.siteCheck.placeholder}
            className="w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={onCheck}
            disabled={checking || !domain.trim()}
            className="rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {checking ? "…" : sop.siteCheck.check}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {result && (
          <ul className="mt-3 space-y-1.5">
            {result.items.map((item) => {
              const meta = sop.siteCheck.items[item.key];
              return (
                <li
                  key={item.key}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    item.ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"
                  }`}
                >
                  <p className={`font-medium ${item.ok ? "text-emerald-800" : "text-red-700"}`}>
                    {item.ok ? "✓" : "✗"} {meta.title}
                  </p>
                  {!item.ok && (
                    <p className="mt-0.5 text-xs leading-relaxed text-red-600">
                      {meta.fix} <span className="text-red-400">({item.detail})</span>
                    </p>
                  )}
                  {item.key === "articles" && (
                    <p className="mt-0.5 text-xs text-ink/50">
                      {sop.siteCheck.articleCount}: {result.articleCount}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
