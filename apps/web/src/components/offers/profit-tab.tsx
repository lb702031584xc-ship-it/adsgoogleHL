"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as budgetZh, en as budgetEn } from "@/i18n/dict/budget";
import {
  getOfferBudgetAction,
  type BudgetRecommendation,
} from "@/lib/api/budget-actions";
import {
  getOfferProfitAction,
  simulateOfferAction,
} from "@/lib/api/offer-intel-actions";
import type {
  ProfitModel,
  ScenarioTable,
  SimulateInput,
} from "@/lib/api/offer-intel";
import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";

/**
 * Pure input validation for the what-if simulate form. Exported for tests.
 */
export interface SimulateFormErrors {
  cpc?: string;
  cvr?: string;
  clicks?: string;
}

export function validateSimulateInput(
  cpcRaw: string,
  cvrRaw: string,
  clicksRaw: string
): { ok: true; input: SimulateInput } | { ok: false; errors: SimulateFormErrors } {
  const errors: SimulateFormErrors = {};
  const cpc = parseFloat(cpcRaw.trim());
  if (!Number.isFinite(cpc) || cpc <= 0) errors.cpc = "cpc";
  const cvr = parseFloat(cvrRaw.trim());
  if (!Number.isFinite(cvr) || cvr < 0 || cvr > 100) errors.cvr = "cvr";
  let clicks: number | undefined;
  if (clicksRaw.trim() !== "") {
    const n = Number(clicksRaw.trim());
    if (!Number.isInteger(n) || n <= 0) errors.clicks = "clicks";
    else clicks = n;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: clicks !== undefined ? { cpc, cvr, clicks } : { cpc, cvr } };
}

