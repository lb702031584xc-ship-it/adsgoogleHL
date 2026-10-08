"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  createConversionAction,
  createConversionFromOrderAction,
} from "@/lib/api/entity-actions";
import { SectionTitle } from "@/components/entities/ui";
import { useI18n } from "@/i18n/I18nProvider";

const INPUT_CLASS =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:border-signal focus:outline-none";
const LABEL_CLASS = "mb-1 block text-sm font-medium text-ink/70";

function toIsoOrUndefined(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function opt(value: string): string | undefined {
  const v = value.trim();
  return v === "" ? undefined : v;
}

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

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </p>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink/85 disabled:opacity-50"
    >
      {pending ? t.entities.forms.conversion.submitting : children}
    </button>
  );
}

function CreateFromClickForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clickId, setClickId] = useState("");
  const [conversionAction, setConversionAction] = useState("");
  const [conversionTime, setConversionTime] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("");
  const [orderUuid, setOrderUuid] = useState("");
  const { t } = useI18n();
  const f = t.entities.forms.conversion;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createConversionAction({
        clickId: clickId.trim(),
        conversionAction: conversionAction.trim(),
        conversionTime: toIsoOrUndefined(conversionTime),
        value: opt(value),
        currency: opt(currency),
        orderUuid: opt(orderUuid),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/conversions");
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm"
    >
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={f.clickId} required>
          <input
            className={INPUT_CLASS}
            value={clickId}
            onChange={(e) => setClickId(e.target.value)}
            required
            placeholder={f.clickIdPlaceholder}
          />
        </Field>
        <Field label={f.conversionAction} required>
          <input
            className={INPUT_CLASS}
            value={conversionAction}
            onChange={(e) => setConversionAction(e.target.value)}
            required
            placeholder={f.conversionActionPlaceholder}
          />
        </Field>
        <Field label={f.conversionTime}>
          <input
            type="datetime-local"
            className={INPUT_CLASS}
            value={conversionTime}
            onChange={(e) => setConversionTime(e.target.value)}
          />
        </Field>
        <Field label={f.orderUuid}>
          <input
            className={INPUT_CLASS}
            value={orderUuid}
            onChange={(e) => setOrderUuid(e.target.value)}
            placeholder={f.orderUuidPlaceholder}
          />
        </Field>
        <Field label={f.value}>
          <input
            className={INPUT_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={f.valuePlaceholder}
          />
        </Field>
        <Field label={f.currency}>
          <input
            className={INPUT_CLASS}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder={f.currencyPlaceholder}
          />
        </Field>
      </div>
      <SubmitButton pending={pending}>{f.createConversion}</SubmitButton>
    </form>
  );
}

function CreateFromOrderForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [conversionAction, setConversionAction] = useState("");
  const [conversionTime, setConversionTime] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("");
  const { t } = useI18n();
  const f = t.entities.forms.conversion;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createConversionFromOrderAction({
        orderId: orderId.trim(),
        conversionAction: conversionAction.trim(),
        conversionTime: toIsoOrUndefined(conversionTime),
        value: opt(value),
        currency: opt(currency),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/conversions");
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-ink/10 bg-white/80 p-6 shadow-sm"
    >
      <FormError message={error} />
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
        <Field label={f.conversionAction} required>
          <input
            className={INPUT_CLASS}
            value={conversionAction}
            onChange={(e) => setConversionAction(e.target.value)}
            required
            placeholder={f.conversionActionPlaceholder}
          />
        </Field>
        <Field label={f.conversionTime}>
          <input
            type="datetime-local"
            className={INPUT_CLASS}
            value={conversionTime}
            onChange={(e) => setConversionTime(e.target.value)}
          />
        </Field>
        <Field label={f.value}>
          <input
            className={INPUT_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={f.valuePlaceholder}
          />
        </Field>
        <Field label={f.currency}>
          <input
            className={INPUT_CLASS}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder={f.currencyPlaceholder}
          />
        </Field>
      </div>
      <SubmitButton pending={pending}>{f.createFromOrderSubmit}</SubmitButton>
    </form>
  );
}

export function ConversionForms() {
  const { t } = useI18n();
  const f = t.entities.forms.conversion;
  return (
    <div>
      <SectionTitle>{f.createFromClick}</SectionTitle>
      <div className="mt-4">
        <CreateFromClickForm />
      </div>
      <SectionTitle>{f.createFromOrder}</SectionTitle>
      <div className="mt-4">
        <CreateFromOrderForm />
      </div>
    </div>
  );
}
