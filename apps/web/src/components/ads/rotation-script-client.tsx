"use client";

import { useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import type { AdsRotationDict } from "@/i18n/dict/ads-rotation";
import { getRotationScriptAction } from "@/lib/api/ads-auto-actions";

export function RotationScriptClient({ dict }: { dict: AdsRotationDict }) {
  const d = dict;
  const [label, setLabel] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onGenerate() {
    if (!label.trim()) {
      setError(d.labelHint);
      return;
    }
    setGenerating(true);
    setError(null);
    setSource(null);
    try {
      const res = await getRotationScriptAction(label.trim());
      if (res.ok) {
        setSource(res.data.source);
        setFileName(res.data.fileName);
      } else {
        setError(res.error);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function onCopy() {
    if (!source) return;
    await navigator.clipboard.writeText(source);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function onDownload() {
    if (!source) return;
    const blob = new Blob([source], { type: "text/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "adlinklab-rotation.js";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      <div className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-6">
        <h3 className="text-sm font-semibold text-ink">{d.howItWorks}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink/70">
          {d.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>

      <div className="mt-4 rounded-xl border border-ink/10 bg-white/70 p-6">
        <label className={labelClass} htmlFor="rotation-label">
          {d.labelLabel}
        </label>
        <input
          id="rotation-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={d.labelPlaceholder}
          className={`${inputClass} max-w-md font-mono`}
        />
        <p className="mt-1 text-xs text-ink/55">{d.labelHint}</p>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {generating ? d.generating : d.generate}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {source ? (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{d.resultTitle}</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCopy}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
              >
                {copied ? d.copied : d.copy}
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
              >
                {d.download}
              </button>
            </div>
          </div>
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl border border-ink/10 bg-ink p-4 font-mono text-xs text-paper">
            {source}
          </pre>
          <div className="mt-4 rounded-xl border border-ink/10 bg-white/70 p-6">
            <h3 className="text-sm font-semibold text-ink">{d.setupTitle}</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink/70">
              {d.setupSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
