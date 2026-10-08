"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { createUrlChangeRequestAction } from "@/lib/api/entity-actions";

const ENTITY_TYPES = [
  "CUSTOMER",
  "CAMPAIGN",
  "AD_GROUP",
  "AD",
  "AD_GROUP_CRITERION",
] as const;

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/70";

export function NewRequestForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [entityType, setEntityType] = useState<string>(ENTITY_TYPES[1]);
  const [entityId, setEntityId] = useState("");
  const [toVersionId, setToVersionId] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid =
    entityId.trim() !== "" &&
    toVersionId.trim() !== "" &&
    reason.trim() !== "" &&
    requestedBy.trim() !== "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setError(null);
    start(async () => {
      const result = await createUrlChangeRequestAction({
        entityType,
        entityId: entityId.trim(),
        toVersionId: toVersionId.trim(),
        reason: reason.trim(),
        requestedBy: requestedBy.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/url-versions");
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 max-w-2xl space-y-5 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm"
    >
      <div>
        <label className={labelClass} htmlFor="entityType">
          {t.ops.labels.entityType}
        </label>
        <select
          id="entityType"
          className={inputClass}
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
        >
          {ENTITY_TYPES.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="entityId">
          {t.ops.newChangeRequest.form.entityId}
        </label>
        <input
          id="entityId"
          className={inputClass}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          placeholder={t.ops.newChangeRequest.form.entityIdPlaceholder}
          required
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="toVersionId">
          {t.ops.newChangeRequest.form.toVersionId}
        </label>
        <input
          id="toVersionId"
          className={inputClass}
          value={toVersionId}
          onChange={(e) => setToVersionId(e.target.value)}
          placeholder={t.ops.newChangeRequest.form.toVersionIdPlaceholder}
          required
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="reason">
          {t.ops.labels.reasonRequired}
        </label>
        <textarea
          id="reason"
          className={`${inputClass} min-h-[96px]`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.ops.newChangeRequest.form.reasonPlaceholder}
          required
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="requestedBy">
          {t.ops.labels.requestedByRequired}
        </label>
        <input
          id="requestedBy"
          className={inputClass}
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder={t.ops.labels.requestedByPlaceholder}
          required
        />
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || !valid}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending
            ? t.ops.newChangeRequest.form.submitting
            : t.ops.newChangeRequest.form.submit}
        </button>
        <Link
          href="/url-versions"
          className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
        >
          {t.common.actions.cancel}
        </Link>
      </div>
    </form>
  );
}
