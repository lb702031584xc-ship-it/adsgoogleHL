"use client";

import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { formatDateTime } from "@/lib/api/entities-config";
import {
  getOfferPolicyAction,
  scanOfferPolicyAction,
} from "@/lib/api/offer-intel-actions";
import type {
  OfferPolicyResponse,
  PolicyVerdict,
} from "@/lib/api/offer-intel";
import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";

const VERDICT_STYLES: Record<PolicyVerdict, string> = {
  ALLOWED: "bg-green-100 text-green-800",
  FORBIDDEN: "bg-red-100 text-red-800",
  REQUIRED: "bg-blue-100 text-blue-800",
  UNKNOWN: "bg-ink/10 text-ink/60",
};

/** Policy tab: rule verdicts + per-rule evidence (§27 Policy Evidence). */
export function PolicyTab({ offerId }: { offerId: string }) {
  const t = useDict();
  const d = t.ai.intel.policy;
  const [data, setData] = useState<OfferPolicyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getOfferPolicyAction(offerId);
      if (res.ok) setData(res.data);
      else setError(res.error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [offerId]);

  async function onRescan() {
    setScanning(true);
    setScanMsg(null);
    setError(null);
    try {
      const res = await scanOfferPolicyAction(offerId);
      if (res.ok) {
        setScanMsg(d.rulesFound(res.data.rulesFound));
        await load();
      } else {
        setError(res.error);
      }
    } finally {
      setScanning(false);
    }
  }

  const policy = data?.policy ?? null;
  const rules = policy ? Object.entries(policy.rules) : [];
  const quality = normalizeDataQuality(policy?.dataQuality);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">{d.rulesTitle}</h3>
        <button
          type="button"
          onClick={onRescan}
          disabled={scanning}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
        >
          {scanning ? d.scanning : d.rescan}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {scanMsg ? (
        <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {scanMsg}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-ink/55">{d.scanning}</p>
      ) : !policy ? (
        <p className="mt-4 text-sm text-ink/55">{d.noPolicy}</p>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink/55">
            <DataQualityBadge quality={quality} />
            {policy.sourceUrl ? (
              <a
                href={policy.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-signal hover:underline"
              >
                {policy.sourceUrl}
              </a>
            ) : null}
            {policy.retrievedAt ? (
              <span>{d.retrievedAt(formatDateTime(policy.retrievedAt))}</span>
            ) : null}
          </div>

          {rules.length === 0 ? (
            <p className="mt-4 text-sm text-ink/55">{d.noRules}</p>
          ) : (
            <div className="mt-4 space-y-3">
              {rules.map(([rule, verdict]) => {
                const evidence = (data?.evidence ?? []).filter(
                  (e) => e.rule === rule
                );
                const style =
                  VERDICT_STYLES[verdict as PolicyVerdict] ??
                  VERDICT_STYLES.UNKNOWN;
                return (
                  <div
                    key={rule}
                    className="rounded-xl border border-ink/10 bg-white/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-sm font-semibold text-ink">
                        {rule}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
                      >
                        {(d.verdicts as Record<string, string>)[verdict] ??
                          verdict}
                      </span>
                    </div>
                    {evidence.length === 0 ? (
                      <p className="mt-2 text-xs text-ink/50">
                        {d.noEvidence}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-ink/60">
                          {d.evidenceTitle}
                        </p>
                        {evidence.map((e) => (
                          <div
                            key={e.id}
                            className="rounded-lg bg-ink/5 px-3 py-2"
                          >
                            <p className="text-sm text-ink/85">
                              {e.matchedText}
                            </p>
                            {e.sourceExcerpt ? (
                              <p className="mt-1 text-xs italic text-ink/55">
                                “{e.sourceExcerpt}”
                              </p>
                            ) : null}
                            <p className="mt-1 text-xs text-ink/50">
                              {d.confidence}:{" "}
                              {e.confidence !== null
                                ? `${Math.round(e.confidence * 100)}%`
                                : "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
