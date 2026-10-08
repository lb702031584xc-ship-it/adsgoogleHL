import { entityApi, type AdGroup } from "@/lib/api/entities";
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

export default async function AdGroupsPage({
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
    result = await entityApi.adGroups.list(page, pageSize);
  } catch (e) {
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.adGroups}
          description={t.entities.adGroups.description}
        />
        <ErrorState
          message={mapEntityErrorMessage(e, lang)}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const columns: Array<Column<AdGroup>> = [
    {
      header: t.common.misc.name,
      render: (g) => <span className="font-medium text-ink">{g.name}</span>,
    },
    {
      header: t.entities.adGroups.columns.googleAdGroupId,
      render: (g) => (
        <span className="font-mono text-[13px]">{g.googleAdGroupId}</span>
      ),
    },
    {
      header: t.common.misc.status,
      render: (g) => <StatusBadge value={g.status} />,
    },
    {
      header: t.entities.adGroups.columns.campaignId,
      render: (g) => (
        <span className="font-mono text-[13px]" title={g.campaignId}>
          {truncate(g.campaignId, 24)}
        </span>
      ),
    },
    {
      header: t.common.misc.updated,
      render: (g) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(g.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.adGroups}
        description={t.entities.adGroups.description}
      />
      <DataTable
        columns={columns}
        rows={result.items}
        emptyText={t.entities.adGroups.empty}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.total}
        basePath="/ad-groups"
        labels={paginationLabels(t)}
      />
    </div>
  );
}
