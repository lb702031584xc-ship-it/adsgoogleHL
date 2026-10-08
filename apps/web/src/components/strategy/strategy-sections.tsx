"use client";

import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";
import { decisionBadgeClass } from "@/components/decision/decision-view";
import type {
  CampaignPlan,
  ResearchResult,
  ScaleRecommendation,
  StrategyDecision,
  StrategyExperiment,
  StrategyKillSwitch,
  StrategyOutput,
  StrategyTraffic,
} from "@/lib/api/strategy";
import type { ProfitModel } from "@/lib/api/offer-intel";
import type { StrategyDict } from "@/i18n/dict/strategy";

const cardClass = "rounded-xl border border-ink/15 bg-white p-4";
const sectionTitleClass = "mb-3 text-base font-semibold text-ink";

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${fmtNum(n)}%`;
}

/** §32 decision card: verdict badge, scores, break-even, rationale. */
export function DecisionCard({
  decision,
  dict,
}: {
  decision: StrategyDecision;
  dict: StrategyDict;
}) {
  const d = dict.decision;
  const label = d.labels[decision.decision] ?? decision.decision;
  const trafficLabel =
    d.trafficModes[decision.trafficMode as keyof typeof d.trafficModes] ??
    decision.trafficMode;
  return (
    <section className={cardClass} aria-label={d.title}>
      <h2 className={sectionTitleClass}>{d.title}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-lg border px-3 py-1 text-sm font-semibold ${decisionBadgeClass(decision.decision)}`}
        >
          {label}
        </span>
        <span className="text-sm text-ink/70">
          {d.confidence}:{" "}
          {decision.confidence != null
            ? `${Math.round(decision.confidence * 100)}%`
            : "—"}
        </span>
        <DataQualityBadge quality={normalizeDataQuality(decision.dataQuality)} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink/55">{d.riskScore}</dt>
          <dd className="font-medium text-ink">{fmtNum(decision.riskScore, 0)}</dd>
        </div>
        <div>
          <dt className="text-ink/55">{d.profitScore}</dt>
          <dd className="font-medium text-ink">{fmtNum(decision.profitScore, 0)}</dd>
        </div>
        <div>
          <dt className="text-ink/55">{d.policyScore}</dt>
          <dd className="font-medium text-ink">{fmtNum(decision.policyScore, 0)}</dd>
        </div>
        <div>
          <dt className="text-ink/55">{d.breakEvenCpc}</dt>
          <dd className="font-medium text-ink">{fmtNum(decision.breakEvenCpc, 4)}</dd>
        </div>
        <div>
          <dt className="text-ink/55">{d.recommendedMaxCpc}</dt>
          <dd className="font-medium text-ink">
            {fmtNum(decision.recommendedMaxCpc, 4)}
          </dd>
        </div>
        <div>
          <dt className="text-ink/55">{d.trafficMode}</dt>
          <dd className="font-medium text-ink">{trafficLabel}</dd>
        </div>
      </dl>
      {decision.reason.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium text-ink/80">{d.reasons}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/75">
            {decision.reason.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {decision.manualChecks.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium text-ink/80">{d.manualChecks}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/75">
            {decision.manualChecks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Profit: three scenarios + break-even from the latest ProfitModel. */
export function ProfitCard({
  model,
  dict,
}: {
  model: ProfitModel | null;
  dict: StrategyDict;
}) {
  const d = dict.profit;
  const scenarios = model?.scenarios;
  return (
    <section className={cardClass} aria-label={d.title}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className={sectionTitleClass + " mb-0"}>{d.title}</h2>
        <DataQualityBadge
          quality={normalizeDataQuality(model?.dataQuality)}
        />
      </div>
      {!model || !scenarios ? (
        <p className="text-sm text-ink/55">{d.noModel}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/55">
                  <th className="py-1 pr-3 font-medium"></th>
                  <th className="py-1 pr-3 font-medium">{d.cvr}</th>
                  <th className="py-1 pr-3 font-medium">{d.cpc}</th>
                  <th className="py-1 pr-3 font-medium">{d.clicks}</th>
                  <th className="py-1 font-medium">{d.profit}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["worst", d.scenarios.worst],
                    ["base", d.scenarios.base],
                    ["best", d.scenarios.best],
                  ] as const
                ).map(([key, label]) => {
                  const row = scenarios[key];
                  return (
                    <tr key={key} className="border-t border-ink/10">
                      <td className="py-1 pr-3 font-medium text-ink">{label}</td>
                      <td className="py-1 pr-3 text-ink/80">{fmtPct(row?.cvr)}</td>
                      <td className="py-1 pr-3 text-ink/80">{fmtNum(row?.cpc, 4)}</td>
                      <td className="py-1 pr-3 text-ink/80">
                        {fmtNum(row?.clicks, 0)}
                      </td>
                      <td className="py-1 font-medium text-ink">
                        {fmtNum(row?.profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-ink/70">
            {d.breakEven}: <strong>{fmtNum(model.breakEvenCpc, 4)}</strong>
            {" · "}
            {d.maxCpc}: <strong>{fmtNum(model.recommendedMaxCpc, 4)}</strong>
          </p>
        </>
      )}
    </section>
  );
}

/** Real traffic summary (read-only, OBSERVED when clicks exist). */
export function TrafficCard({
  traffic,
  dict,
}: {
  traffic: StrategyTraffic;
  dict: StrategyDict;
}) {
  const d = dict.traffic;
  return (
    <section className={cardClass} aria-label={d.title}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className={sectionTitleClass + " mb-0"}>{d.title}</h2>
        <DataQualityBadge quality={normalizeDataQuality(traffic.dataQuality)} />
      </div>
      {traffic.clicks === 0 ? (
        <p className="text-sm text-ink/55">{d.noData}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink/55">{d.clicks}</dt>
              <dd className="font-medium text-ink">{traffic.clicks}</dd>
            </div>
            <div>
              <dt className="text-ink/55">{d.conversions}</dt>
              <dd className="font-medium text-ink">{traffic.conversions}</dd>
            </div>
            <div>
              <dt className="text-ink/55">{d.cvr}</dt>
              <dd className="font-medium text-ink">{fmtPct(traffic.cvrPct)}</dd>
            </div>
            <div>
              <dt className="text-ink/55">{d.epc}</dt>
              <dd className="font-medium text-ink">{fmtNum(traffic.epc, 4)}</dd>
            </div>
          </dl>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <h3 className="font-medium text-ink/80">{d.topGeo}</h3>
              <ul className="mt-1 space-y-0.5 text-ink/70">
                {traffic.topGeo.map((g) => (
                  <li key={g.value}>
                    {g.value} — {g.count}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-ink/80">{d.topDevice}</h3>
              <ul className="mt-1 space-y-0.5 text-ink/70">
                {traffic.topDevice.map((g) => (
                  <li key={g.value}>
                    {g.value} — {g.count}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Experiment list + advice to run LP-vs-direct-link validation. */
export function ExperimentsCard({
  experiments,
  dict,
}: {
  experiments: StrategyExperiment[];
  dict: StrategyDict;
}) {
  const d = dict.experiments;
  const hasRunning = experiments.some((e) => e.status === "RUNNING");
  return (
    <section className={cardClass} aria-label={d.title}>
      <h2 className={sectionTitleClass}>{d.title}</h2>
      {experiments.length === 0 ? (
        <p className="text-sm text-ink/55">{d.empty}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {experiments.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-ink/10 px-3 py-2"
            >
              <span className="font-medium text-ink">{e.name}</span>
              <span className="text-ink/60">
                {d.status}:{" "}
                {d.statuses[e.status as keyof typeof d.statuses] ?? e.status}
              </span>
              {e.winner ? (
                <span className="text-ink/60">
                  {d.winner}: {e.winner}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!hasRunning ? (
        <p className="mt-3 rounded-lg bg-ink/5 px-3 py-2 text-sm text-ink/75">
          {d.suggest}
        </p>
      ) : null}
    </section>
  );
}

/** Kill-switch config + recent trigger events. */
export function KillSwitchCard({
  killSwitch,
  dict,
}: {
  killSwitch: StrategyKillSwitch;
  dict: StrategyDict;
}) {
  const d = dict.killSwitch;
  const cfg = killSwitch.config;
  return (
    <section className={cardClass} aria-label={d.title}>
      <h2 className={sectionTitleClass}>{d.title}</h2>
      {!cfg ? (
        <p className="text-sm text-ink/55">{d.noConfig}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink/55">{d.enabled}</dt>
            <dd className="font-medium text-ink">
              {cfg.enabled ? d.enabled : d.disabled}
            </dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.maxSpend}</dt>
            <dd className="font-medium text-ink">{fmtNum(cfg.maxSpend)}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.minProfit}</dt>
            <dd className="font-medium text-ink">{fmtNum(cfg.minExpectedProfit)}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.minCvr}</dt>
            <dd className="font-medium text-ink">{fmtPct(cfg.minCvr)}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.maxPolicyRisk}</dt>
            <dd className="font-medium text-ink">{fmtNum(cfg.maxPolicyRisk, 0)}</dd>
          </div>
        </dl>
      )}
      <h3 className="mt-3 text-sm font-medium text-ink/80">{d.recentEvents}</h3>
      {killSwitch.recentEvents.length === 0 ? (
        <p className="mt-1 text-sm text-ink/55">{d.noEvents}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm text-ink/75">
          {killSwitch.recentEvents.map((e) => (
            <li key={e.id}>
              {e.triggeredBy} → {e.actionTaken}
              {e.linksPaused > 0 ? ` (${e.linksPaused})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Phase 4 research findings (graceful NO_DATA state). */
export function ResearchCard({
  research,
  dict,
}: {
  research: ResearchResult;
  dict: StrategyDict;
}) {
  const d = dict.research;
  return (
    <section className={cardClass} aria-label={d.title}>
      <h2 className={sectionTitleClass}>{d.title}</h2>
      {research.status === "NO_DATA" ? (
        <p className="text-sm text-ink/55">{d.noData}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-ink/55">{d.score}</dt>
            <dd className="font-medium text-ink">{fmtNum(research.score, 0)}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.band}</dt>
            <dd className="font-medium text-ink">{research.band ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.classification}</dt>
            <dd className="font-medium text-ink">
              {research.classification ?? "—"}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-sm text-ink/75">{research.summary}</p>
    </section>
  );
}

/** Campaign plan document: campaigns → ad groups → keywords + JSON download. */
export function PlanView({
  plan,
  dict,
  onDownload,
}: {
  plan: CampaignPlan;
  dict: StrategyDict;
  onDownload: () => void;
}) {
  const d = dict.plan;
  return (
    <section className={cardClass} aria-label={d.title}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className={sectionTitleClass + " mb-0"}>{d.title}</h2>
          <DataQualityBadge quality={normalizeDataQuality(plan.dataQuality)} />
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-ink/90"
        >
          {d.download}
        </button>
      </div>
      <p className="mb-3 text-sm text-ink/60">{d.description}</p>
      {plan.campaigns.map((c) => (
        <div
          key={c.name}
          className="mb-3 rounded-lg border border-ink/10 p-3"
        >
          <h3 className="text-sm font-semibold text-ink">{c.name}</h3>
          {c.adGroups.map((g) => (
            <div key={g.name} className="mt-2">
              <h4 className="text-sm font-medium text-ink/80">
                {g.name} ·{" "}
                {d.matchTypes[g.matchType as keyof typeof d.matchTypes] ??
                  g.matchType}
              </h4>
              {g.keywords.length === 0 ? (
                <p className="text-sm text-ink/55">{d.empty}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {g.keywords.map((k) => (
                    <li
                      key={`${g.matchType}:${k.text}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
                    >
                      <code className="rounded bg-ink/5 px-1.5 py-0.5 text-ink">
                        {k.matchType === "EXACT" ? `[${k.text}]` : `"${k.text}"`}
                      </code>
                      <span className="text-ink/60">
                        {d.bid}: {fmtNum(k.suggestedBid, 4)}
                      </span>
                      <DataQualityBadge
                        quality={normalizeDataQuality(k.dataQuality)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-sm font-medium text-ink/80">{d.negatives}</h4>
          {plan.negatives.exact.length === 0 &&
          plan.negatives.phrase.length === 0 ? (
            <p className="text-sm text-ink/55">{d.empty}</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm text-ink/70">
              {plan.negatives.exact.map((n) => (
                <li key={`e:${n}`}>
                  <code className="rounded bg-ink/5 px-1.5 py-0.5">{n}</code>
                </li>
              ))}
              {plan.negatives.phrase.map((n) => (
                <li key={`p:${n}`}>
                  <code className="rounded bg-ink/5 px-1.5 py-0.5">{n}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-sm font-medium text-ink/80">{d.budget}</h4>
          <dl className="mt-1 space-y-0.5 text-sm text-ink/70">
            <div className="flex justify-between gap-2">
              <dt>{d.dailyBudget}</dt>
              <dd className="font-medium text-ink">
                {fmtNum(plan.budget.dailyBudget)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>{d.totalTestBudget}</dt>
              <dd className="font-medium text-ink">
                {fmtNum(plan.budget.totalTestBudget)}
              </dd>
            </div>
          </dl>
          <DataQualityBadge
            quality={normalizeDataQuality(plan.budget.dataQuality)}
          />
        </div>
      </div>
      {plan.notes.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-sm font-medium text-ink/80">{d.notes}</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/65">
            {plan.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Scale advice: symmetric to the kill switch — advisory only. */
export function ScaleCard({
  scale,
  dict,
}: {
  scale: ScaleRecommendation | null;
  dict: StrategyDict;
}) {
  const d = dict.scale;
  if (!scale) return null;
  return (
    <section className={cardClass} aria-label={d.title}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className={sectionTitleClass + " mb-0"}>{d.title}</h2>
        <DataQualityBadge quality={normalizeDataQuality(scale.dataQuality)} />
      </div>
      <p className="text-sm text-ink/75">
        {scale.eligible ? d.eligible : d.notEligible}
      </p>
      {scale.reason.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/70">
          {scale.reason.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {scale.eligible ? (
        <dl className="mt-2 grid grid-cols-3 gap-x-4 text-sm">
          <div>
            <dt className="text-ink/55">{d.currentDaily}</dt>
            <dd className="font-medium text-ink">
              {fmtNum(scale.currentDailyBudget)}
            </dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.multiplier}</dt>
            <dd className="font-medium text-ink">
              ×{fmtNum(scale.multiplier)}
            </dd>
          </div>
          <div>
            <dt className="text-ink/55">{d.suggestedDaily}</dt>
            <dd className="font-medium text-ink">
              {fmtNum(scale.suggestedDailyBudget)}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="mt-2 text-xs text-ink/55">{d.advisory}</p>
    </section>
  );
}

/** Re-exported for the client page. */
export type { StrategyOutput };
