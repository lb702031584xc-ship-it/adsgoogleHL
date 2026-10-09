"use client";

/**
 * Per-row delete button for the admin users table.
 * Click → inline confirm → server action → page revalidates and the row
 * disappears. The acting admin's own row is never rendered with this
 * component.
 */
import { useState } from "react";
import { deleteAdminUserAction } from "@/lib/api/admin-users-actions";

type Phase = "idle" | "confirming" | "deleting";

export function DeleteUserButton({
  userId,
  labels,
}: {
  userId: string;
  labels: {
    delete: string;
    deleting: string;
    confirm: string;
    cancel: string;
    confirmTitle: string;
  };
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function doDelete() {
    setPhase("deleting");
    setError(null);
    const result = await deleteAdminUserAction(userId);
    if (!result.ok) {
      setPhase("idle");
      setError(result.error);
    }
    // On success the page revalidates and this row disappears.
  }

  if (phase === "confirming" || phase === "deleting") {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="max-w-52 text-[11px] text-ink/60">
          {labels.confirmTitle}
        </span>
        <span className="inline-flex gap-2">
          <button
            type="button"
            disabled={phase === "deleting"}
            onClick={doDelete}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {phase === "deleting" ? labels.deleting : labels.confirm}
          </button>
          <button
            type="button"
            disabled={phase === "deleting"}
            onClick={() => setPhase("idle")}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-ink/5 disabled:opacity-50"
          >
            {labels.cancel}
          </button>
        </span>
        {error ? (
          <span className="max-w-52 text-[11px] text-red-700">{error}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setPhase("confirming")}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50"
      >
        {labels.delete}
      </button>
      {error ? (
        <span className="max-w-52 text-[11px] text-red-700">{error}</span>
      ) : null}
    </span>
  );
}
