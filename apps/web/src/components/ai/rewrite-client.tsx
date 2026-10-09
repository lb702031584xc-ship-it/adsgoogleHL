"use client";

/**
 * Task 4 — AI rewrite & deploy workbench.
 *
 * ① Pick a source (built-in template or an existing landing page)
 * ② Fill the rewrite brief (audience, selling points, tone, CTA, discount,
 *    SEO keywords, language, length)
 * ③ Generate → review the before/after diff + sandboxed preview
 * ④ Confirm → one-click deploy as a NEW landing page
 *
 * Copy comes from `@/i18n/dict/lander-new` (imported directly, not merged
 * into the main dictionaries).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  landerNewDict,
  type LanderNewLang,
} from "@/i18n/dict/lander-new";
import {
  REWRITE_LENGTHS,
  REWRITE_TONES,
  defaultRewriteBrief,
  validateRewriteBrief,
} from "@/lib/rewrite-brief";
import { VariableFields, toPreviewVariables } from "./templates-client";
import {
  createLpRewriteAction,
  createTemplateRewriteBriefAction,
  deployLpRewriteAction,
  listRewritableLandingPagesAction,
  type DeployedLandingPage,
  type LpRewriteItem,
  type RewritableLandingPage,
} from "@/lib/api/lp-rewrite-actions";
import {
  listLanderTemplatesAction,
  listOfferOptionsAction,
} from "@/lib/api/lander-actions";
import type { LanderTemplate } from "@/lib/api/lander";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";

type SourceTab = "template" | "page";

interface OfferOption {
  id: string;
  name: string;
}

const inputCls =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-ink/80";
const sectionCls = "rounded-xl border border-ink/10 bg-white p-5";
const stepTitleCls = "text-base font-semibold text-ink";

function ScoreBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-ink/5 px-4 py-2 text-center">
      <div className="text-2xl font-bold text-ink">
        {value === null || value === undefined ? "—" : value}
      </div>
      <div className="text-xs text-ink/55">{label}</div>
    </div>
  );
}

export function RewriteClient({ lang }: { lang: LanderNewLang }) {
  const t = landerNewDict[lang];

  const [sourceTab, setSourceTab] = useState<SourceTab>("template");

  // Template source state.
  const [templates, setTemplates] = useState<LanderTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplError, setTplError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [templateLang, setTemplateLang] = useState<"zh" | "en">(lang);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  // Page source state.
  const [pages, setPages] = useState<RewritableLandingPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pageId, setPageId] = useState("");

  // Brief form state.
  const [brief, setBrief] = useState(defaultRewriteBrief);

  // Generation state.
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [rewrite, setRewrite] = useState<LpRewriteItem | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [sourceOfferId, setSourceOfferId] = useState<string | undefined>(
    undefined
  );

  // Deploy state.
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [deployName, setDeployName] = useState("");
  const [deployOfferId, setDeployOfferId] = useState("");
  const [deployUrl, setDeployUrl] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<DeployedLandingPage | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLanderTemplatesAction()
      .then((res) => {
        if (cancelled) return;
        setTplLoading(false);
        if (res.ok) {
          setTemplates(res.data.items);
          setTemplateId((prev) => prev || res.data.items[0]?.id || "");
        } else {
          setTplError(res.error);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTplLoading(false);
          setTplError(t.source.loadFailed);
        }
      });
    listRewritableLandingPagesAction()
      .then((res) => {
        if (cancelled) return;
        setPagesLoading(false);
        if (res.ok) {
          setPages(res.data.items);
          setPageId((prev) => prev || res.data.items[0]?.id || "");
        } else {
          setPagesError(res.error);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPagesLoading(false);
          setPagesError(t.source.loadFailed);
        }
      });
    listOfferOptionsAction()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setOffers(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTemplate =
    templates.find((x) => x.id === templateId) ?? null;
  const selectedPage = pages.find((x) => x.id === pageId) ?? null;

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    const next: Record<string, string> = {};
    for (const name of tpl?.variables ?? []) next[name] = "";
    setVarValues(next);
    setRewrite(null);
    setPreviewHtml("");
    setDeployed(null);
  }

  function setBriefField<K extends keyof typeof brief>(key: K, value: (typeof brief)[K]) {
    setBrief((prev) => ({ ...prev, [key]: value }));
  }

  function setSellingPoint(index: number, value: string) {
    setBrief((prev) => {
      const next = [...prev.sellingPoints];
      next[index] = value;
      return { ...prev, sellingPoints: next };
    });
  }

  async function handleGenerate() {
    setGenError(null);
    setDeployed(null);

    // 1. Source validation.
    if (sourceTab === "template") {
      if (!templateId) {
        setGenError(t.validation.needTemplate);
        return;
      }
    } else if (!pageId) {
      setGenError(t.validation.needPage);
      return;
    }

    // 2. Brief validation (pure, unit-tested).
    const checked = validateRewriteBrief({
      targetAudience: brief.targetAudience,
      sellingPoints: brief.sellingPoints,
      tone: brief.tone,
      ctaText: brief.ctaText,
      discountInfo: brief.discountInfo,
      seoKeywords: brief.seoKeywords,
      language: brief.language,
      length: brief.length,
    });
    if (!checked.ok) {
      setGenError(checked.errors[0]?.message ?? t.validation.needAudienceOrPoints);
      return;
    }
    const requirements = checked.data;

    setGenerating(true);
    try {
      if (sourceTab === "template") {
        const { variables, productsJsonError } = toPreviewVariables(varValues);
        if (productsJsonError) {
          setGenError(t.validation.needTemplate);
          setGenerating(false);
          return;
        }
        const res = await createTemplateRewriteBriefAction(templateId, {
          lang: templateLang,
          variables,
          requirements,
        });
        if (!res.ok) {
          setGenError(res.error);
        } else {
          setRewrite(res.data.rewrite);
          setPreviewHtml(res.data.previewHtml);
          setSourceOfferId(undefined);
          setDeployOfferId((prev) => prev || offers[0]?.id || "");
        }
      } else {
        const res = await createLpRewriteAction(pageId, undefined, requirements);
        if (!res.ok) {
          setGenError(res.error);
        } else {
          setRewrite(res.data.rewrite);
          setPreviewHtml(res.data.previewHtml);
          const offerId = selectedPage?.offerId;
          setSourceOfferId(offerId);
          setDeployOfferId(offerId ?? offers[0]?.id ?? "");
        }
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeploy() {
    setDeployError(null);
    if (!rewrite) return;
    if (!deployName.trim()) {
      setDeployError(t.deploy.needName);
      return;
    }
    if (!deployOfferId) {
      setDeployError(t.deploy.needOffer);
      return;
    }
    setDeploying(true);
    try {
      const res = await deployLpRewriteAction(rewrite.id, {
        name: deployName.trim(),
        offerId: deployOfferId,
        url: deployUrl.trim() || undefined,
      });
      if (!res.ok) {
        setDeployError(res.error);
      } else {
        setDeployed(res.data.landingPage);
        setRewrite(res.data.rewrite);
      }
    } finally {
      setDeploying(false);
    }
  }

  const rewrites = rewrite?.rewrittenContent.rewrites ?? [];
  const skipped = rewrite?.rewrittenContent.skipped ?? [];
  const appliedCount = rewrite?.rewrittenContent.appliedCount ?? rewrites.length;

  return (
    <div>
      <EntityPageHeader title={t.page.title} description={t.page.description} />

      {/* ① Source */}
      <section className={`${sectionCls} mt-6`}>
        <h2 className={stepTitleCls}>{t.steps.source} · {t.source.title}</h2>
        <div className="mt-3 flex gap-2">
          {(["template", "page"] as SourceTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setSourceTab(tab);
                setRewrite(null);
                setPreviewHtml("");
                setDeployed(null);
                setGenError(null);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                sourceTab === tab
                  ? "bg-ink text-white"
                  : "border border-ink/15 bg-white text-ink/70 hover:bg-ink/5"
              }`}
            >
              {tab === "template" ? t.source.templateTab : t.source.pageTab}
            </button>
          ))}
        </div>

        {sourceTab === "template" ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="rw-template">
                {t.source.pickTemplate}
              </label>
              {tplLoading ? (
                <p className="text-sm text-ink/55">…</p>
              ) : tplError ? (
                <ErrorState message={tplError} />
              ) : (
                <select
                  id="rw-template"
                  value={templateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className={inputCls}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              )}
              {selectedTemplate?.description ? (
                <p className="mt-1 text-xs text-ink/50">
                  {selectedTemplate.description}
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelCls} htmlFor="rw-template-lang">
                {t.source.templateLang}
              </label>
              <select
                id="rw-template-lang"
                value={templateLang}
                onChange={(e) =>
                  setTemplateLang(e.target.value === "en" ? "en" : "zh")
                }
                className={inputCls}
              >
                <option value="zh">{t.source.templateLangZh}</option>
                <option value="en">{t.source.templateLangEn}</option>
              </select>
            </div>
            {selectedTemplate ? (
              <div className="md:col-span-2">
                <VariableFields
                  variables={selectedTemplate.variables}
                  values={varValues}
                  onChange={(name, value) =>
                    setVarValues((prev) => ({ ...prev, [name]: value }))
                  }
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4">
            <label className={labelCls} htmlFor="rw-page">
              {t.source.pickPage}
            </label>
            {pagesLoading ? (
              <p className="text-sm text-ink/55">…</p>
            ) : pagesError ? (
              <ErrorState message={pagesError} />
            ) : pages.length === 0 ? (
              <p className="text-sm text-ink/55">{t.source.noPages}</p>
            ) : (
              <select
                id="rw-page"
                value={pageId}
                onChange={(e) => {
                  setPageId(e.target.value);
                  setRewrite(null);
                  setPreviewHtml("");
                  setDeployed(null);
                }}
                className={inputCls}
              >
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.offerName ? `（${p.offerName}）` : ""}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-xs text-ink/50">{t.source.onlyHtmlPages}</p>
          </div>
        )}
      </section>

      {/* ② Brief */}
      <section className={`${sectionCls} mt-4`}>
        <h2 className={stepTitleCls}>
          {t.steps.requirements} · {t.form.title}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="rw-audience">
              {t.form.targetAudience}
            </label>
            <input
              id="rw-audience"
              value={brief.targetAudience}
              onChange={(e) => setBriefField("targetAudience", e.target.value)}
              placeholder={t.form.targetAudiencePh}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="rw-cta">
              {t.form.ctaText}
            </label>
            <input
              id="rw-cta"
              value={brief.ctaText}
              onChange={(e) => setBriefField("ctaText", e.target.value)}
              placeholder={t.form.ctaTextPh}
              className={inputCls}
            />
          </div>
          <div className="md:col-span-2">
            <span className={labelCls}>{t.form.sellingPoints}</span>
            <div className="space-y-2">
              {brief.sellingPoints.map((point, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={point}
                    onChange={(e) => setSellingPoint(i, e.target.value)}
                    placeholder={t.form.sellingPointsPh}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setBrief((prev) => ({
                        ...prev,
                        sellingPoints: prev.sellingPoints.filter(
                          (_, idx) => idx !== i
                        ),
                      }))
                    }
                    className="flex-none rounded-lg border border-ink/15 px-3 text-sm text-ink/60 hover:bg-ink/5"
                  >
                    {t.form.removePoint}
                  </button>
                </div>
              ))}
            </div>
            {brief.sellingPoints.length < 12 ? (
              <button
                type="button"
                onClick={() =>
                  setBrief((prev) => ({
                    ...prev,
                    sellingPoints: [...prev.sellingPoints, ""],
                  }))
                }
                className="mt-2 rounded-lg border border-dashed border-ink/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
              >
                {t.form.addPoint}
              </button>
            ) : null}
          </div>
          <div>
            <label className={labelCls} htmlFor="rw-tone">
              {t.form.tone}
            </label>
            <select
              id="rw-tone"
              value={brief.tone}
              onChange={(e) => setBriefField("tone", e.target.value)}
              className={inputCls}
            >
              {REWRITE_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {t.form.tones[tone] ?? tone}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rw-length">
              {t.form.length}
            </label>
            <select
              id="rw-length"
              value={brief.length}
              onChange={(e) => setBriefField("length", e.target.value)}
              className={inputCls}
            >
              {REWRITE_LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {t.form.lengths[l] ?? l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rw-discount">
              {t.form.discountInfo}
            </label>
            <input
              id="rw-discount"
              value={brief.discountInfo}
              onChange={(e) => setBriefField("discountInfo", e.target.value)}
              placeholder={t.form.discountInfoPh}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="rw-seo">
              {t.form.seoKeywords}
            </label>
            <input
              id="rw-seo"
              value={brief.seoKeywords}
              onChange={(e) => setBriefField("seoKeywords", e.target.value)}
              placeholder={t.form.seoKeywordsPh}
              className={inputCls}
            />
          </div>
          <div>
            <span className={labelCls}>{t.form.language}</span>
            <div className="flex gap-2">
              {(["zh", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setBriefField("language", l)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    brief.language === l
                      ? "bg-ink text-white"
                      : "border border-ink/15 bg-white text-ink/70 hover:bg-ink/5"
                  }`}
                >
                  {l === "zh" ? t.form.langZh : t.form.langEn}
                </button>
              ))}
            </div>
          </div>
        </div>

        {genError ? (
          <div className="mt-4">
            <ErrorState message={genError} />
          </div>
        ) : null}
        <div className="mt-4">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-lg bg-signal px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {generating ? t.form.generating : rewrite ? t.result.regenerate : t.form.generate}
          </button>
        </div>
      </section>

      {/* ③ Result */}
      <section className={`${sectionCls} mt-4`}>
        <h2 className={stepTitleCls}>
          {t.steps.result} · {t.result.title}
        </h2>
        {!rewrite ? (
          <p className="mt-3 text-sm text-ink/55">{t.result.empty}</p>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <ScoreBadge label={t.result.originalScore} value={rewrite.originalScore} />
              <span className="text-xl text-ink/40">→</span>
              <ScoreBadge label={t.result.newScore} value={rewrite.newScore} />
              <span className="text-sm text-ink/60">
                {t.result.appliedCount(appliedCount)}
                {skipped.length > 0
                  ? ` · ${t.result.skippedCount(skipped.length)}`
                  : ""}
              </span>
            </div>

            <div className="space-y-3">
              {rewrites.map((r, i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-lg border border-ink/10"
                >
                  <div className="bg-ink/5 px-4 py-2 text-sm font-medium text-ink">
                    {i + 1}. {r.element}
                    <span className="ml-2 font-normal text-ink/50">
                      {r.location}
                    </span>
                  </div>
                  <div className="grid gap-0 md:grid-cols-2">
                    <div className="border-b border-ink/10 p-4 md:border-b-0 md:border-r">
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-red-600/80">
                        {t.result.before}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-ink/70 line-through decoration-red-300">
                        {r.before}
                      </p>
                    </div>
                    <div className="p-4">
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-green-700/80">
                        {t.result.after}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-ink">
                        {r.after}
                      </p>
                    </div>
                  </div>
                  {r.reason ? (
                    <div className="bg-ink/[0.02] px-4 py-2 text-xs text-ink/55">
                      {t.result.reason}：{r.reason}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">
                {t.result.preview}
              </h3>
              {previewHtml ? (
                <iframe
                  title="rewrite-preview"
                  srcDoc={previewHtml}
                  sandbox=""
                  className="h-[560px] w-full rounded-lg border border-ink/10 bg-white"
                />
              ) : (
                <p className="text-sm text-ink/55">{t.result.noPreview}</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ④ Deploy */}
      {rewrite && rewrite.status === "DRAFT" ? (
        <section className={`${sectionCls} mt-4`}>
          <h2 className={stepTitleCls}>
            {t.steps.deploy} · {t.deploy.title}
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="rw-deploy-name">
                {t.deploy.name}
              </label>
              <input
                id="rw-deploy-name"
                value={deployName}
                onChange={(e) => setDeployName(e.target.value)}
                placeholder={t.deploy.namePh}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="rw-deploy-offer">
                {t.deploy.offer}
              </label>
              <select
                id="rw-deploy-offer"
                value={deployOfferId}
                onChange={(e) => setDeployOfferId(e.target.value)}
                className={inputCls}
              >
                <option value="">—</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink/50">
                {sourceOfferId
                  ? `${t.deploy.offerHint}`
                  : t.deploy.offerHint}
              </p>
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="rw-deploy-url">
                {t.deploy.url}
              </label>
              <input
                id="rw-deploy-url"
                value={deployUrl}
                onChange={(e) => setDeployUrl(e.target.value)}
                placeholder={t.deploy.urlPh}
                className={inputCls}
              />
            </div>
          </div>
          {deployError ? (
            <div className="mt-4">
              <ErrorState message={deployError} />
            </div>
          ) : null}
          <div className="mt-4">
            <button
              type="button"
              onClick={handleDeploy}
              disabled={deploying}
              className="rounded-lg bg-signal px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {deploying ? t.deploy.deploying : t.deploy.confirm}
            </button>
          </div>
        </section>
      ) : null}

      {deployed ? (
        <section className={`${sectionCls} mt-4 border-green-200 bg-green-50/50`}>
          <p className="text-sm font-medium text-green-800">
            ✅ {t.deploy.success}
          </p>
          <p className="mt-1 text-sm text-ink/70">{deployed.name}</p>
          <Link
            href="/landing-pages"
            className="mt-3 inline-block rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {t.deploy.viewPage}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
