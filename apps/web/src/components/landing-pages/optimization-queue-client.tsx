"use client";

/**
 * 落地页优化队列 — 任务卡片列表 + 状态筛选 + 操作按钮。
 * 数据经 server actions 获取（session 转发），不直接调 API。
 */
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { zh, en } from "@/i18n/dict/lp-optimization";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { RewriteModal } from "@/components/landing-pages/rewrite-modal";
import {
  archiveLpOptimizationTaskAction,
  listLpOptimizationTasksAction,
  updateLpOptimizationTaskStatusAction,
  type LpOptimizationTask,
} from "@/lib/api/lp-optimization-actions";

function useDict() {
  let lang: "zh" | "en" = "zh";
  try {
    lang = useI18n().lang;
  } catch {
    /* rendered outside provider (tests) → zh fallback */
  }
  return lang === "zh" ? zh : en;
}

type StatusFilter = "all" | "PENDING" | "IN_PROGRESS" | "DONE";

const scoreBadgeClass = (score: number) =>
  score < 40
    ? "bg-rose-100 text-rose-800 ring-rose-200"
    : score < 60
      ? "bg-amber-100 text-amber-800 ring-amber-200"
      : "bg-emerald-100 text-emerald-800 ring-emerald-200";

const priorityBadgeClass: Record<string, string> = {
  HIGH: "bg-rose-600 text-white",
  MEDIUM: "bg-amber-500 text-white",
  LOW: "bg-slate-200 text-slate-700",
};

const statusBadgeClass: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-700 ring-slate-200",
  IN_PROGRESS: "bg-sky-100 text-sky-800 ring-sky-200",
  DONE: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};

const severityDot: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-slate-300",
};

const btnGhost =
  "rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink hover:border-ink/40 disabled:opacity-50";
const btnPrimary =
  "rounded-lg bg-signal px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnDanger =
  "rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-rose-700 hover:border-rose-400 disabled:opacity-50";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function TaskCard({
  task,
  onChanged,
  onError,
}: {
  task: LpOptimizationTask;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const d = useDict();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const issues = task.issues ?? [];
  const visibleIssues = expanded ? issues : issues.slice(0, 3);
  const dimensionName =
    d.dimensions[task.worstDimension as keyof typeof d.dimensions] ??
    task.worstDimension;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    try {
      const res = await action();
      if (res.ok) onChanged();
      else onError(res.error ?? d.errorAction);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${priorityBadgeClass[task.priority] ?? "bg-slate-200 text-slate-700"}`}
            >
              {d.priority[task.priority]}
            </span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusBadgeClass[task.status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}
            >
              {d.status[task.status]}
            </span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${scoreBadgeClass(task.score)}`}
              title={d.scoreLabel}
            >
              {task.score}
            </span>
          </div>
          <h3 className="mt-2 truncate text-base font-semibold text-ink">
            {task.landingPage ? (
              <a
                href={task.landingPage.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="hover:text-signal hover:underline"
                title={task.landingPage.url || task.landingPage.name}
              >
                {task.landingPage.name}
              </a>
            ) : (
              <span className="text-ink/50">{d.unknownPage}</span>
            )}
          </h3>
          {task.landingPage?.url ? (
            <a
              href={task.landingPage.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-xs text-signal hover:underline"
              title={task.landingPage.url}
            >
              {task.landingPage.url}
            </a>
          ) : null}
        </div>
        <div className="text-right text-xs text-ink/50">
          <div>
            {d.worstDimensionLabel}:{" "}
            <span className="font-semibold text-rose-700">{dimensionName}</span>
          </div>
          <div className="mt-1">
            {d.createdAtLabel}: {formatDateTime(task.createdAt)}
          </div>
          {task.completedAt ? (
            <div className="mt-1">
              {d.completedAtLabel}: {formatDateTime(task.completedAt)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 border-t border-ink/10 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          {d.issuesTitle} · {issues.length} {d.issuesCount}
        </p>
        <ul className="mt-2 space-y-1.5">
          {visibleIssues.map((issue, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-ink/80">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot[issue.severity ?? ""] ?? "bg-slate-300"}`}
              />
              <span>{issue.message ?? "—"}</span>
            </li>
          ))}
          {issues.length === 0 ? (
            <li className="text-sm text-ink/40">—</li>
          ) : null}
        </ul>
        {issues.length > 3 ? (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-signal hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? d.collapseIssues
              : `${d.showAllIssues} (${issues.length})`}
          </button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {task.status === "PENDING" ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() =>
              run(() =>
                updateLpOptimizationTaskStatusAction(task.id, "IN_PROGRESS")
              )
            }
          >
            {busy ? d.actions.busy : d.actions.start}
          </button>
        ) : null}
        {task.status === "IN_PROGRESS" ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() =>
              run(() => updateLpOptimizationTaskStatusAction(task.id, "DONE"))
            }
          >
            {busy ? d.actions.busy : d.actions.complete}
          </button>
        ) : null}
        <button
          type="button"
          className={btnGhost}
          disabled={busy}
          onClick={() => setRewriteOpen(true)}
        >
          {d.actions.rewrite}
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={busy}
          onClick={() => {
            if (window.confirm(d.actions.confirmArchive)) {
              void run(() => archiveLpOptimizationTaskAction(task.id));
            }
          }}
        >
          {d.actions.archive}
        </button>
      </div>

      {rewriteOpen ? (
        <RewriteModal
          task={task}
          onClose={() => setRewriteOpen(false)}
          onApplied={() => {
            setRewriteOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

export function OptimizationQueueClient() {
  const d = useDict();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [tasks, setTasks] = useState<LpOptimizationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusParam = useMemo(
    () => (filter === "all" ? "" : filter),
    [filter]
  );

  async function refresh() {
    setError(null);
    const res = await listLpOptimizationTasksAction(statusParam);
    if (res.ok) {
      setTasks(res.data.items);
    } else {
      setError(`${d.errorLoading}：${res.error}`);
    }
  }

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const filters: StatusFilter[] = ["all", "PENDING", "IN_PROGRESS", "DONE"];
  const filterLabel = (f: StatusFilter) =>
    f === "all" ? d.statusFilter.all : d.statusFilter[f];

  return (
    <div className="space-y-6">
      <EntityPageHeader title={d.title} description={d.description} />

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            className={
              filter === f
                ? "rounded-lg bg-ink px-4 py-1.5 text-sm font-semibold text-white"
                : btnGhost
            }
            onClick={() => setFilter(f)}
          >
            {filterLabel(f)}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title={d.errorLoading} message={error} />
      ) : loading ? (
        <p className="text-sm text-ink/50">{d.loading}</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white p-10 text-center text-sm text-ink/50">
          {d.empty}
        </div>
      ) : (
        <div className="grid gap-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onChanged={() => void refresh()}
                onError={(msg) => setError(`${d.errorAction}：${msg}`)}
              />
            ))}
          </div>
      )}
    </div>
  );
}
