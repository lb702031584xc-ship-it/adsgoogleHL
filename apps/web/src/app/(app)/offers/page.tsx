import { entityApi, type Offer } from "@/lib/api/entities";
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
import { OfferScoreCell } from "@/components/offers/offer-score-cell";
import { TestSpendCell } from "@/components/offers/test-spend-cell";

export const dynamic = "force-dynamic";

function parsePositiveInt(
  value: string | string[] | undefined,
  fallback: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const page = parsePositiveInt(sp.page, 1);
  const pageSize = parsePositiveInt(sp.pageSize, 20);
  const lang = await getLang();
  const t = getDictionary(lang);

  const columns: Array<Column<Offer>> = [
    { header: t.common.misc.name, render: (o) => o.name },
    { header: t.entities.offers.columns.network, render: (o) => o.network },
    {
      header: t.common.misc.status,
      render: (o) => <StatusBadge value={o.status} />,
    },
    { header: t.entities.offers.columns.priority, render: (o) => String(o.priority) },
    {
      header: t.entities.offers.scoreColumn,
      render: (o) => (
        <OfferScoreCell
          offerId={o.id}
          initial={o.metricsSummary}
          dict={{
            scoreColumn: t.entities.offers.scoreColumn,
            fetchMetrics: t.entities.offers.fetchMetrics,
            fetching: t.entities.offers.fetching,
            noData: t.entities.offers.scoreNoData,
            breakdownTitle: t.entities.offers.breakdownTitle,
            rating: t.entities.offers.rating,
            reviewCount: t.entities.offers.reviewCount,
            soldCount: t.entities.offers.soldCount,
            notFetched: t.entities.offers.notFetched,
            formulaHint: t.entities.offers.formulaHint,
            gradeStrong: t.entities.offers.gradeStrong,
            gradeGood: t.entities.offers.gradeGood,
            gradeCaution: t.entities.offers.gradeCaution,
            gradeAvoid: t.entities.offers.gradeAvoid,
            fetchedAt: t.entities.offers.fetchedAt,
            failuresLabel: t.entities.offers.failuresLabel,
          }}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.testStopLoss.listColumn,
      render: (o) => (
        <TestSpendCell
          offerId={o.id}
          dict={{
            column: t.entities.offers.testStopLoss.listColumn,
            spent: t.entities.offers.testStopLoss.spent,
            noData: t.entities.offers.scoreNoData,
          }}
        />
      ),
      className: "whitespace-nowrap",
    },
    {
      header: t.entities.offers.columns.destinationUrl,
      render: (o) => (
        <a
          href={o.destinationUrl}
          target="_blank"
          rel="noreferrer"
          title={o.destinationUrl}
          className="text-signal hover:underline"
        >
          {truncate(o.destinationUrl, 40)}
        </a>
      ),
    },
    {
      header: t.common.misc.updated,
      render: (o) => formatDateTime(o.updatedAt),
      className: "whitespace-nowrap",
    },
  ];

  let data: Awaited<ReturnType<typeof entityApi.offers.list>> | null = null;
  let error: string | null = null;
  try {
    data = await entityApi.offers.list(page, pageSize);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.offers}
        description={t.entities.offers.description}
        actions={
          <PrimaryLink href="/offers/new">{t.entities.offers.newOffer}</PrimaryLink>
        }
      />
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.offers.loadError}
          title={t.common.error.title}
        />
      ) : (
        <>
          <DataTable<Offer>
            columns={columns}
            rows={data.items}
            rowHref={(o) => `/offers/${o.id}`}
            emptyText={t.entities.offers.empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/offers"
            labels={paginationLabels(t)}
          />
        </>
      )}
    </div>
  );
}
