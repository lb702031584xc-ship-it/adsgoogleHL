"use client";

/**
 * Lander Intel ③ — high-converting template library UI.
 *
 * Browse templates by category → click a card → fill the generated variable
 * form → live server-rendered preview (iframe, sandboxed) → "use as landing
 * page" picks an offer and persists the rendered HTML as a LandingPage.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDict } from "@/i18n/use-dict";
import type { Dict } from "@/i18n/dictionaries";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import {
  listLanderTemplatesAction,
  listOfferOptionsAction,
  previewLanderTemplateAction,
  useLanderTemplateAction,
} from "@/lib/api/lander-actions";
import type {
  LanderTemplate,
  LanderTemplateCategory,
} from "@/lib/api/lander";

type CategoryTab = "all" | LanderTemplateCategory;

const CATEGORY_TABS: CategoryTab[] = [
  "all",
  "review",
  "comparison",
  "listicle",
  "quiz",
];

/** Variables rendered as one-per-line textareas. */
const LIST_VARIABLES = new Set(["pros", "cons"]);
/** Variables rendered as a JSON textarea. */
const JSON_VARIABLES = new Set(["products"]);

/**
 * Convert raw form strings into preview variables:
 * - pros/cons → string[] (one per line)
 * - products → parsed JSON array
 * - everything else → trimmed string
 * Returns `{ variables, productsJsonError }`.
 */
export function toPreviewVariables(values: Record<string, string>): {
  variables: Record<string, unknown>;
  productsJsonError: boolean;
} {
  const variables: Record<string, unknown> = {};
  let productsJsonError = false;
  for (const [name, raw] of Object.entries(values)) {
    if (LIST_VARIABLES.has(name)) {
      variables[name] = raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (JSON_VARIABLES.has(name)) {
      const trimmed = raw.trim();
      if (!trimmed) {
        variables[name] = [];
      } else {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            variables[name] = parsed;
          } else {
            productsJsonError = true;
          }
        } catch {
          productsJsonError = true;
        }
      }
    } else {
      variables[name] = raw;
    }
  }
  return { variables, productsJsonError };
}

function categoryLabel(d: Dict, category: LanderTemplateCategory): string {
  return d.ai.lander.templates.categories[category];
}

