"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { registerAction } from "@/lib/api/auth-actions";

export function RegisterForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(registerAction, {
    error: null as string | null,
  });
  const [mismatch, setMismatch] = useState(false);

  const input =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">
        {t.auth.register.title}
      </h1>
      <p className="mt-1 text-sm text-ink/60">{t.auth.register.description}</p>
      <p className="mt-3 rounded-lg bg-sand/15 px-3 py-2 text-xs text-ink/70">
        {t.auth.register.firstUserNote}
      </p>
      <form
        action={formAction}
        className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          const form = e.currentTarget;
          const pw = String(
            (form.elements.namedItem("password") as HTMLInputElement)?.value ??
              ""
          );
          const cpw = String(
            (
              form.elements.namedItem(
                "confirmPassword"
              ) as HTMLInputElement
            )?.value ?? ""
          );
          if (pw !== cpw) {
            e.preventDefault();
            setMismatch(true);
          } else {
            setMismatch(false);
          }
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.auth.register.name}
          </span>
          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder={t.auth.register.namePlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.auth.register.email}
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t.auth.register.emailPlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.auth.register.password}
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t.auth.register.passwordHint}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.auth.register.confirmPassword}
          </span>
          <input
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className={input}
          />
        </label>
        {mismatch || state?.error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {mismatch ? t.auth.register.passwordMismatch : state?.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? t.auth.register.submitting : t.auth.register.submit}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink/60">
        {t.auth.register.hasAccount}{" "}
        <Link href="/login" className="font-medium text-signal underline-offset-2 hover:underline">
          {t.auth.register.goLogin}
        </Link>
      </p>
    </div>
  );
}
