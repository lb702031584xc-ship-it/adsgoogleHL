"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getResearchTestAction, rerunResearchTestAction } from "@/lib/api/research";
import type { ResearchTestDetail } from "@/lib/api/research";
import type { ResearchDict } from "@/i18n/dict/research";
import {
  BandBadge,
  ClassificationBadge,
  ResearchBanner,
  ScoreBar,
  StatusBadge,
  VariantTable,
  type ResearchVariantResult,
} from "./research-views";

const primaryClass =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50";
const secondaryClass =
  "rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5";

const BANDS = ["NORMAL", "MINOR", "SUSPICIOUS", "HIGH_RISK", "STRONG"] as const;
type Band = (typeof BANDS)[number];

function bandOf(test: ResearchTestDetail): Band | null {
  const b = test.finding?.band;
  return typeof b === "string" &&
    (BANDS as readonly string[]).includes(b.toUpperCase())
    ? (b.toUpperCase() as Band)
    : null;
}

function scoreOf(test: ResearchTestDetail): number | null {
  const s = test.finding?.differentialScore;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

/** Map API response rows onto the comparison-table row shape. */
function toVariantRows(test: ResearchTestDetail): ResearchVariantResult[] {
  return test.responses.map((r) => {
    const metaErr =
      typeof r.meta?.error === "string" && r.meta.error.trim()
        ? r.meta.error.trim()
        : null;
    return {
      name: r.variantName,
      status: metaErr ?? "ok",
      httpStatus: r.httpStatus,
      finalUrl: r.finalUrl,
      redirectCount: Array.isArray(r.redirectChain)
        ? r.redirectChain.length
        : null,
      contentHash: r.contentHash,
    };
  });
}

/** Research test detail: /research/[id] */
export function ResearchDetailClient({
  testId,
  dict,
}: {
  testId: string;
  dict: ResearchDict;
}) {
  const [test, setTest] = useState<ResearchTestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const res = await getResearchTestAction(testId);
      if (res.ok) setTest(res.data);
      else setError(res.error);
      setLoading(false);
    })();
  }, [testId]);

  async function onRerun() {
    setRerunning(true);
    setRerunError(null);
    const res = await rerunResearchTestAction(testId);
    setRerunning(false);
    if (res.ok) {
      setTest(res.data);
    } else {
      setRerunError(res.error);
    }
  }

  return (
    <div className="space-y-6">
      <ResearchBanner dict={dict} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/research" className={secondaryClass}>
          {dict.detail.back}
        </Link>
        <button
          className={primaryClass}
          onClick={onRerun}
          disabled={rerunning || loading || !test}
        >
          {rerunning ? dict.detail.rerunning : dict.detail.rerun}
        </button>
      </div>
      {rerunError && <p className="text-sm text-red-700">{rerunError}</p>}

      {loading && <p className="text-sm text-ink/50">…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}

      {test && (
        <>
          <div className="rounded-lg border border-ink/15 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-ink">
                {test.name || test.id.slice(0, 8)}
              </h1>
              <StatusBadge status={test.status} dict={dict} />
              <BandBadge band={bandOf(test)} dict={dict} />
            </div>
            <dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-ink/50">{dict.detail.targetUrl}</dt>
                <dd className="break-all font-mono text-xs text-ink">
                  {test.targetUrl}
                </dd>
              </div>
              <div>
                <dt className="text-ink/50">{dict.detail.variants}</dt>
                <dd className="text-ink">
                  {test.variants.map((v) => v.name).join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink/50">{dict.detail.createdAt}</dt>
                <dd className="text-ink">
                  {test.createdAt
                    ? new Date(test.createdAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-ink/15 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">
                {dict.detail.scoreTitle}
              </h2>
              <ScoreBar
                score={scoreOf(test)}
                band={bandOf(test)}
                dict={dict}
              />
            </div>
            <div className="rounded-lg border border-ink/15 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">
                {dict.detail.classification}
              </h2>
              <ClassificationBadge
                classification={test.finding?.classification ?? null}
                dict={dict}
              />
              <h2 className="mb-2 mt-5 text-sm font-semibold text-ink">
                {dict.detail.aiSummary}
              </h2>
              <p className="text-sm text-ink/80">
                {test.finding?.aiSummary || dict.detail.noSummary}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-ink/15 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">
              {dict.detail.responseTable}
            </h2>
            <VariantTable variants={toVariantRows(test)} dict={dict} />
          </div>
        </>
      )}
    </div>
  );
}
