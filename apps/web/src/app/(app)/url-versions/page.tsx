import type { ReactNode } from "react";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  Pagination,
  paginationLabels,
  PrimaryLink,
  SectionTitle,
  StatusBadge,
} from "@/components/entities/ui";
import { entityApi, type UrlChangeRequest, type UrlVersion } from "@/lib/api/entities";
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

function ExternalUrl({ url }: { url: string }) {
  const short = truncate(url, 40);
  if (/^https?:\/\//i.test(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-signal break-all hover:underline"
        title={url}
      >
        {short}
      </a>
    );
  }
  return (
    <span className="break-all" title={url}>
      {short}
    </span>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>;
}

export default async function UrlVersionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const lang = await getLang();
  const t = getDictionary(lang);
  const params = await searchParams;
  const vPage = parsePositiveInt(params.page, 1);
  const vPageSize = parsePositiveInt(params.pageSize, 20);
  const crPage = parsePositiveInt(params.crPage, 1);
  const crPageSize = parsePositiveInt(params.crPageSize, 20);

  let versions: UrlVersion[] = [];
  let versionsTotal = 0;
  let requests: UrlChangeRequest[] = [];
  let requestsTotal = 0;
  let error: string | null = null;

  try {
    const [vRes, rRes] = await Promise.all([
      entityApi.urlVersions.list(vPage, vPageSize),
      entityApi.urlChangeRequests.list(crPage, crPageSize),
    ]);
    versions = vRes.items;
    versionsTotal = vRes.total;
    requests = rRes.items;
    requestsTotal = rRes.total;
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  const versionColumns = [
    {
      header: t.ops.urlVersions.columns.version,
      render: (row: UrlVersion) => <Mono>v{row.version}</Mono>,
    },
    {
      header: t.ops.labels.entityType,
      render: (row: UrlVersion) => <StatusBadge value={row.entityType} />,
    },
    {
      header: t.ops.labels.entityId,
      render: (row: UrlVersion) => <Mono>{truncate(row.entityId, 24)}</Mono>,
    },
    {
      header: t.common.misc.status,
      render: (row: UrlVersion) => <StatusBadge value={row.status} />,
    },
    {
      header: t.ops.urlVersions.columns.finalUrl,
      render: (row: UrlVersion) => <ExternalUrl url={row.finalUrl} />,
    },
    {
      header: t.ops.urlVersions.columns.effective,
      render: (row: UrlVersion) => formatDateTime(row.effectiveAt),
    },
    {
      header: t.common.misc.updated,
      render: (row: UrlVersion) => formatDateTime(row.updatedAt),
    },
  ];

  const requestColumns = [
    {
      header: t.common.misc.id,
      render: (row: UrlChangeRequest) => <Mono>{truncate(row.id, 18)}</Mono>,
    },
    {
      header: t.ops.urlVersions.columns.entity,
      render: (row: UrlChangeRequest) => (
        <span>
          {row.entityType} · <Mono>{truncate(row.entityId, 24)}</Mono>
        </span>
      ),
    },
    {
      header: t.ops.urlVersions.columns.toVersion,
      render: (row: UrlChangeRequest) => <Mono>{truncate(row.toVersionId, 18)}</Mono>,
    },
    {
      header: t.common.misc.status,
      render: (row: UrlChangeRequest) => <StatusBadge value={row.status} />,
    },
    {
      header: t.ops.labels.requestedBy,
      render: (row: UrlChangeRequest) => row.requestedBy,
    },
    {
      header: t.common.misc.updated,
      render: (row: UrlChangeRequest) => formatDateTime(row.updatedAt),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <EntityPageHeader
        title={t.common.nav.urlVersions}
        description={t.ops.urlVersions.description}
        actions={<PrimaryLink href="/url-versions/requests/new">{t.ops.urlVersions.newRequest}</PrimaryLink>}
      />

      {error ? <ErrorState message={error} title={t.common.error.title} /> : null}

      <SectionTitle>{t.ops.urlVersions.versionsSection}</SectionTitle>
      <DataTable
        columns={versionColumns}
        rows={versions}
        emptyText={t.ops.urlVersions.versionsEmpty}
      />
      <Pagination
        labels={paginationLabels(t)}
        page={vPage}
        pageSize={vPageSize}
        total={versionsTotal}
        basePath="/url-versions"
        extraParams={{
          crPage: String(crPage),
          crPageSize: String(crPageSize),
        }}
      />

      <SectionTitle>{t.ops.urlVersions.requestsSection}</SectionTitle>
      <DataTable
        columns={requestColumns}
        rows={requests}
        rowHref={(row) => `/url-versions/requests/${row.id}`}
        emptyText={t.ops.urlVersions.requestsEmpty}
      />
      <Pagination
        labels={paginationLabels(t)}
        page={crPage}
        pageSize={crPageSize}
        total={requestsTotal}
        basePath="/url-versions"
        pageParam="crPage"
        pageSizeParam="crPageSize"
        extraParams={{
          page: String(vPage),
          pageSize: String(vPageSize),
        }}
      />
    </div>
  );
}
