"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { loginAction } from "@/lib/api/auth-actions";

export function LoginForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(loginAction, {
    error: null as string | null,
  });

  const input =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">
        {t.auth.login.title}
      </h1>
      <p className="mt-1 text-sm text-ink/60">{t.auth.login.description}</p>
      <form action={formAction} className="mt-6 flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.auth.login.email}
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t.auth.login.emailPlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.auth.login.password}
          </span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={input}
          />
        </label>
        {state?.error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-50"
        >
          {pending ? t.auth.login.submitting : t.auth.login.submit}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ink/60">
        {t.auth.login.noAccount}{" "}
        <Link href="/register" className="font-medium text-signal underline-offset-2 hover:underline">
          {t.auth.login.goRegister}
        </Link>
      </p>
    </div>
  );
}
