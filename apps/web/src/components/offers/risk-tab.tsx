"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import {
  getOfferPolicyAction,
  getOfferRiskAction,
} from "@/lib/api/offer-intel-actions";
import type {
  DecisionValue,
  RiskScore,
} from "@/lib/api/offer-intel";
import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";

type RiskLevel = "veryLow" | "low" | "medium" | "high" | "critical";

export function riskLevelOf(score: number | null): RiskLevel | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score <= 20) return "veryLow";
  if (score <= 40) return "low";
  if (score <= 60) return "medium";
  if (score <= 80) return "high";
  return "critical";
}

const LEVEL_STYLES: Record<RiskLevel, string> = {
  veryLow: "bg-green-100 text-green-800",
  low: "bg-lime-100 text-lime-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

function SubScoreBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const pct = value !== null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-sm font-semibold text-ink">
          {value !== null ? Math.round(value) : "—"}
        </p>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-green-400 via-amber-400 to-red-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Risk tab: 0–100 five-band gauge, sub-scores, critical-rule hits. */
export function RiskTab({ offerId }: { offerId: string }) {
  const t = useDict();
  const d = t.ai.intel.risk;
  const [score, setScore] = useState<RiskScore | null>(null);
  const [criticalRules, setCriticalRules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [r, p] = await Promise.all([
          getOfferRiskAction(offerId),
          getOfferPolicyAction(offerId),
        ]);
        if (!r.ok) {
          setError(r.error);
        } else {
          setScore(r.data);
        }
        if (p.ok && p.data.policy) {
          setCriticalRules(
            Object.entries(p.data.policy.rules)
              .filter(([, v]) => v === "FORBIDDEN")
              .map(([k]) => k)
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [offerId]);

  if (loading) return <p className="text-sm text-ink/55">…</p>;
  if (error)
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    );
  if (!score) return <p className="text-sm text-ink/55">{d.noScore}</p>;

  const level = riskLevelOf(score.overallScore);
  const quality = normalizeDataQuality(score.dataQuality);
  const markerPct =
    score.overallScore !== null
      ? Math.max(0, Math.min(100, score.overallScore))
      : 0;

  return (
    <div>
      <h3 className="text-base font-semibold text-ink">
        {d.overallTitle} <DataQualityBadge quality={quality} />
      </h3>
      <div className="mt-3 rounded-xl border border-ink/10 bg-white/70 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-5xl font-bold text-ink">
            {score.overallScore !== null ? Math.round(score.overallScore) : "—"}
          </p>
          {level ? (
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${LEVEL_STYLES[level]}`}
            >
              {d.levels[level]}
            </span>
          ) : null}
        </div>
        {/* five-band gauge: 0-20 / 21-40 / 41-60 / 61-80 / 81-100 */}
        <div className="relative mt-4">
          <div className="flex h-3 overflow-hidden rounded-full">
            <div className="w-1/5 bg-green-400" />
            <div className="w-1/5 bg-lime-400" />
            <div className="w-1/5 bg-amber-400" />
            <div className="w-1/5 bg-orange-400" />
            <div className="w-1/5 bg-red-500" />
          </div>
          <div
            className="absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded bg-ink"
            style={{ left: `calc(${markerPct}% - 2px)` }}
            aria-hidden
          />
          <div className="mt-1 flex justify-between text-xs text-ink/50">
            <span>0</span>
            <span>20</span>
            <span>40</span>
            <span>60</span>
            <span>80</span>
            <span>100</span>
          </div>
        </div>
        {score.evaluatedAt ? (
          <p className="mt-3 text-xs text-ink/50">
            {d.evaluatedAt(formatDateTime(score.evaluatedAt))}
          </p>
        ) : null}
      </div>

      <h3 className="mt-6 text-base font-semibold text-ink">
        {d.subscoresTitle}
      </h3>
      <div className="mt-3 grid gap-4 rounded-xl border border-ink/10 bg-white/70 p-6 md:grid-cols-2">
        <SubScoreBar label={d.subscores.policy} value={score.policyScore} />
        <SubScoreBar label={d.subscores.profit} value={score.profitScore} />
        <SubScoreBar label={d.subscores.merchant} value={score.merchantScore} />
        <SubScoreBar label={d.subscores.tracking} value={score.trackingScore} />
        <p className="text-xs text-ink/50 md:col-span-2">
          <DataQualityBadge quality={quality} />
        </p>
      </div>

      <h3 className="mt-6 text-base font-semibold text-ink">
        {d.criticalTitle}
      </h3>
      {criticalRules.length === 0 ? (
        <p className="mt-2 text-sm text-ink/55">{d.criticalEmpty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {criticalRules.map((rule) => (
            <li
              key={rule}
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <span className="font-mono font-semibold">{rule}</span>
              <span className="text-xs">
                → {(score.decision as DecisionValue | null) ?? "DO_NOT_RUN"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
