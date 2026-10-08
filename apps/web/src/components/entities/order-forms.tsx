"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  changeOrderStatusAction,
  createOrderAction,
} from "@/lib/api/entity-actions";
import { useI18n } from "@/i18n/I18nProvider";

const INPUT_CLASS =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const LABEL_CLASS = "mb-1 block text-sm font-medium text-ink/70";

const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "REFUNDED",
  "ARCHIVED",
] as const;

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={LABEL_CLASS}>
        {label}
        {required ? <span className="text-signal"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

export function NewOrderForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [clickId, setClickId] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState<string>("");
  const { t } = useI18n();
  const f = t.entities.forms.order;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createOrderAction({
        orderId: orderId.trim(),
        clickId: clickId.trim(),
        value: value.trim(),
        currency: currency.trim(),
        status: status === "" ? undefined : status,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/orders");
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 space-y-4 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm"
    >
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={f.orderId} required>
          <input
            className={INPUT_CLASS}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            required
            placeholder={f.orderIdPlaceholder}
          />
        </Field>
        <Field label={f.clickId} required>
          <input
            className={INPUT_CLASS}
            value={clickId}
            onChange={(e) => setClickId(e.target.value)}
            required
            placeholder={f.clickIdPlaceholder}
          />
        </Field>
        <Field label={f.value} required>
          <input
            className={INPUT_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            placeholder={f.valuePlaceholder}
          />
        </Field>
        <Field label={f.currency} required>
          <input
            className={INPUT_CLASS}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            required
            placeholder={f.currencyPlaceholder}
          />
        </Field>
        <Field label={f.status}>
          <select
            className={INPUT_CLASS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{f.defaultPending}</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending ? f.submitting : f.createOrder}
      </button>
    </form>
  );
}

export function OrderStatusButtons({
  id,
  currentStatus,
}: {
  id: string;
  currentStatus: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const { t } = useI18n();
  const f = t.entities.forms.order;

  function changeTo(status: string) {
    setMessage(null);
    start(async () => {
      const r = await changeOrderStatusAction(id, status);
      if (r.ok) {
        setMessage({ kind: "ok", text: f.statusChanged(status) });
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
        {ORDER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending || s === currentStatus}
            onClick={() => changeTo(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              s === currentStatus
                ? "border-signal/40 bg-signal/10 text-signal"
                : "border-ink/20 bg-white hover:bg-ink/[0.03]"
            }`}
            title={s === currentStatus ? f.currentStatus : f.changeStatusTo(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
