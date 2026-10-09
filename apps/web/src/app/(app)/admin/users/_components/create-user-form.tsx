"use client";

/**
 * Admin "create user" form (email / password / name / role).
 * Calls the createAdminUserAction server action directly; the page
 * revalidates on success.
 */
import { useRef, useState, type FormEvent } from "react";
import { createAdminUserAction } from "@/lib/api/admin-users-actions";
import type { AdminUsersDict } from "@/i18n/dict/admin-users";

export function CreateUserForm({ t }: { t: AdminUsersDict }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setSuccess(false);
    const result = await createAdminUserAction({
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      name: String(fd.get("name") ?? ""),
      role: String(fd.get("role") ?? "member"),
    });
    setPending(false);
    if (result.ok) {
      setSuccess(true);
      formRef.current?.reset();
    } else {
      setError(result.error);
    }
  }

  const input =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30";

  return (
    <div className="mb-8 rounded-2xl border border-ink/10 bg-white p-5">
      <h2 className="text-base font-semibold text-ink">{t.createForm.title}</h2>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.email}
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder={t.createForm.emailPlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.password}
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t.createForm.passwordHint}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.name}
          </span>
          <input
            name="name"
            type="text"
            autoComplete="off"
            placeholder={t.createForm.namePlaceholder}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t.createForm.role}
          </span>
          <select name="role" defaultValue="member" className={input}>
            <option value="member">{t.roles.member}</option>
            <option value="researcher">{t.roles.researcher}</option>
            <option value="admin">{t.roles.admin}</option>
          </select>
        </label>
      </form>
      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t.createForm.success}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => formRef.current?.requestSubmit()}
        className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/85 disabled:opacity-50"
      >
        {pending ? t.createForm.submitting : t.createForm.submit}
      </button>
    </div>
  );
}
