import { entityApi, type Campaign } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
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
import {
  zh as campaignToggleZh,
  en as campaignToggleEn,
} from "@/i18n/dict/campaign-toggle";
import { CampaignToggleButton } from "./_components/campaign-toggle-button";

export const dynamic = "force-dynamic";

function parsePageParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePageParam(sp.page, 1);
  const pageSize = parsePageParam(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);
  const tt = lang === "en" ? campaignToggleEn : campaignToggleZh;

  let result;
  try {
    result = await entityApi.campaigns.list(page, pageSize);
  } catch (e) {
    return (
      <div>
        <EntityPageHeader
          title={t.common.nav.campaigns}
          description={t.entities.campaigns.description}
        />
        <ErrorState
          message={mapEntityErrorMessage(e, lang)}
          title={t.common.error.title}
        />
      </div>
    );
  }

  const columns: Array<Column<Campaign>> = [
    {
      header: t.common.misc.name,
      render: (c) => <span className="font-medium text-ink">{c.name}</span>,
    },
    {
      header: t.entities.campaigns.columns.googleCampaignId,
      render: (c) => (
        <span className="font-mono text-[13px]">{c.googleCampaignId}</span>
      ),
    },
    {
      header: t.common.misc.status,
      render: (c) => <StatusBadge value={c.status} />,
    },
    {
      header: t.entities.campaigns.columns.biddingStrategy,
      render: (c) => c.biddingStrategy ?? "—",
    },
    {
      header: t.common.misc.updated,
      render: (c) => (
        <span className="whitespace-nowrap text-ink/70">
          {formatDateTime(c.updatedAt)}
        </span>
      ),
    },
    {
      header: tt.toggle.actionsColumn,
      render: (c) => (
        <CampaignToggleButton
          campaignId={c.id}
          googleAccountId={c.googleAccountId}
          campaignName={c.name}
          currentStatus={c.status}
          t={tt}
        />
      ),
    },
  ];

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.campaigns}
        description={t.entities.campaigns.description}
      />
      <DataTable
        columns={columns}
        rows={result.items}
        emptyText={t.entities.campaigns.empty}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={result.total}
        basePath="/campaigns"
        labels={paginationLabels(t)}
      />
    </div>
  );
}
