"use client";

import { useState, type ReactNode } from "react";
import type { DashboardTarget } from "@/lib/api/dashboard-types";
import {
  ConnectionHealthBadge,
  ExecutionBadge,
  SyncStateBadge,
} from "@/components/dashboard/status-badges";
import {
  TruncateId,
  TruncateUrl,
  formatTimestamp,
} from "@/components/dashboard/format";
import { EmptyState } from "@/components/dashboard/states";
import { useDict } from "@/i18n/use-dict";

export function TargetsTable({ targets }: { targets: DashboardTarget[] }) {
  const t = useDict();
  const [openId, setOpenId] = useState<string | null>(null);

  if (targets.length === 0) {
    return <EmptyState message={t.dashboard.targetsTable.empty} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/80 shadow-sm">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{t.dashboard.targetsTable.caption}</caption>
        <thead className="border-b border-ink/10 bg-mist/60 text-xs uppercase tracking-wide text-ink/55">
          <tr>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.adId}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.campaign}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.adGroup}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.desired}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.applied}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.state}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.health}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.lastExec}</th>
            <th className="px-3 py-3 font-semibold">{t.dashboard.targetsTable.columns.details}</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => {
            const open = openId === target.targetId;
            return (
              <TargetRows
                key={target.targetId}
                target={target}
                open={open}
                onToggle={() =>
                  setOpenId(open ? null : target.targetId)
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TargetRows({
  target,
  open,
  onToggle,
}: {
  target: DashboardTarget;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useDict();
  return (
    <>
      <tr className="border-b border-ink/5 align-top">
        <td className="px-3 py-3">
          <TruncateId value={target.googleAdId} />
        </td>
        <td className="px-3 py-3">
          <TruncateId value={target.campaignId} />
        </td>
        <td className="px-3 py-3">
          <TruncateId value={target.adGroupId} />
        </td>
        <td className="px-3 py-3">{target.desiredVersion ?? "—"}</td>
        <td className="px-3 py-3">{target.appliedVersion ?? "—"}</td>
        <td className="px-3 py-3">
          <SyncStateBadge value={target.syncState} />
        </td>
        <td className="px-3 py-3">
          <ConnectionHealthBadge value={target.connectionHealth} />
        </td>
        <td className="px-3 py-3">
          <ExecutionBadge value={target.lastExecution} />
        </td>
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-ink/15 px-2 py-1 text-xs font-semibold text-ink hover:bg-mist focus:outline-none focus:ring-2 focus:ring-signal"
            aria-expanded={open}
          >
            {open ? t.dashboard.targetsTable.hide : t.common.actions.view}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-ink/10 bg-mist/40">
          <td colSpan={9} className="px-4 py-4">
            <TargetDetails target={target} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function TargetDetails({ target }: { target: DashboardTarget }) {
  const t = useDict();
  const noActive =
    target.desiredVersion === null && target.desired.finalUrl === null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Detail label={t.dashboard.targetsTable.details.targetId} value={<TruncateId value={target.targetId} />} />
        <Detail label={t.dashboard.targetsTable.details.entityType} value={target.entityType} />
        <Detail
          label={t.dashboard.targetsTable.details.googleAdId}
          value={<TruncateId value={target.googleAdId} />}
        />
        <Detail
          label={t.dashboard.targetsTable.details.campaignId}
          value={<TruncateId value={target.campaignId} />}
        />
        <Detail
          label={t.dashboard.targetsTable.details.adGroupId}
          value={<TruncateId value={target.adGroupId} />}
        />
        <Detail label={t.dashboard.targetsTable.details.desiredVersion} value={target.desiredVersion ?? "—"} />
        <Detail label={t.dashboard.targetsTable.details.appliedVersion} value={target.appliedVersion ?? "—"} />
        <Detail
          label={t.dashboard.targetsTable.details.lastApplied}
          value={formatTimestamp(target.lastAppliedAt)}
        />
        <Detail
          label={t.dashboard.targetsTable.details.lastAttempt}
          value={formatTimestamp(target.lastAttemptAt)}
        />
      </dl>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          {t.dashboard.targetsTable.details.desiredUrl}
        </p>
        {noActive ? (
          <p className="mt-2 text-sm text-ink/60">{t.dashboard.targetsTable.details.noActiveUrl}</p>
        ) : (
          <dl className="mt-2 space-y-2">
            <Detail
              label={t.dashboard.targetsTable.details.finalUrl}
              value={<TruncateUrl value={target.desired.finalUrl} />}
            />
            <Detail
              label={t.dashboard.targetsTable.details.finalMobileUrl}
              value={<TruncateUrl value={target.desired.finalMobileUrl} />}
            />
            <Detail
              label={t.dashboard.targetsTable.details.finalAppUrl}
              value={<TruncateUrl value={target.desired.finalAppUrl} />}
            />
            <Detail
              label={t.dashboard.targetsTable.details.trackingTemplate}
              value={<TruncateUrl value={target.desired.trackingTemplate} />}
            />
            <Detail
              label={t.dashboard.targetsTable.details.customParameters}
              value={
                <pre className="overflow-x-auto rounded bg-white/80 p-2 text-xs text-ink/75">
                  {JSON.stringify(target.desired.customParameters ?? {}, null, 2)}
                </pre>
              }
            />
          </dl>
        )}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink/45">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}
