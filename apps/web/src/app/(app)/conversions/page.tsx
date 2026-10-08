import { entityApi, type Conversion } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  Pagination,
  PrimaryLink,
  StatusBadge,
  paginationLabels,
  type Column,
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

function parsePaging(searchParams: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(searchParams.pageSize ?? "20", 10) || 20)
  );
  return { page, pageSize };
}

function formatValue(c: Conversion): string {
  if (c.value == null || c.value === "") return "—";
  return c.currency ? `${c.value} ${c.currency}` : c.value;
}

export default async function ConversionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { page, pageSize } = parsePaging(await searchParams);
  const lang = await getLang();
  const t = getDictionary(lang);

  const columns: Array<Column<Conversion>> = [
    {
      header: t.common.misc.id,
      render: (c) => (
        <span className="font-mono text-[13px]">{truncate(c.id, 18)}</span>
      ),
    },
    { header: t.entities.conversions.columns.action, render: (c) => c.conversionAction },
    {
      header: t.entities.conversions.columns.clickId,
      render: (c) => (
        <span className="font-mono text-[13px]">{truncate(c.clickId, 18)}</span>
      ),
    },
    { header: t.entities.conversions.columns.value, render: (c) => formatValue(c) },
    {
      header: t.common.misc.status,
      render: (c) => <StatusBadge value={c.status} />,
    },
    {
      header: t.entities.conversions.columns.upload,
      render: (c) => <StatusBadge value={c.googleUploadStatus} />,
    },
    { header: t.common.misc.created, render: (c) => formatDateTime(c.createdAt) },
  ];

  let error: string | null = null;
  let data: Awaited<ReturnType<typeof entityApi.conversions.list>> | null =
    null;
  try {
    data = await entityApi.conversions.list(page, pageSize);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  return (
    <section className="max-w-6xl">
      <EntityPageHeader
        title={t.common.nav.conversions}
        description={t.entities.conversions.description}
        actions={
          <PrimaryLink href="/conversions/new">
            {t.entities.conversions.newConversion}
          </PrimaryLink>
        }
      />
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.conversions.loadError}
          title={t.common.error.title}
        />
      ) : (
        <>
          <DataTable<Conversion>
            columns={columns}
            rows={data.items}
            rowHref={(c) => `/conversions/${c.id}`}
            emptyText={t.entities.conversions.empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/conversions"
            labels={paginationLabels(t)}
          />
        </>
      )}
    </section>
  );
}
