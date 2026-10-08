"use client";

/**
 * AI 改写弹窗：调用 server action 生成改写版本，展示「改写前 → 改写后」
 * 对照表 + 预估新分，用户确认后应用（应用前 API 会自动备份原内容）。
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { zh, en } from "@/i18n/dict/lp-optimization";
import {
  applyLpRewriteAction,
  createLpRewriteAction,
  type LpRewriteItem,
  type LpRewritePair,
} from "@/lib/api/lp-rewrite-actions";
import type { LpOptimizationTask } from "@/lib/api/lp-optimization-actions";

function useDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? zh : en;
}

const btnPrimary =
  "rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";

function RewriteRow({
  pair,
  beforeLabel,
  afterLabel,
  reasonLabel,
}: {
  pair: LpRewritePair;
  beforeLabel: string;
  afterLabel: string;
  reasonLabel: string;
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-ink px-2 py-0.5 font-semibold text-white">
          {pair.element}
        </span>
        <span className="text-ink/50">{pair.location}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md bg-rose-50 p-3 ring-1 ring-inset ring-rose-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
            {beforeLabel}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink/80 line-through decoration-rose-300">
            {pair.before}
          </p>
        </div>
        <div className="rounded-md bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {afterLabel}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
            {pair.after}
          </p>
        </div>
      </div>
      {pair.reason ? (
        <p className="mt-2 text-xs text-ink/50">
          <span className="font-semibold">{reasonLabel}：</span>
          {pair.reason}
        </p>
      ) : null}
    </div>
  );
}

export function RewriteModal({
  task,
  onClose,
  onApplied,
}: {
  task: LpOptimizationTask;
  onClose: () => void;
  onApplied: () => void;
}) {
  const d = useDict().rewrite;
  const [phase, setPhase] = useState<"generating" | "ready" | "error">(
    "generating"
  );
  const [rewrite, setRewrite] = useState<LpRewriteItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("generating");
    setError(null);
    setRewrite(null);
    void createLpRewriteAction(task.landingPageId, task.issues ?? []).then(
      (res) => {
        if (cancelled) return;
        if (res.ok) {
          setRewrite(res.data.rewrite);
          setPhase("ready");
        } else {
          setError(res.error);
          setPhase("error");
        }
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function handleApply() {
    if (!rewrite || applying) return;
    setApplying(true);
    setApplyError(null);
    const res = await applyLpRewriteAction(rewrite.id);
    if (res.ok) {
      onApplied();
      onClose();
    } else {
      setApplyError(res.error);
      setApplying(false);
    }
  }

  const rewrites = rewrite?.rewrittenContent?.rewrites ?? [];
  const skipped = rewrite?.rewrittenContent?.skipped ?? [];
  const appliedCount = rewrite?.rewrittenContent?.appliedCount ?? rewrites.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-slate-50 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{d.modalTitle}</h2>
          <button
            type="button"
            className={btnGhost}
            onClick={onClose}
            disabled={applying}
          >
            {d.close}
          </button>
        </div>

        {phase === "generating" ? (
          <p className="py-10 text-center text-sm text-ink/50">{d.generating}</p>
        ) : phase === "error" ? (
          <div className="py-10 text-center">
            <p className="text-sm text-rose-700">
              {d.errorGenerate}：{error}
            </p>
            <button
              type="button"
              className={`${btnGhost} mt-4`}
              onClick={onClose}
            >
              {d.close}
            </button>
          </div>
        ) : rewrite ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white p-4">
              <span className="text-sm text-ink/60">
                {d.originalScore}：
                <strong className="text-ink">{rewrite.originalScore}</strong>
              </span>
              <span className="text-ink/30">→</span>
              <span className="text-sm text-ink/60">
                {d.estimatedScore}：
                <strong className="text-emerald-700">
                  {rewrite.newScore ?? "—"}
                </strong>
              </span>
              <span className="ml-auto text-xs text-ink/50">
                {appliedCount} {d.appliedCount}
                {skipped.length > 0
                  ? ` · ${skipped.length} ${d.skippedCount}`
                  : ""}
              </span>
            </div>

            {rewrites.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink/50">
                {d.noRewrites}
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {rewrites.map((pair, idx) => (
                  <RewriteRow
                    key={idx}
                    pair={pair}
                    beforeLabel={d.before}
                    afterLabel={d.after}
                    reasonLabel={d.reason}
                  />
                ))}
              </div>
            )}

            {applyError ? (
              <p className="mt-3 text-sm text-rose-700">
                {d.errorApply}：{applyError}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-ink/50">{d.backupNote}</p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btnGhost}
                onClick={onClose}
                disabled={applying}
              >
                {d.cancel}
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={handleApply}
                disabled={applying || rewrites.length === 0}
              >
                {applying ? d.applying : d.confirmApply}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
