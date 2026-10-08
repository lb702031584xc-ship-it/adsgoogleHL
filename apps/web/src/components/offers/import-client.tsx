"use client";

import { useState } from "react";
import Link from "next/link";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { importOffersAction } from "@/lib/api/offer-intel-actions";
import type { ImportOffersResult } from "@/lib/api/offer-intel";

type Mode = "csv" | "json" | "urls";

/** Bulk offer import: CSV / JSON / one-URL-per-line. */
export function OfferImportClient() {
  const t = useDict();
  const d = t.ai.intel.import;
  const [mode, setMode] = useState<Mode>("csv");
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportOffersResult | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!text.trim()) {
      setError(d.needInput);
      return;
    }
    let body: { items: unknown[] } | { csv: string };
    if (mode === "csv") {
      body = { csv: text };
    } else if (mode === "json") {
      try {
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          setError(d.invalidJson);
          return;
        }
        body = { items: parsed };
      } catch {
        setError(d.invalidJson);
        return;
      }
    } else {
      const urls = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      body = {
        items: urls.map((url) => ({ name: url, destinationUrl: url })),
      };
    }

    setImporting(true);
    try {
      const res = await importOffersAction(
        body as { items: { name: string; destinationUrl: string }[] }
      );
      if (res.ok) setResult(res.data);
      else setError(res.error);
    } finally {
      setImporting(false);
    }
  }

  const modes: Array<{ key: Mode; label: string; placeholder: string }> = [
    { key: "csv", label: d.modes.csv, placeholder: d.csvPlaceholder },
    { key: "json", label: d.modes.json, placeholder: d.jsonPlaceholder },
    { key: "urls", label: d.modes.urls, placeholder: d.urlsPlaceholder },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <EntityPageHeader title={d.title} description={d.description} />

      <div className="mt-6 flex gap-1 border-b border-ink/10" role="tablist">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              mode === m.key
                ? "border-signal text-signal"
                : "border-transparent text-ink/55 hover:text-ink"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-4">
        <label
          htmlFor="import-text"
          className="mb-1 block text-sm font-medium text-ink/80"
        >
          {d.pasteLabel}
        </label>
        <textarea
          id="import-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={modes.find((m) => m.key === mode)?.placeholder}
          className={inputClass}
        />
        <div className="mt-3">
          <button
            type="submit"
            disabled={importing}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {importing ? d.importing : d.submit}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            {d.result(result.created)}
          </p>
          {result.offers.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-green-800">
                {d.createdList}
              </p>
              <ul className="mt-1 space-y-1">
                {result.offers.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link
                      href={`/offers/${o.id}`}
                      className="text-signal hover:underline"
                    >
                      {o.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
