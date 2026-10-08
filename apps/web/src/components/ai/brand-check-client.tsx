"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { brandCheckAction } from "@/lib/api/p1-actions";
import type { BrandCheckResponse } from "@/lib/api/p1";

const MAX_KEYWORDS = 500;

export function BrandCheckClient() {
  const t = useDict();
  const d = t.ai.brand;
  const [keywordsText, setKeywordsText] = useState("");
  const [termsText, setTermsText] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrandCheckResponse | null>(null);
  const [copied, setCopied] = useState<"exact" | "phrase" | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  function parseTerms(raw: string): string[] {
    return raw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const keywords = keywordsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      setError(d.needKeywords);
      return;
    }
    if (keywords.length > MAX_KEYWORDS) {
      setError(d.maxKeywords);
      return;
    }
    const brandTerms = parseTerms(termsText);
    if (brandTerms.length === 0) {
      setError(d.needTerms);
      return;
    }
    setError(null);
    setChecking(true);
    setCopied(null);
    try {
      const res = await brandCheckAction(keywords, brandTerms);
      if (res.ok) setResult(res.data);
      else setError(res.error);
    } finally {
      setChecking(false);
    }
  }

  async function copyList(which: "exact" | "phrase") {
    if (!result) return;
    const text =
      which === "exact" ? result.negatives.exact : result.negatives.phrase;
    try {
      await navigator.clipboard.writeText(text.join("\n"));
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setCopied(null);
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={reset}
            className="mb-4 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {d.recheck}
          </button>

          <div className="flex flex-wrap gap-3">
            <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-3">
              <p className="text-xs text-ink/55">{d.stats.total}</p>
              <p className="text-2xl font-semibold text-ink">
                {result.stats.total}
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3">
              <p className="text-xs text-red-700/70">{d.stats.conflicts}</p>
              <p className="text-2xl font-semibold text-red-800">
                {result.stats.conflicts}
              </p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-3">
              <p className="text-xs text-green-700/70">{d.stats.safe}</p>
              <p className="text-2xl font-semibold text-green-800">
                {result.stats.total - result.stats.conflicts}
              </p>
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-ink">
            {d.negativesTitle}
          </h3>
          {result.stats.conflicts > 0 ? (
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              {(
                [
                  ["exact", d.exactTitle, result.negatives.exact],
                  ["phrase", d.phraseTitle, result.negatives.phrase],
                ] as const
              ).map(([which, title, list]) => (
                <div
                  key={which}
                  className="rounded-xl border border-ink/10 bg-white/70 p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ink">{title}</p>
                    <button
                      type="button"
                      onClick={() => copyList(which)}
                      className="rounded-lg bg-ink px-3 py-1 text-xs font-medium text-paper"
                    >
                      {copied === which ? d.copied : d.copy}
                    </button>
                  </div>
                  <pre className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-ink/5 p-3 font-mono text-xs text-ink/80">
                    {list.join("\n")}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink/55">{d.noConflicts}</p>
          )}

          <h3 className="mt-6 text-sm font-semibold text-ink">
            {d.columns.keyword}
          </h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-ink/60">
                <tr>
                  <th className="px-3 py-2">{d.columns.keyword}</th>
                  <th className="px-3 py-2">{d.columns.status}</th>
                  <th className="px-3 py-2">{d.columns.matchedTerms}</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i} className="border-t border-ink/10">
                    <td className="px-3 py-2 font-mono text-xs text-ink">
                      {r.keyword}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          r.conflict
                            ? "bg-red-100 text-red-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {r.conflict ? d.conflict : d.safe}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.matchedTerms.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.matchedTerms.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-xs text-red-700"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink/40">{d.noMatched}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6"
        >
          <label className={labelClass} htmlFor="brand-keywords">
            {d.keywordsLabel}
          </label>
          <textarea
            id="brand-keywords"
            rows={10}
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            placeholder={d.keywordsPlaceholder}
            className={`${inputClass} font-mono`}
          />
          <div className="mt-4">
            <label className={labelClass} htmlFor="brand-terms">
              {d.termsLabel}
            </label>
            <textarea
              id="brand-terms"
              rows={3}
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              placeholder={d.termsPlaceholder}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink/50">{d.termsHint}</p>
          </div>
          <button
            type="submit"
            disabled={checking}
            className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {checking ? d.checking : d.submit}
          </button>
        </form>
      )}
    </div>
  );
}
