"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import {
  zh as redirectCheckZh,
  en as redirectCheckEn,
} from "@/i18n/dict/cashback-redirect-check";
import {
  triggerRedirectCheckAllAction,
  type RedirectCheckHistory,
  type RedirectCheckHistoryRow,
} from "@/lib/api/cashback-redirect-check-actions";

const PAGE_SIZE = 20;

const statusDot: Record<string, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

function issueLabel(d: typeof redirectCheckZh, issue: string): string {
  const labels = d.issues as Record<string, string>;
  return labels[issue] ?? issue;
}

function statusLabel(d: typeof redirectCheckZh, status: string): string {
  const labels = d.status as Record<string, string>;
  return labels[status] ?? status;
}

/** Feature 4 — 跳转链检测：history table with expandable hop details. */
export function RedirectCheckClient({
  initial,
  page,
}: {
  initial: RedirectCheckHistory;
  page: number;
}) {
  const router = useRouter();
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d = lang === "en" ? redirectCheckEn : redirectCheckZh;

  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(initial.total / PAGE_SIZE));

  async function onCheckAll() {
    setChecking(true);
    setMsg(null);
    try {
      const res = await triggerRedirectCheckAllAction();
      if (res.ok) {
        const s = res.data;
        setMsg(
          d.page.checkSummary({
            checked: s.checked,
            clean: s.clean,
            warning: s.warning,
            error: s.error,
          })
        );
        router.refresh();
      } else {
        setMsg(`${d.page.checkFailedPrefix}${res.error}`);
      }
    } finally {
      setChecking(false);
    }
  }

  function goTo(p: number) {
    router.push(`/cashback/redirect-check${p > 1 ? `?page=${p}` : ""}`);
  }

  function toggle(row: RedirectCheckHistoryRow) {
    setExpanded((cur) => (cur === row.id ? null : row.id));
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.page.title}
        description={d.page.description}
        actions={
          <button
            type="button"
            onClick={onCheckAll}
            disabled={checking}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {checking ? d.page.checking : d.page.checkAll}
          </button>
        }
      />

      {msg && (
        <div className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink">
          {msg}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 bg-ink/[0.03] text-left text-xs uppercase tracking-wide text-ink/60">
              <th className="px-4 py-3">{d.table.link}</th>
              <th className="px-4 py-3">{d.table.status}</th>
              <th className="px-4 py-3">{d.table.hopCount}</th>
              <th className="px-4 py-3">{d.table.issues}</th>
              <th className="px-4 py-3">{d.table.finalUrl}</th>
              <th className="px-4 py-3">{d.table.checkedAt}</th>
            </tr>
          </thead>
          <tbody>
            {initial.rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-ink/50"
                >
                  {d.table.empty}
                </td>
              </tr>
            )}
            {initial.rows.map((row) => {
              const isOpen = expanded === row.id;
              const finalUrl = row.hops[row.hops.length - 1]?.url ?? null;
              return (
                <FragmentRow
                  key={row.id}
                  row={row}
                  d={d}
                  isOpen={isOpen}
                  finalUrl={finalUrl}
                  onToggle={() => toggle(row)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page <= 1}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-ink hover:border-ink/40 disabled:opacity-50"
          >
            {d.pager.prev}
          </button>
          <span className="text-ink/60">{d.pager.of(page, totalPages)}</span>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page >= totalPages}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-ink hover:border-ink/40 disabled:opacity-50"
          >
            {d.pager.next}
          </button>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  row,
  d,
  isOpen,
  finalUrl,
  onToggle,
}: {
  row: RedirectCheckHistoryRow;
  d: typeof redirectCheckZh;
  isOpen: boolean;
  finalUrl: string | null;
  onToggle: () => void;
}) {
  return (
    <Fragment>
      <tr
        className="cursor-pointer border-b border-ink/5 hover:bg-ink/[0.02]"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="font-medium text-ink">
            {row.linkName ?? row.linkPublicId ?? "—"}
          </div>
          {row.linkPublicId && (
            <div className="text-xs text-ink/50">{row.linkPublicId}</div>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${statusDot[row.status] ?? "bg-ink/30"}`}
            />
            {statusLabel(d, row.status)}
          </span>
        </td>
        <td className="px-4 py-3 text-ink">{row.hopCount}</td>
        <td className="px-4 py-3">
          {row.issues.length === 0 ? (
            <span className="text-ink/40">{d.table.noIssues}</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.issues.map((issue) => (
                <span
                  key={issue}
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                >
                  {issueLabel(d, issue)}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="max-w-xs truncate px-4 py-3 text-xs text-ink/60">
          {finalUrl ?? "—"}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink/60">
          {formatDateTime(row.checkedAt)}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-ink/5 bg-ink/[0.02]">
          <td colSpan={6} className="px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-wide text-ink/50">
              {d.table.hops}
            </div>
            <ol className="mt-2 space-y-2">
              {row.hops.map((hop, i) => (
                <li
                  key={`${row.id}-hop-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-ink/10 bg-white px-3 py-2"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[11px] font-medium text-ink/70">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-ink">
                      {hop.url}
                    </div>
                    <div className="mt-0.5 text-xs text-ink/50">
                      {d.table.hopDomain}: {hop.domain}
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-ink/[0.06] px-2 py-0.5 font-mono text-xs text-ink/70">
                    {hop.statusCode != null
                      ? hop.statusCode
                      : d.table.noResponse}
                  </span>
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
