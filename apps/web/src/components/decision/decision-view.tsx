"use client";

import { useState } from "react";
import { useDict } from "@/i18n/use-dict";
import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";
import {
  approveOfferAction,
  pauseOfferAction,
} from "@/lib/api/offer-intel-actions";
import type {
  DecisionValue,
  OfferDecision,
} from "@/lib/api/offer-intel";

const DECISION_STYLES: Record<DecisionValue, string> = {
  RUN: "bg-green-100 text-green-800 border-green-300",
  TEST: "bg-blue-100 text-blue-800 border-blue-300",
  MANUAL_REVIEW: "bg-amber-100 text-amber-800 border-amber-300",
  DO_NOT_RUN: "bg-red-100 text-red-800 border-red-300",
};

export function decisionBadgeClass(decision: DecisionValue): string {
  return DECISION_STYLES[decision] ?? "bg-ink/10 text-ink/60 border-ink/20";
}

function fmtNum(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function ApprovePauseButtons({ offerId }: { offerId: string }) {
  const t = useDict();
  const d = t.ai.intel.decision;
  const [mode, setMode] = useState<"approve" | "pause" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onConfirm() {
    if (!mode) return;
    if (!reason.trim()) {
      setError(d.reasonRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res =
        mode === "approve"
          ? await approveOfferAction(offerId, reason.trim())
          : await pauseOfferAction(offerId, reason.trim());
      if (res.ok) {
        setDone(d.actionDone);
        setMode(null);
        setReason("");
      } else {
        setError(res.error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMode("approve");
            setError(null);
          }}
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          {d.approve}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("pause");
            setError(null);
          }}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
        >
          {d.pause}
        </button>
      </div>
      {done ? (
        <p className="mt-2 text-sm text-green-700">{done}</p>
      ) : null}
      {error && !mode ? (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      ) : null}

      {mode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-ink">
              {mode === "approve" ? d.approveTitle : d.pauseTitle}
            </h3>
            <label
              htmlFor="decision-reason"
              className="mb-1 mt-4 block text-sm font-medium text-ink/80"
            >
              {d.reasonLabel}
            </label>
            <textarea
              id="decision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={d.reasonPlaceholder}
              rows={4}
              className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none"
            />
            {error ? (
              <p className="mt-2 text-sm text-red-700">{error}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
              >
                {d.cancel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={submitting}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                {submitting ? d.submitting : d.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shared §32 decision renderer. Used by the offer-detail Decision tab and
 * the /ai/decision page.
 */
export function DecisionView({
  decision,
  offerId,
  showActions = false,
}: {
  decision: OfferDecision;
  offerId: string;
  showActions?: boolean;
}) {
  const t = useDict();
  const d = t.ai.intel.decision;
  const quality = normalizeDataQuality(decision.dataQuality);
  const modeLabel =
    (d.trafficModes as Record<string, string>)[decision.trafficMode] ??
    decision.trafficMode;

  return (
    <div className="rounded-xl border border-ink/10 bg-white/70 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-lg border px-4 py-2 text-xl font-bold ${decisionBadgeClass(decision.decision)}`}
        >
          {d.decisions[decision.decision] ?? decision.decision}
        </span>
        <DataQualityBadge quality={quality} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <p className="text-xs text-ink/55">
            {d.riskScore} <DataQualityBadge quality={quality} />
          </p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">
            {fmtNum(decision.riskScore, 0)}
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <p className="text-xs text-ink/55">
            {d.profitScore} <DataQualityBadge quality={quality} />
          </p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">
            {fmtNum(decision.profitScore, 0)}
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <p className="text-xs text-ink/55">
            {d.policyScore} <DataQualityBadge quality={quality} />
          </p>
          <p className="mt-0.5 text-2xl font-semibold text-ink">
            {fmtNum(decision.policyScore, 0)}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <dt className="text-xs text-ink/55">
            {d.breakEvenCpc} <DataQualityBadge quality={quality} />
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {decision.breakEvenCpc !== null
              ? `$${fmtNum(decision.breakEvenCpc, 4)}`
              : "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <dt className="text-xs text-ink/55">
            {d.recommendedMaxCpc} <DataQualityBadge quality={quality} />
          </dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {decision.recommendedMaxCpc !== null
              ? `$${fmtNum(decision.recommendedMaxCpc, 4)}`
              : "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <dt className="text-xs text-ink/55">{d.trafficMode}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {modeLabel}
            <span className="ml-2 text-sm font-normal text-ink/55">
              ({d.directLink}:{" "}
              {decision.directLink ? d.yes : d.no})
            </span>
          </dd>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3">
          <dt className="text-xs text-ink/55">{d.confidence}</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {decision.confidence !== null
              ? `${fmtNum(decision.confidence * 100, 1)}%`
              : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <h4 className="text-sm font-semibold text-ink">{d.reasonTitle}</h4>
        {decision.reason.length > 0 ? (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink/80">
            {decision.reason.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-ink/50">—</p>
        )}
      </div>

      <div className="mt-5">
        <h4 className="text-sm font-semibold text-ink">
          {d.manualChecksTitle}
        </h4>
        {decision.manualChecks.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
            {decision.manualChecks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/50">—</p>
        )}
      </div>

      {showActions ? (
        <div className="mt-6 border-t border-ink/10 pt-4">
          <ApprovePauseButtons offerId={offerId} />
        </div>
      ) : null}
    </div>
  );
}
