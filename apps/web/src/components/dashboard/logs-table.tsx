"use client";

import type { DashboardSyncLog } from "@/lib/api/dashboard-types";
import { ExecutionBadge } from "@/components/dashboard/status-badges";
import { TruncateId, formatTimestamp } from "@/components/dashboard/format";
import { EmptyState } from "@/components/dashboard/states";
import { useDict } from "@/i18n/use-dict";

export function LogsTable({
  logs,
  emptyMessage,
}: {
  logs: DashboardSyncLog[];
  emptyMessage?: string;
}) {
  const t = useDict();
  if (logs.length === 0) {
    return <EmptyState message={emptyMessage ?? t.dashboard.logsTable.empty} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/80 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{t.dashboard.logsTable.caption}</caption>
        <thead className="border-b border-ink/10 bg-mist/60 text-xs uppercase tracking-wide text-ink/55">
          <tr>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.logId}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.target}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.desired}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.reported}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.status}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.conflict}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.execution}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.beforeAfter}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.message}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.logsTable.columns.created}</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.logId} className="border-b border-ink/5 align-top">
              <td className="px-3 py-3">
                <TruncateId value={log.logId} />
              </td>
              <td className="px-3 py-3">
                <TruncateId value={log.targetId} />
              </td>
              <td className="px-3 py-3">{log.desiredVersion}</td>
              <td className="px-3 py-3">{log.reportedVersion ?? "—"}</td>
              <td className="px-3 py-3">
                <ExecutionBadge value={log.status} />
              </td>
              <td className="px-3 py-3 text-xs text-ink/70">
                {log.conflictCode ?? "—"}
              </td>
              <td className="px-3 py-3">
                <TruncateId value={log.executionId} />
              </td>
              <td className="px-3 py-3 text-xs text-ink/70">
                {log.appliedVersionBefore ?? "—"} →{" "}
                {log.appliedVersionAfter ?? "—"}
              </td>
              <td className="max-w-[12rem] px-3 py-3">
                <span className="line-clamp-2 text-xs text-ink/70" title={log.message ?? undefined}>
                  {log.message ?? "—"}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-xs text-ink/65">
                {formatTimestamp(log.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LogsPagination({
  page,
  hasNext,
  total,
  pageSize,
  onPrevious,
  onNext,
  disabled,
}: {
  page: number;
  hasNext: boolean;
  total: number;
  pageSize: number;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}) {
  const t = useDict();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink/70">
      <p>{t.dashboard.logsTable.pageInfo(page, pageSize, total)}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled || page <= 1}
          className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink enabled:hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-signal"
        >
          {t.common.pagination.previous}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={disabled || !hasNext}
          className="rounded-md border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink enabled:hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-signal"
        >
          {t.common.pagination.next}
        </button>
      </div>
    </div>
  );
}
