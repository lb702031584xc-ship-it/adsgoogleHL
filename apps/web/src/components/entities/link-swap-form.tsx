"use client";

/**
 * 功能1 — 网盟自动换链: "换链推送" form for a tracking link detail page.
 * Calls swapTrackingLinkUrlAction (server action) -> POST
 * /api/v1/tracking-links/:id/swap-url.
 */
import { useState, useTransition, type FormEvent } from "react";
import { swapTrackingLinkUrlAction } from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

const inputClassName =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClassName = "mb-1 block text-sm font-medium text-ink/70";

export interface LinkSwapAccount {
  id: string;
  name: string;
  customerId: string;
}

export function LinkSwapPanel({
  trackingLinkId,
  accounts,
}: {
  trackingLinkId: string;
  accounts: LinkSwapAccount[];
}) {
  const [pending, start] = useTransition();
  const [newUrl, setNewUrl] = useState("");
  const [referralUrl, setReferralUrl] = useState("");
  const [deviceTarget, setDeviceTarget] = useState("all");
  const [googleAccountId, setGoogleAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    requestId: string;
    taskType: string;
  } | null>(null);
  const { t } = useI18n();
  const f = t.linkSwap.panel;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !newUrl.trim()) return;
    setError(null);
    setDone(null);
    start(async () => {
      const result = await swapTrackingLinkUrlAction(trackingLinkId, {
        newUrl: newUrl.trim(),
        referralUrl: referralUrl.trim() || undefined,
        deviceTarget,
        googleAccountId: googleAccountId || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const data = result.data as {
        request: { id: string };
        task: { type: string };
      };
      setDone({ requestId: data.request.id, taskType: data.task.type });
      setNewUrl("");
      setReferralUrl("");
      setDeviceTarget("all");
      setGoogleAccountId("");
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 rounded-xl border border-ink/10 bg-white/80 p-5 shadow-sm"
    >
      <h3 className="font-display text-lg font-semibold text-ink">
        {f.title}
      </h3>
      <p className="mt-1 text-sm text-ink/60">{f.description}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="linkswap-new-url" className={labelClassName}>
            {f.newUrl} *
          </label>
          <input
            id="linkswap-new-url"
            className={`${inputClassName} font-mono`}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={f.newUrlPlaceholder}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="linkswap-referral-url" className={labelClassName}>
            {f.referralUrl}
          </label>
          <input
            id="linkswap-referral-url"
            className={`${inputClassName} font-mono`}
            value={referralUrl}
            onChange={(e) => setReferralUrl(e.target.value)}
            placeholder={f.referralUrlPlaceholder}
          />
          <p className="mt-1 text-xs text-ink/50">{f.referralUrlHint}</p>
        </div>
        <div>
          <label htmlFor="linkswap-device" className={labelClassName}>
            {f.deviceTarget}
          </label>
          <select
            id="linkswap-device"
            className={inputClassName}
            value={deviceTarget}
            onChange={(e) => setDeviceTarget(e.target.value)}
          >
            <option value="all">{f.deviceAll}</option>
            <option value="desktop">{f.deviceDesktop}</option>
            <option value="mobile">{f.deviceMobile}</option>
          </select>
        </div>
        <div>
          <label htmlFor="linkswap-account" className={labelClassName}>
            {f.googleAccount}
          </label>
          <select
            id="linkswap-account"
            className={inputClassName}
            value={googleAccountId}
            onChange={(e) => setGoogleAccountId(e.target.value)}
          >
            <option value="">{f.googleAccountAuto}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.customerId})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !newUrl.trim()}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? f.submitting : f.submit}
        </button>
        {done ? (
          <span className="text-sm text-emerald-700">
            {f.success} {f.requestLabel}:{" "}
            <span className="font-mono text-[13px]">{done.requestId}</span> ·{" "}
            {f.taskLabel}: <span className="font-mono">{done.taskType}</span>
          </span>
        ) : null}
        {error ? (
          <span className="text-sm text-rose-700">
            {f.failedPrefix}
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
