import { entityApi, type TrackingLink } from "@/lib/api/entities";
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
  StatusBadge,
  paginationLabels,
  type Column,
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

function parsePositiveInt(
  value: string | string[] | undefined,
  fallback: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const monoClassName = "font-mono text-[13px]";

export default async function TrackingLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const page = parsePositiveInt(sp.page, 1);
  const pageSize = parsePositiveInt(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);

  const columns: Array<Column<TrackingLink>> = [
    {
      header: t.entities.trackingLinks.columns.publicId,
      render: (tl) => <span className={monoClassName}>{tl.publicId}</span>,
    },
    {
      header: t.common.misc.status,
      render: (tl) => <StatusBadge value={tl.status} />,
    },
    {
      header: t.entities.trackingLinks.columns.offerId,
      render: (tl) => (
        <span className={monoClassName} title={tl.offerId}>
          {truncate(tl.offerId, 24)}
        </span>
      ),
    },
    {
      header: t.entities.trackingLinks.columns.campaignId,
      render: (tl) =>
        tl.campaignId ? (
          <span className={monoClassName} title={tl.campaignId}>
            {truncate(tl.campaignId, 24)}
          </span>
        ) : (
          <span className="text-sm text-ink/50">—</span>
        ),
    },
    {
      header: t.common.misc.updated,
      render: (tl) => formatDateTime(tl.updatedAt),
      className: "whitespace-nowrap",
    },
  ];

  let data: Awaited<ReturnType<typeof entityApi.trackingLinks.list>> | null =
    null;
  let error: string | null = null;
  try {
    data = await entityApi.trackingLinks.list(page, pageSize);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.trackingLinks}
        description={t.entities.trackingLinks.description}
      />
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.trackingLinks.loadError}
          title={t.common.error.title}
        />
      ) : (
        <>
          <DataTable<TrackingLink>
            columns={columns}
            rows={data.items}
            rowHref={(tl) => `/tracking-links/${tl.id}`}
            emptyText={t.entities.trackingLinks.empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/tracking-links"
            labels={paginationLabels(t)}
          />
        </>
      )}
    </div>
  );
}
