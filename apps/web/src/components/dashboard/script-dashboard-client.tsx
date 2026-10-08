"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  loadDashboardLogs,
  loadDashboardSummary,
  loadDashboardTargets,
  loadIntegrationDetail,
} from "@/lib/api/dashboard-actions";
import type {
  DashboardIntegrationDetail,
  DashboardSummary,
  DashboardSyncLog,
  DashboardTarget,
} from "@/lib/api/dashboard-types";
import {
  IntegrationDetailCard,
  IntegrationOverview,
  SummaryCards,
} from "@/components/dashboard/summary-panel";
import { TargetsTable } from "@/components/dashboard/targets-table";
import { LogsPagination, LogsTable } from "@/components/dashboard/logs-table";
import {
  DashboardSkeleton,
  EmptyState,
  ErrorState,
} from "@/components/dashboard/states";
import { useDict } from "@/i18n/use-dict";

const LOG_PAGE_SIZE = 20;

export function ScriptDashboardClient({
  initialSummary,
  initialDetail,
  initialTargets,
  initialLogs,
  initialError,
}: {
  initialSummary: DashboardSummary | null;
  initialDetail: DashboardIntegrationDetail | null;
  initialTargets: DashboardTarget[];
  initialLogs: {
    items: DashboardSyncLog[];
    page: number;
    pageSize: number;
    total: number;
    hasNext: boolean;
  } | null;
  initialError: string | null;
}) {
  const t = useDict();
  const [summary, setSummary] = useState(initialSummary);
  const [detail, setDetail] = useState(initialDetail);
  const [targets, setTargets] = useState(initialTargets);
  const [logs, setLogs] = useState(initialLogs);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
  const [logsLoading, setLogsLoading] = useState(false);

  const integrationId =
    summary?.integration.integrationId ??
    detail?.integration.integrationId ??
    null;

  const refreshAll = useCallback(() => {
    startTransition(async () => {
      const summaryRes = await loadDashboardSummary();
      if (!summaryRes.ok) {
        setError(summaryRes.error);
        return;
      }
      setSummary(summaryRes.data);
      setError(null);
      const id = summaryRes.data.integration.integrationId;

      const [detailRes, targetsRes, logsRes] = await Promise.all([
        loadIntegrationDetail(id),
        loadDashboardTargets(id),
        loadDashboardLogs(id, 1, LOG_PAGE_SIZE),
      ]);

      if (detailRes.ok) setDetail(detailRes.data);
      if (targetsRes.ok) setTargets(targetsRes.data.items);
      if (logsRes.ok) setLogs(logsRes.data);
    });
  }, []);

  const goLogsPage = useCallback(
    (nextPage: number) => {
      if (!integrationId) return;
      setLogsLoading(true);
      startTransition(async () => {
        const res = await loadDashboardLogs(
          integrationId,
          nextPage,
          LOG_PAGE_SIZE
        );
        if (res.ok) {
          setLogs(res.data);
          setError(null);
        } else {
          setError(res.error);
        }
        setLogsLoading(false);
      });
    },
    [integrationId]
  );

  useEffect(() => {
    // No auto-refresh / polling by design (Phase 8.4.7.2).
  }, []);

  if (error && !summary) {
    return (
      <div className="space-y-4">
        <Header onRefresh={refreshAll} pending={pending} />
        <ErrorState message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Header onRefresh={refreshAll} pending={pending} />
      {error ? <ErrorState message={error} /> : null}

      {pending && !summary ? (
        <DashboardSkeleton label={t.dashboard.states.loadingSummary} />
      ) : summary ? (
        <>
          <IntegrationOverview summary={summary} />
          <SummaryCards summary={summary} />
        </>
      ) : (
        <EmptyState message={t.dashboard.states.noRecentActivity} />
      )}

      {detail ? (
        <IntegrationDetailCard
          name={detail.integration.name}
          integrationId={detail.integration.integrationId}
          status={detail.integration.status}
          googleAccountId={detail.integration.googleAccountId}
          configGeneration={detail.integration.configGeneration}
          lastSeenAt={detail.integration.lastSeenAt}
          createdAt={detail.integration.createdAt}
        />
      ) : pending ? (
        <DashboardSkeleton label={t.dashboard.states.loadingDetails} />
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.dashboard.targetsTable.title}
        </h2>
        {pending && targets.length === 0 ? (
          <DashboardSkeleton label={t.dashboard.states.loadingTargets} />
        ) : (
          <TargetsTable targets={targets} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.dashboard.logsTable.titleRecent}
        </h2>
        {summary && summary.recentLogs.length > 0 ? (
          <LogsTable
            logs={summary.recentLogs}
            emptyMessage={t.dashboard.states.noRecentActivity}
          />
        ) : (
          <EmptyState message={t.dashboard.states.noRecentActivity} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.dashboard.logsTable.titleAll}
        </h2>
        {logsLoading || (pending && !logs) ? (
          <DashboardSkeleton label={t.dashboard.states.loadingLogs} />
        ) : logs ? (
          <>
            <LogsTable logs={logs.items} />
            <LogsPagination
              page={logs.page}
              pageSize={logs.pageSize}
              total={logs.total}
              hasNext={logs.hasNext}
              disabled={pending || logsLoading}
              onPrevious={() => goLogsPage(Math.max(1, logs.page - 1))}
              onNext={() => goLogsPage(logs.page + 1)}
            />
          </>
        ) : (
          <EmptyState message={t.dashboard.states.noSyncLogs} />
        )}
      </section>
    </div>
  );
}

function Header({
  onRefresh,
  pending,
}: {
  onRefresh: () => void;
  pending: boolean;
}) {
  const t = useDict();
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-signal">
          AdLinkLab
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
          {t.common.nav.dashboard}
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-ink/70">
          {t.dashboard.page.description}
        </p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={pending}
        className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-mist hover:bg-ink/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-signal focus:ring-offset-2"
      >
        {pending ? t.dashboard.page.refreshing : t.common.actions.refresh}
      </button>
    </div>
  );
}
