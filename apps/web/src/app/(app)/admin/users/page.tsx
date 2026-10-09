import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/admin-users";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  type Column,
} from "@/components/entities/ui";
import { getCurrentUser, listUsers } from "@/lib/api/auth";
import { setViewTenantAction } from "@/lib/api/auth-actions";
import { formatDateTime } from "@/lib/api/entities-config";
import type { AdminManagedUser } from "@/lib/api/admin-users-actions";
import { CreateUserForm } from "./_components/create-user-form";
import { RoleSelect } from "./_components/role-select";
import { DeleteUserButton } from "./_components/delete-user-button";

export const dynamic = "force-dynamic";

/** Admin-only: manage users — create, change role, delete, view-as. */
export default async function AdminUsersPage() {
  const lang = await getLang();
  const t = lang === "en" ? en : zh;

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const rows = await listUsers();
  if (rows === null) {
    return (
      <div>
        <EntityPageHeader title={t.title} description={t.description} />
        <ErrorState title={t.title} message={t.errors.loadError} />
      </div>
    );
  }
  const users: AdminManagedUser[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role as AdminManagedUser["role"],
    tenantId: r.tenantId,
    createdAt: r.createdAt,
  }));

  const columns: Array<Column<AdminManagedUser>> = [
    {
      header: t.table.email,
      render: (u) => <span className="font-medium text-ink">{u.email}</span>,
    },
    {
      header: t.table.name,
      render: (u) => <span className="text-ink/80">{u.name || "—"}</span>,
    },
    {
      header: t.table.role,
      render: (u) =>
        u.id === user.id ? (
          <span className="inline-block rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink/70">
            {t.roles[u.role] ?? u.role}
          </span>
        ) : (
          <RoleSelect
            userId={u.id}
            currentRole={u.role}
            roleLabels={t.roles}
            updatingLabel={t.rowActions.changingRole}
          />
        ),
    },
    {
      header: t.table.tenant,
      render: (u) => (
        <span className="font-mono text-[13px]">{u.tenantId.slice(0, 8)}…</span>
      ),
    },
    {
      header: t.table.created,
      render: (u) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(u.createdAt)}
        </span>
      ),
    },
    {
      header: t.table.actions,
      render: (u) =>
        u.id === user.id ? (
          <span className="text-xs text-ink/40">{t.rowActions.self}</span>
        ) : (
          <span className="inline-flex items-start gap-2">
            <form action={setViewTenantAction}>
              <input type="hidden" name="tenantId" value={u.tenantId} />
              <button
                type="submit"
                className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink/85"
              >
                {t.rowActions.viewData}
              </button>
            </form>
            <DeleteUserButton
              userId={u.id}
              labels={{
                delete: t.rowActions.delete,
                deleting: t.rowActions.deleting,
                confirm: t.rowActions.confirm,
                cancel: t.rowActions.cancel,
                confirmTitle: t.rowActions.confirmTitle,
              }}
            />
          </span>
        ),
    },
  ];

  return (
    <div>
      <EntityPageHeader title={t.title} description={t.description} />
      <CreateUserForm t={t} />
      <DataTable columns={columns} rows={users} emptyText={t.empty} />
    </div>
  );
}
