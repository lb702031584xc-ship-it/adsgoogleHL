"use client";

/**
 * Per-row role dropdown for the admin users table.
 * Change → confirm via native select → server action → page revalidates.
 * The acting admin's own row is never rendered with this component.
 */
import { useRef, useState } from "react";
import {
  changeAdminUserRoleAction,
  type AdminUserRole,
} from "@/lib/api/admin-users-actions";

const ROLES: AdminUserRole[] = ["admin", "member", "researcher"];

export function RoleSelect({
  userId,
  currentRole,
  roleLabels,
  updatingLabel,
}: {
  userId: string;
  currentRole: AdminUserRole;
  roleLabels: Record<AdminUserRole, string>;
  updatingLabel: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  async function onChange(next: string) {
    if (next === currentRole || pending) return;
    setPending(true);
    setError(null);
    const result = await changeAdminUserRoleAction(userId, next);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      // Revert the select so it keeps showing the true role.
      if (selectRef.current) selectRef.current.value = currentRole;
    }
    // On success the page revalidates and re-renders with the new role.
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <select
        ref={selectRef}
        defaultValue={currentRole}
        disabled={pending}
        aria-label={roleLabels[currentRole]}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-xs text-ink focus:border-signal focus:outline-none disabled:opacity-50"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabels[r]}
          </option>
        ))}
      </select>
      {pending ? (
        <span className="text-[11px] text-ink/50">{updatingLabel}</span>
      ) : null}
      {error ? (
        <span className="max-w-44 text-[11px] text-red-700">{error}</span>
      ) : null}
    </span>
  );
}
