"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import {
  cancelUrlChangeAction,
  executeUrlChangeAction,
  queueUrlChangeAction,
  rollbackUrlChangeAction,
  validateUrlChangeAction,
  type EntityActionResult,
} from "@/lib/api/entity-actions";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const labelClass = "mb-1 block text-sm font-medium text-ink/70";
const buttonClass =
  "rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50";

type Op = "validate" | "queue" | "execute" | "cancel";

const OP_ACTIONS: Record<Op, (id: string) => Promise<EntityActionResult>> = {
  validate: validateUrlChangeAction,
  queue: queueUrlChangeAction,
  execute: executeUrlChangeAction,
  cancel: cancelUrlChangeAction,
};

export function RequestLifecycleActions({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [activeOp, setActiveOp] = useState<Op | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [rollbackBy, setRollbackBy] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollbackPending, rollbackStart] = useTransition();

  const OP_LABELS: Record<Op, string> = {
    validate: t.ops.changeRequest.lifecycle.ops.validate,
    queue: t.ops.changeRequest.lifecycle.ops.queue,
    execute: t.ops.changeRequest.lifecycle.ops.execute,
    cancel: t.common.actions.cancel,
  };

  function run(op: Op) {
    setMessage(null);
    setActiveOp(op);
    start(async () => {
      try {
        const result = await OP_ACTIONS[op](id);
        if (result.ok) {
          setMessage({
            ok: true,
            text: t.ops.changeRequest.lifecycle.opSucceeded(OP_LABELS[op]),
          });
          router.refresh();
        } else {
          setMessage({ ok: false, text: result.error });
        }
      } finally {
        setActiveOp(null);
      }
    });
  }

  function onRollback(e: React.FormEvent) {
    e.preventDefault();
    if (!rollbackBy.trim()) return;
    setMessage(null);
    rollbackStart(async () => {
      const result = await rollbackUrlChangeAction(id, {
        requestedBy: rollbackBy.trim(),
        reason: rollbackReason.trim() || undefined,
      });
      if (result.ok) {
        setMessage({
          ok: true,
          text: t.ops.changeRequest.lifecycle.rollbackRequested,
        });
        setRollbackBy("");
        setRollbackReason("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error });
      }
    });
  }

  return (
    <div className="mt-8 space-y-6">
      <section>
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.ops.changeRequest.lifecycle.title}
        </h2>
        <p className="mt-1 text-sm text-ink/60">
          {t.ops.changeRequest.lifecycle.description}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(OP_LABELS) as Op[]).map((op) => (
            <button
              key={op}
              type="button"
              disabled={pending || rollbackPending}
              onClick={() => run(op)}
              className={buttonClass}
            >
              {pending && activeOp === op
                ? t.ops.changeRequest.lifecycle.opPending(OP_LABELS[op])
                : OP_LABELS[op]}
            </button>
          ))}
        </div>
      </section>

      <section className="max-w-2xl rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-ink">
          {t.ops.changeRequest.rollback.title}
        </h2>
        <p className="mt-1 text-sm text-ink/60">
          {t.ops.changeRequest.rollback.description}
        </p>
        <form onSubmit={onRollback} className="mt-4 space-y-4">
          <div>
            <label className={labelClass} htmlFor="rollbackBy">
              {t.ops.labels.requestedByRequired}
            </label>
            <input
              id="rollbackBy"
              className={inputClass}
              value={rollbackBy}
              onChange={(e) => setRollbackBy(e.target.value)}
              placeholder={t.ops.labels.requestedByPlaceholder}
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="rollbackReason">
              {t.ops.labels.reason}
            </label>
            <textarea
              id="rollbackReason"
              className={`${inputClass} min-h-[80px]`}
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              placeholder={t.ops.changeRequest.rollback.reasonPlaceholder}
            />
          </div>
          <button
            type="submit"
            disabled={rollbackPending || pending || !rollbackBy.trim()}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
          >
            {rollbackPending
              ? t.ops.changeRequest.rollback.submitting
              : t.ops.changeRequest.rollback.submit}
          </button>
        </form>
      </section>

      {message ? (
        <p
          className={`text-sm ${message.ok ? "text-emerald-700" : "text-rose-700"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