function fmt(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Budget dict picked by the current language (falls back to English). */
function useBudgetDict() {
  try {
    return useI18n().lang === "en" ? budgetEn : budgetZh;
  } catch {
    return budgetEn;
  }
}

/** Phase 3 budget recommendation section at the bottom of the profit tab. */
function BudgetSection({ offerId }: { offerId: string }) {
  const bdict = useBudgetDict();
  const bd = bdict.budget;
  const [budget, setBudget] = useState<BudgetRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getOfferBudgetAction(offerId);
        if (res.ok) setBudget(res.data);
        else setError(res.error);
      } catch {
        setError(bd.failed);
      } finally {
        setLoading(false);
      }
    })();
  }, [offerId, bd.failed]);

  const money = (n: number | null, digits = 2) =>
    n === null || !Number.isFinite(n) ? "—" : `$${fmt(n, digits)}`;

  const scenarioCards: Array<[string, number | null]> = budget
    ? [
        [bd.scenarios.worst, budget.budgetByScenario.worst],
        [bd.scenarios.base, budget.budgetByScenario.base],
        [bd.scenarios.best, budget.budgetByScenario.best],
      ]
    : [];

  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold text-ink">
        {bd.title}{" "}
        <span className="text-xs font-normal text-ink/50">
          {bd.testBasis(100, 7)}
        </span>
      </h3>
      {loading ? (
        <p className="mt-3 text-sm text-ink/55">{bd.loading}</p>
      ) : error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : budget ? (
        <div className="mt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4">
              <p className="text-sm font-medium text-ink">
                {bd.dailyBudget}{" "}
                <DataQualityBadge
                  quality={normalizeDataQuality(budget.dataQuality)}
                />
              </p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {money(budget.dailyBudget)}
              </p>
            </div>
            <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4">
              <p className="text-sm font-medium text-ink">
                {bd.totalTestBudget}{" "}
                <DataQualityBadge
                  quality={normalizeDataQuality(budget.dataQuality)}
                />
              </p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {money(budget.totalTestBudget)}
              </p>
            </div>
          </div>

          <h4 className="mt-4 text-sm font-semibold text-ink">
            {bd.scenarioBudgets}
          </h4>
          <dl className="mt-2 grid gap-3 md:grid-cols-3">
            {scenarioCards.map(([name, value]) => (
              <div
                key={name}
                className="rounded-xl border border-ink/10 bg-white/70 px-4 py-3"
              >
                <dt className="text-xs text-ink/55">{name}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-ink">
                  {money(value)}
                </dd>
              </div>
            ))}
          </dl>

          {budget.reason.length > 0 ? (
            <div className="mt-3 rounded-xl border border-ink/10 bg-white/70 px-4 py-3">
              <p className="text-xs font-medium text-ink/55">{bd.reasons}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/75">
                {budget.reason.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScenarioTableView({
  scenarios,
  quality,
  currency,
}: {
  scenarios: ScenarioTable;
  quality: "OBSERVED" | "PREDICTED" | "UNKNOWN";
  currency: string | null;
}) {
  const t = useDict();
  const d = t.ai.intel.profit;
  const rows = [
    [d.scenarioNames.worst, scenarios.worst],
    [d.scenarioNames.base, scenarios.base],
    [d.scenarioNames.best, scenarios.best],
  ] as const;
  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-ink/5 text-ink/60">
          <tr>
            <th className="px-3 py-2">{d.columns.scenario}</th>
            <th className="px-3 py-2">{d.columns.cvr}</th>
            <th className="px-3 py-2">{d.columns.cpc}</th>
            <th className="px-3 py-2">{d.columns.clicks}</th>
            <th className="px-3 py-2">{d.columns.profit}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, s]) => (
            <tr key={name} className="border-t border-ink/10">
              <td className="px-3 py-2 font-medium text-ink">{name}</td>
              <td className="px-3 py-2 text-ink/80">
                {s.cvr !== null ? `${fmt(s.cvr)}%` : "—"}
              </td>
              <td className="px-3 py-2 text-ink/80">
                {s.cpc !== null ? `$${fmt(s.cpc, 4)}` : "—"}
              </td>
              <td className="px-3 py-2 text-ink/80">
                {s.clicks !== null ? fmt(s.clicks, 0) : "—"}
              </td>
              <td className="px-3 py-2 font-semibold text-ink">
                {s.profit !== null
                  ? `${s.profit < 0 ? "−" : ""}$${fmt(Math.abs(s.profit))}${currency ? ` ${currency}` : ""}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-ink/10 px-3 py-2 text-xs text-ink/50">
        <DataQualityBadge quality={quality} />
      </p>
    </div>
  );
}

/** Profit tab: break-even CPC, three-scenario table, what-if simulation. */
export function ProfitTab({ offerId }: { offerId: string }) {
  const t = useDict();
  const d = t.ai.intel.profit;
  const [model, setModel] = useState<ProfitModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scenarios, setScenarios] = useState<ScenarioTable | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [fCpc, setFCpc] = useState("");
  const [fCvr, setFCvr] = useState("");
  const [fClicks, setFClicks] = useState("");
  const [formErrors, setFormErrors] = useState<SimulateFormErrors>({});
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getOfferProfitAction(offerId);
        if (res.ok) {
          setModel(res.data);
          setScenarios(res.data?.scenarios ?? null);
          setSimulated(false);
        } else {
          setError(res.error);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [offerId]);

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function onSimulate(e: React.FormEvent) {
    e.preventDefault();
    setSimulateError(null);
    const v = validateSimulateInput(fCpc, fCvr, fClicks);
    if (!v.ok) {
      setFormErrors(v.errors);
      return;
    }
    setFormErrors({});
    setSimulating(true);
    try {
      const res = await simulateOfferAction(offerId, v.input);
      if (res.ok) {
        setScenarios(res.data);
        setSimulated(true);
      } else {
        setSimulateError(res.error);
      }
    } finally {
      setSimulating(false);
    }
  }

  if (loading) return <p className="text-sm text-ink/55">…</p>;
  if (error)
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    );
  if (!model) return <p className="text-sm text-ink/55">{d.noModel}</p>;

  const quality = normalizeDataQuality(model.dataQuality);
  const params: Array<[string, string]> = [
    [d.commission, model.commission !== null ? `$${fmt(model.commission)}` : "—"],
    [d.commissionType, model.commissionType ?? "—"],
    [d.currency, model.currency ?? "—"],
    [d.expectedCvr, model.expectedCvr !== null ? `${fmt(model.expectedCvr)}%` : "—"],
    [d.approvalRate, model.approvalRate !== null ? `${fmt(model.approvalRate)}%` : "—"],
    [d.attributionRate, model.attributionRate !== null ? `${fmt(model.attributionRate)}%` : "—"],
    [d.refundRate, model.refundRate !== null ? `${fmt(model.refundRate)}%` : "—"],
  ];

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4">
          <p className="text-sm font-medium text-ink">
            {d.breakEvenCpc} <DataQualityBadge quality={quality} />
          </p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            {model.breakEvenCpc !== null
              ? `$${fmt(model.breakEvenCpc, 4)}`
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-ink/10 bg-white/70 px-5 py-4">
          <p className="text-sm font-medium text-ink">
            {d.recommendedMaxCpc} <DataQualityBadge quality={quality} />
          </p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            {model.recommendedMaxCpc !== null
              ? `$${fmt(model.recommendedMaxCpc, 4)}`
              : "—"}
          </p>
        </div>
      </div>

      <h3 className="mt-6 text-base font-semibold text-ink">{d.modelTitle}</h3>
      <dl className="mt-3 grid gap-3 md:grid-cols-4">
        {params.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-ink/10 bg-white/70 px-4 py-3"
          >
            <dt className="text-xs text-ink/55">
              {label} <DataQualityBadge quality={quality} />
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-6 text-base font-semibold text-ink">
        {d.scenariosTitle}
        {simulated ? (
          <span className="ml-2 text-xs font-normal text-ink/50">
            ({d.simulateTitle})
          </span>
        ) : null}
      </h3>
      <div className="mt-3">
        {scenarios ? (
          <ScenarioTableView
            scenarios={scenarios}
            quality={quality}
            currency={model.currency}
          />
        ) : (
          <p className="text-sm text-ink/55">{d.noModel}</p>
        )}
      </div>

      <h3 className="mt-6 text-base font-semibold text-ink">
        {d.simulateTitle}
      </h3>
      <p className="mt-1 text-sm text-ink/60">{d.simulateDesc}</p>
      <form
        onSubmit={onSimulate}
        className="mt-3 grid gap-4 rounded-xl border border-ink/10 bg-white/70 p-6 md:grid-cols-3"
      >
        <div>
          <label className={labelClass} htmlFor="sim-cpc">
            {d.cpcLabel}
          </label>
          <input
            id="sim-cpc"
            inputMode="decimal"
            value={fCpc}
            onChange={(e) => setFCpc(e.target.value)}
            placeholder="0.80"
            className={inputClass}
          />
          {formErrors.cpc ? (
            <p className="mt-1 text-xs text-red-700">{d.invalidCpc}</p>
          ) : null}
        </div>
        <div>
          <label className={labelClass} htmlFor="sim-cvr">
            {d.cvrLabel}
          </label>
          <input
            id="sim-cvr"
            inputMode="decimal"
            value={fCvr}
            onChange={(e) => setFCvr(e.target.value)}
            placeholder="2.5"
            className={inputClass}
          />
          {formErrors.cvr ? (
            <p className="mt-1 text-xs text-red-700">{d.invalidCvr}</p>
          ) : null}
        </div>
        <div>
          <label className={labelClass} htmlFor="sim-clicks">
            {d.clicksLabel}
          </label>
          <input
            id="sim-clicks"
            inputMode="numeric"
            value={fClicks}
            onChange={(e) => setFClicks(e.target.value)}
            placeholder="1000"
            className={inputClass}
          />
          {formErrors.clicks ? (
            <p className="mt-1 text-xs text-red-700">{d.invalidClicks}</p>
          ) : null}
        </div>
        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={simulating}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {simulating ? d.simulating : d.submit}
          </button>
        </div>
      </form>
      {simulateError ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {simulateError}
        </p>
      ) : null}

      <BudgetSection offerId={offerId} />
    </div>
  );
}
