"use client";

import { useState, useTransition } from "react";
import {
  cancelConversionAction,
  executeConversionAction,
  queueConversionAction,
  retryConversionAction,
  type EntityActionResult,
} from "@/lib/api/entity-actions";
import type { Conversion } from "@/lib/api/entities";
import { useI18n } from "@/i18n/I18nProvider";

const BUTTON_CLASS =
  "rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-ink/[0.03] disabled:opacity-50";
const DANGER_BUTTON_CLASS =
  "rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50";

export function ConversionLifecycleButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.conversionLifecycle;

  function run(
    label: string,
    fn: (id: string) => Promise<EntityActionResult<Conversion>>
  ) {
    setMessage(null);
    start(async () => {
      const r = await fn(id);
      if (r.ok) {
        setMessage({ kind: "ok", text: f.succeeded(label) });
      } else {
        setMessage({ kind: "error", text: r.error });
      }
    });
  }

  return (
    <div>
      {message ? (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={BUTTON_CLASS}
          onClick={() => run(f.queueUpload, queueConversionAction)}
        >
          {f.queueUpload}
        </button>
        <button
          type="button"
          disabled={pending}
          className={BUTTON_CLASS}
          onClick={() => run(f.execute, executeConversionAction)}
        >
          {f.execute}
        </button>
        <button
          type="button"
          disabled={pending}
          className={BUTTON_CLASS}
          onClick={() => run(t.common.actions.retry, retryConversionAction)}
        >
          {t.common.actions.retry}
        </button>
        <button
          type="button"
          disabled={pending}
          className={DANGER_BUTTON_CLASS}
          onClick={() => run(t.common.actions.cancel, cancelConversionAction)}
        >
          {t.common.actions.cancel}
        </button>
      </div>
    </div>
  );
}
