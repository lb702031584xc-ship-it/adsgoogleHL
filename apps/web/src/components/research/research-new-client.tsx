"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createResearchTestAction,
  type ResearchVariantPreset,
} from "@/lib/api/research";
import type { ResearchDict } from "@/i18n/dict/research";
import {
  RESEARCH_VARIANT_PRESETS,
  ResearchBanner,
  presetVariants,
} from "./research-views";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40";
const primaryClass =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50";
const secondaryClass =
  "rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5";

function presetLabel(p: ResearchVariantPreset, dict: ResearchDict): string {
  return dict.preset[p];
}

/** New research test form: /research/new */
export function ResearchNewClient({ dict }: { dict: ResearchDict }) {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState("");
  const [name, setName] = useState("");
  const [preset, setPreset] =
    useState<ResearchVariantPreset>("DEFAULT");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!targetUrl.trim()) {
      setFormError(dict.form.missingField);
      return;
    }
    setCreating(true);
    setFormError(null);
    const res = await createResearchTestAction({
      targetUrl: targetUrl.trim(),
      name: name.trim() || undefined,
      variantPreset: preset,
      variants: presetVariants(preset),
    });
    setCreating(false);
    if (res.ok) {
      router.push(`/research/${res.data.id}`);
    } else {
      setFormError(res.error);
    }
  }

  return (
    <div className="space-y-6">
      <ResearchBanner dict={dict} />
      <div>
        <h1 className="text-2xl font-semibold text-ink">{dict.form.title}</h1>
      </div>
      <form
        onSubmit={onCreate}
        className="max-w-xl space-y-4 rounded-lg border border-ink/15 bg-white p-5"
      >
        <label className="block text-sm text-ink">
          {dict.form.targetUrlLabel}
          <input
            className={`${inputClass} mt-1 font-mono`}
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder={dict.form.targetUrlPlaceholder}
            inputMode="url"
          />
        </label>
        <label className="block text-sm text-ink">
          {dict.form.nameLabel}
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={dict.form.namePlaceholder}
          />
        </label>
        <label className="block text-sm text-ink">
          {dict.form.presetLabel}
          <select
            className={`${inputClass} mt-1`}
            value={preset}
            onChange={(e) =>
              setPreset(e.target.value as ResearchVariantPreset)
            }
          >
            {RESEARCH_VARIANT_PRESETS.map((p) => (
              <option key={p} value={p}>
                {presetLabel(p, dict)}
              </option>
            ))}
          </select>
        </label>
        {formError && <p className="text-sm text-red-700">{formError}</p>}
        <div className="flex items-center gap-2">
          <button type="submit" className={primaryClass} disabled={creating}>
            {creating ? dict.form.creating : dict.form.create}
          </button>
          <Link href="/research" className={secondaryClass}>
            {dict.form.back}
          </Link>
        </div>
      </form>
    </div>
  );
}
