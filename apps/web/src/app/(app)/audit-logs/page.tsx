import type { ReactNode } from "react";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  Pagination,
  paginationLabels,
} from "@/components/entities/ui";
import { entityApi, type AuditLog } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function parsePositiveInt(
  value: string | string[] | undefined,
  fallback: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const lang = await getLang();
  const t = getDictionary(lang);
  const params = await searchParams;
  const page = parsePositiveInt(params.page, 1);
  const pageSize = parsePositiveInt(params.pageSize, 20);

  let logs: AuditLog[] = [];
  let total = 0;
  let error: string | null = null;

  try {
    const res = await entityApi.auditLogs.list(page, pageSize);
    logs = res.items;
    total = res.total;
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  const columns = [
    {
      header: t.common.misc.actions,
      render: (row: AuditLog) => <Mono>{row.action}</Mono>,
    },
    {
      header: t.ops.labels.entityType,
      render: (row: AuditLog) => row.entityType,
    },
    {
      header: t.ops.labels.entityId,
      render: (row: AuditLog) => <Mono>{truncate(row.entityId, 24)}</Mono>,
    },
    {
      header: t.ops.auditLogs.columns.actor,
      render: (row: AuditLog) => truncate(row.actorId, 18),
    },
    {
      header: t.ops.auditLogs.columns.requestId,
      render: (row: AuditLog) => <Mono>{truncate(row.requestId, 18)}</Mono>,
    },
    {
      header: t.common.misc.created,
      render: (row: AuditLog) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <EntityPageHeader
        title={t.common.nav.auditLogs}
        description={t.ops.auditLogs.description}
      />

      {error ? <ErrorState message={error} title={t.common.error.title} /> : null}

      <DataTable columns={columns} rows={logs} emptyText={t.ops.auditLogs.empty} />
      <Pagination
        labels={paginationLabels(t)}
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/audit-logs"
      />
    </div>
  );
}
