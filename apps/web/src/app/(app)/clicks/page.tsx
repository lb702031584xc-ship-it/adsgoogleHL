import { entityApi, type Click } from "@/lib/api/entities";
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

export default async function ClicksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { page, pageSize } = parsePaging(await searchParams);
  const lang = await getLang();
  const t = getDictionary(lang);

  const columns: Array<Column<Click>> = [
    {
      header: t.entities.clicks.columns.clickId,
      render: (c) => (
        <span className="font-mono text-[13px]">{truncate(c.clickId, 18)}</span>
      ),
    },
    {
      header: t.entities.clicks.columns.trackingLink,
      render: (c) => (
        <span className="font-mono text-[13px]">
          {truncate(c.trackingLinkId, 18)}
        </span>
      ),
    },
    {
      header: t.entities.clicks.columns.gclid,
      render: (c) => (
        <span className="font-mono text-[13px]">{truncate(c.gclid, 18)}</span>
      ),
    },
    { header: t.entities.clicks.columns.utmSource, render: (c) => c.utmSource ?? "—" },
    { header: t.entities.clicks.columns.utmMedium, render: (c) => c.utmMedium ?? "—" },
    { header: t.entities.clicks.columns.country, render: (c) => c.country ?? "—" },
    { header: t.entities.clicks.columns.device, render: (c) => c.deviceType ?? "—" },
    { header: t.entities.clicks.columns.occurred, render: (c) => formatDateTime(c.occurredAt) },
  ];

  let error: string | null = null;
  let data: Awaited<ReturnType<typeof entityApi.clicks.list>> | null = null;
  try {
    data = await entityApi.clicks.list(page, pageSize);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  return (
    <section className="max-w-6xl">
      <EntityPageHeader
        title={t.common.nav.clicks}
        description={t.entities.clicks.description}
      />
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.clicks.loadError}
          title={t.common.error.title}
        />
      ) : (
        <>
          <DataTable<Click>
            columns={columns}
            rows={data.items}
            rowHref={(c) => `/clicks/${c.id}`}
            emptyText={t.entities.clicks.empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/clicks"
            labels={paginationLabels(t)}
          />
        </>
      )}
    </section>
  );
}
