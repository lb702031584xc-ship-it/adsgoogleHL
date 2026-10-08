"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { saveAiSettingsAction } from "@/lib/api/ai-actions";
import type { AiSettings } from "@/lib/api/ai";

const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
} as const;

type PresetKey = keyof typeof PRESETS | "custom";

export function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const t = useDict();
  const [preset, setPreset] = useState<PresetKey>("custom");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(initial.hasKey);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  function applyPreset(p: PresetKey) {
    setPreset(p);
    if (p !== "custom") {
      setBaseUrl(PRESETS[p].baseUrl);
      setModel(PRESETS[p].model);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await saveAiSettingsAction({
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      if (res.ok) {
        setMessage(t.ai.admin.settings.saved);
        if (apiKey.trim()) {
          setHasKey(true);
          setApiKey("");
        }
      } else {
        setError(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <EntityPageHeader
        title={t.ai.admin.settings.title}
        description={t.ai.admin.settings.description}
      />

      <form
        onSubmit={onSubmit}
        className="mt-6 max-w-xl rounded-xl border border-ink/10 bg-white/70 p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink/80">
            {t.ai.admin.settings.preset}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              hasKey
                ? "bg-green-100 text-green-800"
                : "bg-ink/10 text-ink/60"
            }`}
          >
            {hasKey
              ? t.ai.admin.settings.configuredBadge
              : t.ai.admin.settings.notConfiguredBadge}
          </span>
        </div>
        <div className="mt-2 inline-flex rounded-lg bg-ink/5 p-1" role="group">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>)
            .concat()
            .map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  preset === p
                    ? "bg-white text-ink shadow-sm"
                    : "text-ink/60 hover:text-ink"
                }`}
              >
                {t.ai.admin.settings.presets[p]}
              </button>
            ))}
          <button
            type="button"
            onClick={() => applyPreset("custom")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              preset === "custom"
                ? "bg-white text-ink shadow-sm"
                : "text-ink/60 hover:text-ink"
            }`}
          >
            {t.ai.admin.settings.presets.custom}
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className={labelClass} htmlFor="ai-base-url">
              {t.ai.admin.settings.baseUrl}
            </label>
            <input
              id="ai-base-url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setPreset("custom");
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ai-model">
              {t.ai.admin.settings.model}
            </label>
            <input
              id="ai-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                setPreset("custom");
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ai-key">
              {t.ai.admin.settings.apiKey}
            </label>
            <input
              id="ai-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t.ai.admin.settings.apiKeyPlaceholder}
              autoComplete="off"
              className={inputClass}
            />
          </div>
        </div>

        {error ? (
          <div className="mt-4">
            <ErrorState title={t.common.error.title} message={error} />
          </div>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {saving ? t.ai.admin.settings.saving : t.ai.admin.settings.save}
        </button>

        <p className="mt-5 text-xs text-ink/55">
          {t.ai.admin.settings.keyNote}
        </p>
        <p className="mt-1 text-xs text-ink/55">{t.ai.admin.settings.guide}</p>
      </form>
    </div>
  );
}