/** Presentational template card grid — unit-tested via renderToStaticMarkup. */
export function TemplatesGallery({
  templates,
  selectedId,
  onSelect,
}: {
  templates: LanderTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const dict = useDict();
  const t = dict.ai.lander.templates;
  if (templates.length === 0) {
    return <p className="mt-6 text-sm text-ink/55">{t.noTemplates}</p>;
  }
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((tpl) => {
        const active = tpl.id === selectedId;
        return (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onSelect(tpl.id)}
            className={`rounded-xl border bg-white p-5 text-left shadow-sm transition hover:shadow ${
              active
                ? "border-signal ring-2 ring-signal/30"
                : "border-ink/10"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink/70">
                {categoryLabel(dict, tpl.category)}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  tpl.isBuiltIn
                    ? "bg-green-100 text-green-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                {tpl.isBuiltIn ? t.builtIn : t.custom}
              </span>
            </div>
            <h3 className="mt-3 text-lg font-semibold text-ink">
              {tpl.name}
            </h3>
            {tpl.description ? (
              <p className="mt-1 text-sm text-ink/60">{tpl.description}</p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Presentational variable form — unit-tested via renderToStaticMarkup. */
export function VariableFields({
  variables,
  values,
  onChange,
}: {
  variables: string[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const t = useDict().ai.lander.templates;
  return (
    <div className="space-y-4">
      {variables.map((name) => {
        const value = values[name] ?? "";
        const label = (
          <label
            htmlFor={`tpl-var-${name}`}
            className="mb-1 block text-sm font-medium text-ink/80"
          >
            {`{{${name}}}`}
            {LIST_VARIABLES.has(name) ? (
              <span className="ml-2 text-xs font-normal text-ink/50">
                {t.hints.lines}
              </span>
            ) : null}
          </label>
        );
        if (LIST_VARIABLES.has(name) || JSON_VARIABLES.has(name)) {
          return (
            <div key={name}>
              {label}
              <textarea
                id={`tpl-var-${name}`}
                rows={name === "products" ? 6 : 4}
                value={value}
                onChange={(e) => onChange(name, e.target.value)}
                placeholder={
                  name === "products" ? t.hints.products : undefined
                }
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 font-mono text-sm focus:border-signal focus:outline-none"
              />
              {name === "products" ? (
                <p className="mt-1 text-xs text-ink/50">{t.hints.products}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={name}>
            {label}
            <input
              id={`tpl-var-${name}`}
              type={name === "ctaUrl" ? "url" : "text"}
              value={value}
              onChange={(e) => onChange(name, e.target.value)}
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none"
            />
          </div>
        );
      })}
    </div>
  );
}

interface OfferOption {
  id: string;
  name: string;
}

export function TemplatesClient() {
  const d = useDict().ai.lander.templates;
  const router = useRouter();
  const [tab, setTab] = useState<CategoryTab>("all");
  const [templates, setTemplates] = useState<LanderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showUseDialog, setShowUseDialog] = useState(false);
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [offerId, setOfferId] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [useError, setUseError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected =
    templates.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listLanderTemplatesAction(tab === "all" ? undefined : tab).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setTemplates(res.data.items);
        setSelectedId((prev) =>
          prev && res.data.items.some((t) => t.id === prev) ? prev : null
        );
      } else {
        setLoadError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  // Reset variable form when the selected template changes.
  function handleSelect(id: string) {
    setSelectedId(id);
    const tpl = templates.find((t) => t.id === id);
    const next: Record<string, string> = {};
    for (const name of tpl?.variables ?? []) next[name] = "";
    setValues(next);
    setPreviewHtml("");
    setPreviewError(null);
  }

  // Debounced live preview.
  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedId);
    if (!tpl) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      const { variables, productsJsonError } = toPreviewVariables(values);
      if (productsJsonError) {
        setPreviewError(d.invalidProductsJson);
        return;
      }
      setPreviewing(true);
      setPreviewError(null);
      const res = await previewLanderTemplateAction(tpl.id, variables);
      setPreviewing(false);
      if (res.ok) {
        setPreviewHtml(res.data.html);
      } else {
        setPreviewError(res.error);
      }
    }, 500);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [selectedId, values, templates]);

  async function openUseDialog() {
    setShowUseDialog(true);
    setUseError(null);
    if (offers.length === 0 && !offersError) {
      const res = await listOfferOptionsAction();
      if (res.ok) {
        setOffers(res.data);
        if (res.data.length > 0) {
          setOfferId((prev) => prev || res.data[0].id);
        }
      } else {
        setOffersError(res.error);
      }
    }
  }

  async function confirmUse() {
    if (!selected) return;
    if (!offerId) {
      setUseError(d.needOffer);
      return;
    }
    if (!pageName.trim()) {
      setUseError(d.needName);
      return;
    }
    const { variables, productsJsonError } = toPreviewVariables(values);
    if (productsJsonError) {
      setUseError(d.invalidProductsJson);
      return;
    }
    setCreating(true);
    setUseError(null);
    const res = await useLanderTemplateAction(selected.id, {
      offerId,
      name: pageName.trim(),
      variables,
      url: pageUrl.trim() || undefined,
    });
    setCreating(false);
    if (res.ok) {
      router.push("/landing-pages");
    } else {
      setUseError(res.error);
    }
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {/* Category tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {CATEGORY_TABS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTab(c)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === c
                ? "bg-ink text-white"
                : "border border-ink/15 bg-white text-ink/70 hover:bg-ink/5"
            }`}
          >
            {d.categories[c]}
          </button>
        ))}
      </div>

      {loadError ? <ErrorState message={loadError} /> : null}
      {loading ? (
        <p className="mt-6 text-sm text-ink/55">…</p>
      ) : (
        <TemplatesGallery
          templates={templates}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      )}

      {selected ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* Variable form */}
          <div className="rounded-xl border border-ink/10 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">
                {d.variables}
              </h2>
              <button
                type="button"
                onClick={openUseDialog}
                className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                {d.useAsLandingPage}
              </button>
            </div>
            <VariableFields
              variables={selected.variables}
              values={values}
              onChange={(name, value) =>
                setValues((prev) => ({ ...prev, [name]: value }))
              }
            />
          </div>

          {/* Live preview */}
          <div className="rounded-xl border border-ink/10 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">{d.preview}</h2>
              {previewing ? (
                <span className="text-xs text-ink/50">…</span>
              ) : null}
            </div>
            <p className="mb-3 text-xs text-ink/50">{d.previewNote}</p>
            {previewError ? (
              <ErrorState message={previewError} />
            ) : previewHtml ? (
              <iframe
                title="template-preview"
                srcDoc={previewHtml}
                sandbox=""
                className="h-[640px] w-full rounded-lg border border-ink/10 bg-white"
              />
            ) : (
              <p className="text-sm text-ink/55">{d.selectHint}</p>
            )}
          </div>
        </div>
      ) : (
        !loading && <p className="mt-6 text-sm text-ink/55">{d.selectHint}</p>
      )}

      {/* Use-as-landing-page dialog */}
      {showUseDialog && selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-ink">{d.useTitle}</h2>
            <p className="mt-1 text-sm text-ink/60">{selected.name}</p>
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="tpl-use-offer"
                  className="mb-1 block text-sm font-medium text-ink/80"
                >
                  {d.offerLabel}
                </label>
                {offersError ? (
                  <p className="text-sm text-rose-700">{offersError}</p>
                ) : (
                  <select
                    id="tpl-use-offer"
                    value={offerId}
                    onChange={(e) => setOfferId(e.target.value)}
                    className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none"
                  >
                    {offers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label
                  htmlFor="tpl-use-name"
                  className="mb-1 block text-sm font-medium text-ink/80"
                >
                  {d.nameLabel}
                </label>
                <input
                  id="tpl-use-name"
                  type="text"
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  placeholder={d.namePlaceholder}
                  className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-use-url"
                  className="mb-1 block text-sm font-medium text-ink/80"
                >
                  {d.urlLabel}
                </label>
                <input
                  id="tpl-use-url"
                  type="url"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  placeholder={d.urlPlaceholder}
                  className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none"
                />
              </div>
            </div>
            {useError ? (
              <p className="mt-3 text-sm text-rose-700">{useError}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowUseDialog(false)}
                className="rounded-lg border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70 hover:bg-ink/5"
              >
                {d.cancel}
              </button>
              <button
                type="button"
                onClick={confirmUse}
                disabled={creating}
                className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {creating ? d.creating : d.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
