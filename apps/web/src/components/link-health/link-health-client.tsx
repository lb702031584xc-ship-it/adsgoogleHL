"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import { useI18n } from "@/i18n/I18nProvider";
import { zh as deadLinkZh, en as deadLinkEn } from "@/i18n/dict/dead-link";
import {
  triggerLinkHealthCheckAction,
  type LinkHealthHistory,
} from "@/lib/api/dead-link-actions";

const PAGE_SIZE = 20;

export function DeadLinkClient({
  initial,
  page,
}: {
  initial: LinkHealthHistory;
  page: number;
}) {
  const router = useRouter();
  let lang: "zh" | "en";
  try {
    lang = useI18n().lang;
  } catch {
    lang = "zh";
  }
  const d = lang === "en" ? deadLinkEn : deadLinkZh;

  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(initial.total / PAGE_SIZE));

  async function onCheckNow() {
    setChecking(true);
    setMsg(null);
    try {
      const res = await triggerLinkHealthCheckAction();
      if (res.ok) {
        const s = res.data;
        setMsg(
          d.page.checkSummary({
            checked: s.checked,
            dead: s.dead,
            paused: s.paused,
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
    router.push(`/link-health${p > 1 ? `?page=${p}` : ""}`);
  }

  return (
    <div className="space-y-6">
      <EntityPageHeader
        title={d.page.title}
        description={d.page.description}
        actions={
          <button
            type="button"
            onClick={onCheckNow}
            disabled={checking}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {checking ? d.page.checking : d.page.checkNow}
          </button>
        }
      />

      {msg && (
        <div className="rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink">
          {msg}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-ink/5 text-ink/60">
            <tr>
              <th className="px-3 py-2">{d.table.link}</th>
              <th className="px-3 py-2">{d.table.status}</th>
              <th className="px-3 py-2">{d.table.statusCode}</th>
              <th className="px-3 py-2">{d.table.finalUrl}</th>
              <th className="px-3 py-2">{d.table.failureReason}</th>
              <th className="px-3 py-2">{d.table.responseTime}</th>
              <th className="px-3 py-2">{d.table.checkedAt}</th>
            </tr>
          </thead>
          <tbody>
            {initial.rows.map((r) => (
              <tr key={r.id} className="border-t border-ink/10">
                <td className="px-3 py-2">
                  <div className="font-medium text-ink">
                    {r.linkName ?? r.linkPublicId ?? r.trackingLinkId}
                  </div>
                  {r.linkPublicId && (
                    <div className="text-xs text-ink/50">{r.linkPublicId}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.isAlive
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {r.isAlive ? d.table.alive : d.table.dead}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {r.statusCode ?? "—"}
                </td>
                <td
                  className="max-w-xs truncate px-3 py-2 text-ink/70"
                  title={r.finalUrl ?? ""}
                >
                  {r.finalUrl ?? "—"}
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {r.failureReason ?? "—"}
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {d.table.responseTimeMs(r.responseTimeMs)}
                </td>
                <td className="px-3 py-2 text-ink/70">
                  {formatDateTime(r.checkedAt)}
                </td>
              </tr>
            ))}
            {initial.rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-ink/50"
                >
                  {d.table.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-ink/70">
        <span>{d.pager.of(page, totalPages)}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page <= 1}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            {d.pager.prev}
          </button>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page >= totalPages}
            className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            {d.pager.next}
          </button>
        </div>
      </div>
    </div>
  );
}
