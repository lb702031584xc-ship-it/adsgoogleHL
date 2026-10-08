"use client";

/**
 * Sync button for a Google Ads account row.
 * Calls the syncGoogleAccountAction server action and reports the outcome.
 */
import { useState, useTransition } from "react";
import { syncGoogleAccountAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

export function SyncAccountButton({ accountId }: { accountId: string }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.syncAccount;

  function onSync() {
    setNotice(null);
    setError(null);
    start(async () => {
      const result = await syncGoogleAccountAction(accountId);
      if (result.ok) {
        setNotice(f.started);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={onSync}
        className="rounded-lg border border-ink/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? f.syncing : t.common.actions.sync}
      </button>
      {notice ? (
        <span className="text-xs text-emerald-700">{notice}</span>
      ) : null}
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </span>
  );
}
