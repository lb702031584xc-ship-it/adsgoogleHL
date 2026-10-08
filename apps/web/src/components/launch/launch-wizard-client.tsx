"use client";

/**
 * Offer 上线一条龙向导：6 步 client 交互。
 * 所有服务端调用都走 @/lib/api/launch-actions.ts（"use server"），
 * 本文件绝不 import @/lib/api/entities 等 server-only 模块（仅 import type）。
 */
import { useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import type { LaunchDict } from "@/i18n/dict/launch";
import type { Offer } from "@/lib/api/entities";
import type { AiAnalysis } from "@/lib/api/ai";
import type { LanderTemplate } from "@/lib/api/lander";
import type { AdPlan } from "@/lib/api/ads-auto";
import type {
  LaunchActivateResult,
  LaunchChecklist,
  LaunchDetail,
} from "@/lib/api/launch";
import {
  activateLaunchAction,
  completeLaunchStepAction,
  createLaunchChecklistAction,
  createTrackingLinkAction,
  generateAdPlanAction,
  getLaunchDetailAction,
  listAnalysesAction,
  listTemplatesAction,
  useTemplateAction,
} from "@/lib/api/launch-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink";
const labelClass = "mb-1 block text-sm font-medium text-ink/80";
const cardClass = "rounded-xl border border-ink/10 bg-white p-4";
const btnPrimary =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/80 transition hover:bg-ink/5 disabled:opacity-50";

interface Props {
  dict: LaunchDict;
  offers: Offer[];
  initialChecklists: LaunchChecklist[];
}

export function LaunchWizardClient({ dict: d, offers, initialChecklists }: Props) {
  const [checklists, setChecklists] = useState<LaunchChecklist[]>(initialChecklists);
  const [detail, setDetail] = useState<LaunchDetail | null>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // per-step state
  const [offerId, setOfferId] = useState("");
  const [analyses, setAnalyses] = useState<AiAnalysis[]>([]);
  const [analysisId, setAnalysisId] = useState("");
  const [publicId, setPublicId] = useState("");
  const [landingMode, setLandingMode] = useState<"template" | "direct">("template");
  const [templates, setTemplates] = useState<LanderTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [landingName, setLandingName] = useState("");
  const [adPlan, setAdPlan] = useState<AdPlan | null>(null);
  const [activateResult, setActivateResult] = useState<LaunchActivateResult | null>(null);
  const [businessNameChecked, setBusinessNameChecked] = useState(false);

  const activeOffer = offers.find((o) => o.id === offerId) ?? detail?.offer ?? null;
  const activeAnalysis = analyses.find((a) => a.id === analysisId) ?? null;

  async function refreshDetail(id: string) {
    const res = await getLaunchDetailAction(id);
    if (res.ok) {
      setDetail(res.data);
      if (res.data.checklist.offerId) setOfferId(res.data.checklist.offerId);
    }
    return res;
  }

  function fail(message: string) {
    setError(message);
    setBusy(null);
  }

  /* ---------- step 1: pick offer ---------- */

  async function startChecklist() {
    if (!offerId) return fail(d.errors.selectOfferFirst);
    setBusy("start");
    setError(null);
    const created = await createLaunchChecklistAction(offerId);
    if (!created.ok) return fail(created.error);
    const id = created.data.id;
    const done = await completeLaunchStepAction(id, 1, { offerId });
    if (!done.ok) return fail(done.error);
    setChecklists((prev) => [done.data, ...prev]);
    await refreshDetail(id);
    setStep(2);
    setBusy(null);
    void loadAnalyses();
  }

  async function resume(id: string) {
    setBusy("resume");
    setError(null);
    const res = await refreshDetail(id);
    if (!res.ok) return fail(res.error);
    const s = res.data.checklist.currentStep;
    setStep(Math.min(Math.max(s, 1), 6));
    // restore step data
    const sd = (res.data.checklist.stepsData ?? {}) as Record<string, unknown>;
    const s5 = sd.step5 as { planId?: string } | undefined;
    if (s5?.planId) {
      // ad plan preview is transient; user can regenerate
    }
    setBusy(null);
    if (s === 2) void loadAnalyses();
    if (s === 4) void loadTemplates();
  }

  /* ---------- step 2: AI analysis ---------- */

  async function loadAnalyses() {
    setBusy("analyses");
    const res = await listAnalysesAction();
    setBusy(null);
    if (!res.ok) return fail(res.error);
    setAnalyses(res.data);
    if (res.data.length > 0 && !analysisId) setAnalysisId(res.data[0].id);
  }

  async function finishStep2() {
    if (!detail) return;
    if (!analysisId) return fail(d.analysisEmpty);
    setBusy("step2");
    const res = await completeLaunchStepAction(detail.checklist.id, 2, { analysisId });
    if (!res.ok) return fail(res.error);
    setStep(3);
    setBusy(null);
  }

  /* ---------- step 3: tracking link ---------- */

  async function finishStep3() {
    if (!detail) return;
    setBusy("step3");
    setError(null);
    const created = await createTrackingLinkAction(detail.checklist.id, {
      publicId: publicId.trim() || undefined,
    });
    if (!created.ok) return fail(created.error);
    const done = await completeLaunchStepAction(detail.checklist.id, 3, {
      trackingLinkId: created.data.trackingLink?.id,
      publicId: created.data.trackingLink?.publicId,
    });
    if (!done.ok) return fail(done.error);
    await refreshDetail(detail.checklist.id);
    setStep(4);
    setBusy(null);
    void loadTemplates();
  }

  /* ---------- step 4: landing page ---------- */

  async function loadTemplates() {
    setBusy("templates");
    const res = await listTemplatesAction();
    setBusy(null);
    if (!res.ok) return fail(res.error);
    setTemplates(res.data);
    if (res.data.length > 0 && !templateId) setTemplateId(res.data[0].id);
  }

  async function finishStep4() {
    if (!detail || !activeOffer) return;
    setBusy("step4");
    setError(null);
    if (landingMode === "direct") {
      const done = await completeLaunchStepAction(detail.checklist.id, 4, {
        skipped: true,
      });
      if (!done.ok) return fail(done.error);
      setStep(5);
      setBusy(null);
      return;
    }
    if (!templateId) return fail(d.templateLabel);
    const name = landingName.trim() || `${activeOffer.name} LP`;
    const res = await useTemplateAction(templateId, {
      offerId: activeOffer.id,
      name,
      variables: { offerName: activeOffer.name, url: activeOffer.destinationUrl },
    });
    if (!res.ok) return fail(res.error);
    const done = await completeLaunchStepAction(detail.checklist.id, 4, {
      landingPageId: res.data.id,
      templateId,
    });
    if (!done.ok) return fail(done.error);
    await refreshDetail(detail.checklist.id);
    setStep(5);
    setBusy(null);
  }

  /* ---------- step 5: ad copy ---------- */

  async function generateAds() {
    if (!activeOffer) return;
    setBusy("ads");
    setError(null);
    const res = await generateAdPlanAction([activeOffer.destinationUrl]);
    if (!res.ok) return fail(res.error);
    setAdPlan(res.data.plan);
    setBusy(null);
  }

  async function finishStep5() {
    if (!detail || !adPlan) return;
    setBusy("step5");
    const res = await completeLaunchStepAction(detail.checklist.id, 5, {
      planId: adPlan.planId,
    });
    if (!res.ok) return fail(res.error);
    setStep(6);
    setBusy(null);
  }

  /* ---------- step 6: go live ---------- */

  async function goLive() {
    if (!detail) return;
    if (!businessNameChecked) return fail(d.businessNameCheckRequired);
    setBusy("activate");
    setError(null);
    const res = await activateLaunchAction(detail.checklist.id);
    if (!res.ok) return fail(res.error);
    setActivateResult(res.data);
    await refreshDetail(detail.checklist.id);
    setBusy(null);
  }

  const stepKeys = [1, 2, 3, 4, 5, 6] as const;

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.title}
        description={d.description}
        actions={
          detail ? (
            <button className={btnGhost} onClick={() => { setDetail(null); setStep(1); setActivateResult(null); setError(null); setBusinessNameChecked(false); }}>
              {d.newChecklist}
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* history / resume */}
      {!detail && checklists.length > 0 && (
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-ink/80">{d.reviewChecklist}</h3>
          <ul className="mt-2 divide-y divide-ink/5">
            {checklists.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink/80">
                  {c.offerId
                    ? offers.find((o) => o.id === c.offerId)?.name ?? c.offerId
                    : "—"}{" "}
                  <span className="text-ink/50">
                    · {d.steps[c.currentStep as 1 | 2 | 3 | 4 | 5 | 6]} · {c.status}
                  </span>
                </span>
                {c.status !== "COMPLETED" && (
                  <button
                    className={btnGhost}
                    disabled={busy === "resume"}
                    onClick={() => void resume(c.id)}
                  >
                    {d.next}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* progress */}
      {detail && (
        <ol className="flex flex-wrap items-center gap-2">
          {stepKeys.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <button
                onClick={() => s < step && setStep(s)}
                disabled={s >= step}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  s < step
                    ? "bg-ink text-white"
                    : s === step
                      ? "bg-signal text-white"
                      : "bg-ink/10 text-ink/50"
                }`}
                title={d.steps[s]}
              >
                {s}
              </button>
              <span
                className={`text-sm ${s === step ? "font-semibold text-ink" : "text-ink/55"}`}
              >
                {d.steps[s]}
              </span>
              {s < 6 && <span className="mx-1 text-ink/25">→</span>}
            </li>
          ))}
        </ol>
      )}

      {/* step 1 */}
      {!detail && (
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-ink">{d.pickOffer}</h3>
          <p className="mt-1 text-sm text-ink/60">{d.pickOfferHint}</p>
          {offers.length === 0 ? (
            <p className="mt-3 text-sm text-ink/60">{d.noOffers}</p>
          ) : (
            <div className="mt-3 max-w-md">
              <label className={labelClass}>{d.offerLabel}</label>
              <select
                className={inputClass}
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
              >
                <option value="">—</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}（{o.network}）
                  </option>
                ))}
              </select>
              <button
                className={`${btnPrimary} mt-3`}
                disabled={busy === "start" || !offerId}
                onClick={() => void startChecklist()}
              >
                {busy === "start" ? "…" : d.next}
              </button>
              {offers.find((o) => o.id === offerId)?.network === "amazon" && (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">
                    {d.amazonDirectLinkWarning}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* step 2 */}
      {detail && step === 2 && (
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-ink">{d.analysisTitle}</h3>
          {busy === "analyses" ? (
            <p className="mt-3 text-sm text-ink/60">…</p>
          ) : analyses.length === 0 ? (
            <div className="mt-3 text-sm text-ink/60">
              <p>{d.analysisEmpty}</p>
              <a href="/ai/analyze" className="mt-2 inline-block text-signal underline">
                {d.goAnalyze}
              </a>
            </div>
          ) : (
            <div className="mt-3 max-w-md">
              <label className={labelClass}>{d.analysisTitle}</label>
              <select
                className={inputClass}
                value={analysisId}
                onChange={(e) => setAnalysisId(e.target.value)}
              >
                {analyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.merchant ?? a.network ?? a.id} · {(a.analyzedAt ?? "").slice(0, 10)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {activeAnalysis && (
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div className="rounded-lg bg-ink/5 p-3">
                <dt className="text-ink/55">{d.analysis.risk}</dt>
                <dd className="text-lg font-semibold text-ink">
                  {activeAnalysis.analysis.overallRisk}
                </dd>
              </div>
              <div className="rounded-lg bg-ink/5 p-3">
                <dt className="text-ink/55">{d.analysis.merchant}</dt>
                <dd className="text-lg font-semibold text-ink">
                  {activeAnalysis.analysis.scores.merchant}
                </dd>
              </div>
              <div className="rounded-lg bg-ink/5 p-3">
                <dt className="text-ink/55">{d.analysis.policy}</dt>
                <dd className="text-lg font-semibold text-ink">
                  {activeAnalysis.analysis.scores.policy}
                </dd>
              </div>
              <div className="rounded-lg bg-ink/5 p-3">
                <dt className="text-ink/55">{d.analysis.network}</dt>
                <dd className="text-lg font-semibold text-ink">
                  {activeAnalysis.analysis.scores.network}
                </dd>
              </div>
            </dl>
          )}
          {activeAnalysis && activeAnalysis.analysis.suggestions.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="font-medium text-ink/80">{d.analysis.suggestions}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink/70">
                {activeAnalysis.analysis.suggestions.slice(0, 5).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button className={btnGhost} onClick={() => setStep(1)} disabled={busy === "step2"}>
              {d.prev}
            </button>
            <button
              className={btnPrimary}
              disabled={busy === "step2" || !analysisId}
              onClick={() => void finishStep2()}
            >
              {busy === "step2" ? "…" : d.completeStep}
            </button>
          </div>
        </div>
      )}

      {/* step 3 */}
      {detail && step === 3 && (
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-ink">{d.trackingTitle}</h3>
          <p className="mt-1 text-sm text-ink/60">{d.trackingHint}</p>
          {activeOffer && (
            <p className="mt-2 break-all font-mono text-xs text-ink/55">
              {activeOffer.destinationUrl}
            </p>
          )}
          <div className="mt-3 max-w-md space-y-3">
            <div>
              <label className={labelClass}>{d.trackingPublicId}</label>
              <input
                className={inputClass}
                value={publicId}
                onChange={(e) => setPublicId(e.target.value)}
                placeholder={d.trackingNamePlaceholder}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className={btnGhost} onClick={() => setStep(2)} disabled={busy === "step3"}>
              {d.prev}
            </button>
            <button
              className={btnPrimary}
              disabled={busy === "step3"}
              onClick={() => void finishStep3()}
            >
              {busy === "step3" ? "…" : d.completeStep}
            </button>
          </div>
        </div>
      )}

      {/* step 4 */}
      {detail && step === 4 && (
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-ink">{d.landingTitle}</h3>
          <div className="mt-3 flex gap-2">
            <button
              className={landingMode === "template" ? btnPrimary : btnGhost}
              onClick={() => setLandingMode("template")}
            >
              {d.landingModeTemplate}
            </button>
            <button
              className={landingMode === "direct" ? btnPrimary : btnGhost}
              onClick={() => setLandingMode("direct")}
            >
              {d.landingModeDirect}
            </button>
          </div>
          {landingMode === "template" && (
            <div className="mt-3 max-w-md space-y-3">
              <div>
                <label className={labelClass}>{d.templateLabel}</label>
                <select
                  className={inputClass}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}（{t.category}）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>{d.templateName}</label>
                <input
                  className={inputClass}
                  value={landingName}
                  onChange={(e) => setLandingName(e.target.value)}
                  placeholder={activeOffer ? `${activeOffer.name} LP` : ""}
                />
              </div>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button className={btnGhost} onClick={() => setStep(3)} disabled={busy === "step4"}>
              {d.prev}
            </button>
            <button
              className={btnPrimary}
              disabled={busy === "step4" || (landingMode === "template" && !templateId)}
              onClick={() => void finishStep4()}
            >
              {busy === "step4" ? "…" : d.completeStep}
            </button>
          </div>
        </div>
      )}

      {/* step 5 */}
      {detail && step === 5 && (
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-ink">{d.adTitle}</h3>
          <p className="mt-1 text-sm text-ink/60">{d.adHint}</p>
          {!adPlan ? (
            <button
              className={`${btnPrimary} mt-3`}
              disabled={busy === "ads" || !activeOffer}
              onClick={() => void generateAds()}
            >
              {busy === "ads" ? d.adGenerating : d.adGenerate}
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              {adPlan.adGroups.slice(0, 2).map((block, gi) => (
                <div key={gi} className="rounded-lg bg-ink/5 p-3">
                  <p className="text-sm font-semibold text-ink">{block.group.name}</p>
                  <p className="mt-1 text-xs font-medium text-ink/60">RSA</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-ink/80">
                    {block.rsa.headlines.slice(0, 5).map((h, i) => (
                      <li key={i}>· {h}</li>
                    ))}
                  </ul>
                  {block.rsa.descriptions.slice(0, 2).map((desc, i) => (
                    <p key={i} className="mt-1 text-sm text-ink/70">{desc}</p>
                  ))}
                </div>
              ))}
              <p className="text-xs text-ink/55">
                {adPlan.adGroups.length} ad groups · plan {adPlan.planId.slice(0, 8)}
              </p>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button className={btnGhost} onClick={() => setStep(4)} disabled={busy === "step5"}>
              {d.prev}
            </button>
            <button
              className={btnPrimary}
              disabled={busy === "step5" || !adPlan}
              onClick={() => void finishStep5()}
            >
              {busy === "step5" ? "…" : d.completeStep}
            </button>
          </div>
        </div>
      )}

      {/* step 6 */}
      {detail && step === 6 && (
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-ink">{d.reviewTitle}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink/55">{d.steps[1]}</dt>
              <dd className="font-medium text-ink">{activeOffer?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink/55">{d.steps[2]}</dt>
              <dd className="font-medium text-ink">
                {activeAnalysis ? `${d.analysis.risk}: ${activeAnalysis.analysis.overallRisk}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink/55">{d.steps[3]}</dt>
              <dd className="break-all font-mono text-xs text-ink">
                {detail.trackingLink?.publicId ?? "—"} ({detail.trackingLink?.status})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink/55">{d.steps[4]}</dt>
              <dd className="font-medium text-ink">
                {detail.landingPage?.name ?? d.landingModeDirect}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink/55">{d.steps[5]}</dt>
              <dd className="font-medium text-ink">
                {adPlan ? adPlan.planId.slice(0, 8) : d.adEmpty}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-ink/60">{d.goLiveHint}</p>
          {!activateResult && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={businessNameChecked}
                onChange={(e) => setBusinessNameChecked(e.target.checked)}
              />
              <span>
                <span className="font-medium text-ink">{d.businessNameCheck}：</span>
                <span className="text-ink/70">{d.businessNameCheckHint}</span>
                <span className="mt-1 block font-medium text-ink">
                  {d.businessNameCheckConfirm}
                </span>
              </span>
            </label>
          )}
          {activateResult ? (
            <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
              <p className="font-medium">{d.activated}</p>
              {activateResult.scriptPush.note && (
                <p className="mt-1 text-green-700">{activateResult.scriptPush.note}</p>
              )}
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              <button className={btnGhost} onClick={() => setStep(5)} disabled={busy === "activate"}>
                {d.prev}
              </button>
              <button
                className={btnPrimary}
                disabled={busy === "activate" || !detail.trackingLink || !businessNameChecked}
                onClick={() => void goLive()}
              >
                {busy === "activate" ? "…" : d.goLive}
              </button>
            </div>
          )}
          {!detail.trackingLink && !activateResult && (
            <p className="mt-2 text-sm text-red-600">{d.errors.needTrackingLink}</p>
          )}
        </div>
      )}
    </div>
  );
}
