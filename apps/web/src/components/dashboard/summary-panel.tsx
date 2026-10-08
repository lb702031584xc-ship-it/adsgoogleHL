import type { DashboardSummary } from "@/lib/api/dashboard-types";
import {
  ConnectionHealthBadge,
  ExecutionBadge,
} from "@/components/dashboard/status-badges";
import { TruncateId, formatTimestamp } from "@/components/dashboard/format";
import { useDict } from "@/i18n/use-dict";

export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const t = useDict();
  const cards = [
    { label: t.dashboard.summary.cards.targets, value: summary.targets.total },
    { label: t.dashboard.summary.cards.synced, value: summary.targets.synced },
    {
      label: t.dashboard.summary.cards.outOfSync,
      value: summary.targets.outOfSync,
    },
    {
      label: t.dashboard.summary.cards.neverApplied,
      value: summary.targets.neverApplied,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-ink/10 bg-white/80 p-4 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {card.label}
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink">
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function IntegrationOverview({ summary }: { summary: DashboardSummary }) {
  const t = useDict();
  return (
    <section className="rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
      <h2 className="font-display text-xl font-semibold text-ink">
        {t.dashboard.summary.title}
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.common.misc.name}
          </dt>
          <dd className="mt-1 text-sm text-ink">{summary.integration.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.common.misc.status}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-ink">
            {summary.integration.status}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.integrationId}
          </dt>
          <dd className="mt-1">
            <TruncateId value={summary.integration.integrationId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.currentDesiredVersion}
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {summary.versions.currentDesiredVersion ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.connectionHealth}
          </dt>
          <dd className="mt-1">
            <ConnectionHealthBadge value={summary.health.connection} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.lastExecution}
          </dt>
          <dd className="mt-1">
            <ExecutionBadge value={summary.health.lastExecution} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.appliedTargets}
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {summary.versions.appliedTargets}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.pendingTargets}
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {summary.versions.pendingTargets}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function IntegrationDetailCard({
  name,
  integrationId,
  status,
  googleAccountId,
  configGeneration,
  lastSeenAt,
  createdAt,
}: {
  name: string;
  integrationId: string;
  status: string;
  googleAccountId: string;
  configGeneration: number;
  lastSeenAt: string | null;
  createdAt: string;
}) {
  const t = useDict();
  return (
    <section className="rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm">
      <h2 className="font-display text-xl font-semibold text-ink">
        {t.dashboard.summary.detailTitle}
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.common.misc.name}
          </dt>
          <dd className="mt-1 text-sm text-ink">{name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.fields.integrationId}
          </dt>
          <dd className="mt-1">
            <TruncateId value={integrationId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.common.misc.status}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-ink">{status}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.detailFields.googleAccountId}
          </dt>
          <dd className="mt-1">
            <TruncateId value={googleAccountId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.detailFields.configGeneration}
          </dt>
          <dd className="mt-1 text-sm text-ink">{configGeneration}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.dashboard.summary.detailFields.lastSeen}
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {formatTimestamp(lastSeenAt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t.common.misc.created}
          </dt>
          <dd className="mt-1 text-sm text-ink">
            {formatTimestamp(createdAt)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
