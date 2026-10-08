import { entityApi, type Ad } from "@/lib/api/entities";
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

function parsePageParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function renderFinalUrl(ad: Ad) {
  const url = ad.finalUrl;
  if (!url) return <span className="text-ink/50">—</span>;
  const text = truncate(url, 40);
  if (/^https?:\/\//i.test(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        className="text-signal hover:underline break-all"
      >
        {text}
      </a>
    );
  }
  return (
    <span className="font-mono text-[13px] break-all" title={url}>
      {text}
    </span>
  );
}

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page, 1);
  const pageSize = parsePageParam(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);

  let result;
  try {
    result = await entityApi.ads.list(page, pageSize);
  } catch (e) {
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.ads}
          description={t.entities.ads.description}
        />
        <ErrorState
          message={mapEntityErrorMessage(e, lang)}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const columns: Array<Column<Ad>> = [
    {
      header: t.common.misc.name,
      render: (ad) => <span className="font-medium text-ink">{ad.name}</span>,
    },
    {
      header: t.entities.ads.columns.googleAdId,
      render: (ad) => (
        <span className="font-mono text-[13px]">{ad.googleAdId}</span>
      ),
    },
    {
      header: t.common.misc.status,
      render: (ad) => <StatusBadge value={ad.status} />,
    },
    {
      header: t.entities.ads.columns.finalUrl,
      render: renderFinalUrl,
    },
    {
      header: t.entities.ads.columns.trackingTemplate,
      render: (ad) =>
        ad.trackingTemplate ? (
          <span
            className="font-mono text-[13px] break-all"
            title={ad.trackingTemplate}
          >
            {truncate(ad.trackingTemplate, 40)}
          </span>
        ) : (
          <span className="text-ink/50">—</span>
        ),
    },
    {
      header: t.common.misc.updated,
      render: (ad) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(ad.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.ads}
        description={t.entities.ads.description}
      />
      <DataTable
        columns={columns}
        rows={result.items}
        emptyText={t.entities.ads.empty}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.total}
        basePath="/ads"
        labels={paginationLabels(t)}
      />
    </div>
  );
}
