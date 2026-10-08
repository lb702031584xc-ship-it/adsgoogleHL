import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import { getCurrentUser, listUsers, type AdminUserRow } from "@/lib/api/auth";
import { setViewTenantAction } from "@/lib/api/auth-actions";
import { formatDateTime } from "@/lib/api/entities-config";

export const dynamic = "force-dynamic";

/** Admin-only: list all users and view-as a tenant. */
export default async function AdminUsersPage() {
  const lang = await getLang();
  const t = getDictionary(lang);

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const users = await listUsers();
  if (users === null) {
    return (
      <div>
        <EntityPageHeader
          title={t.auth.admin.users.title}
          description={t.auth.admin.users.description}
        />
        <ErrorState
          title={t.common.error.title}
          message={t.auth.admin.users.loadError}
        />
      </div>
    );
  }

  const columns: Array<Column<AdminUserRow>> = [
    {
      header: t.auth.admin.users.columns.email,
      render: (u) => <span className="font-medium text-ink">{u.email}</span>,
    },
    {
      header: t.auth.admin.users.columns.name,
      render: (u) => <span className="text-ink/80">{u.name}</span>,
    },
    {
      header: t.auth.admin.users.columns.role,
      render: (u) => (
        <span className="inline-block rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink/70">
          {u.role === "admin"
            ? t.auth.admin.users.roles.admin
            : t.auth.admin.users.roles.user}
        </span>
      ),
    },
    {
      header: t.auth.admin.users.columns.tenant,
      render: (u) => (
        <span className="font-mono text-[13px]">{u.tenantId.slice(0, 8)}…</span>
      ),
    },
    {
      header: t.auth.admin.users.columns.created,
      render: (u) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(u.createdAt)}
        </span>
      ),
    },
    {
      header: t.common.misc.actions,
      render: (u) =>
        u.id === user.id ? (
          <span className="text-xs text-ink/40">—</span>
        ) : (
          <form action={setViewTenantAction}>
            <input type="hidden" name="tenantId" value={u.tenantId} />
            <button
              type="submit"
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink/85"
            >
              {t.auth.admin.users.viewData}
            </button>
          </form>
        ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title={t.auth.admin.users.title}
        description={t.auth.admin.users.description}
      />
      <DataTable
        columns={columns}
        rows={users}
        emptyText={t.auth.admin.users.empty}
      />
    </div>
  );
}
