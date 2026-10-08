import Link from "next/link";
import { entityApi, type LandingPage } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import {
  DataTable,
  EntityPageHeader,
  ErrorState,
  StatusBadge,
  type Column,
  type PaginationLabels,
} from "@/components/entities/ui";
import { OfferSelector } from "@/components/entities/offer-selector";
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

function columnsFor(t: ReturnType<typeof getDictionary>): Array<Column<LandingPage>> {
  return [
    { header: t.common.misc.name, render: (lp) => lp.name },
    {
      header: t.entities.landingPages.columns.url,
      render: (lp) => (
        <a
          href={lp.url}
          target="_blank"
          rel="noreferrer"
          title={lp.url}
          className="text-signal hover:underline"
        >
          {truncate(lp.url, 48)}
        </a>
      ),
    },
    { header: t.entities.landingPages.columns.domain, render: (lp) => lp.domain },
    {
      header: t.common.misc.status,
      render: (lp) => <StatusBadge value={lp.status} />,
    },
    {
      header: t.common.misc.updated,
      render: (lp) => formatDateTime(lp.updatedAt),
      className: "whitespace-nowrap",
    },
  ];
}

function OfferPager({
  selectedId,
  page,
  pageSize,
  total,
  labels,
}: {
  selectedId: string;
  page: number;
  pageSize: number;
  total: number;
  labels: PaginationLabels;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) {
    return <p className="mt-4 text-sm text-ink/55">{labels.items(total)}</p>;
  }
  const href = (p: number) =>
    `/landing-pages?offerId=${encodeURIComponent(selectedId)}&page=${p}&pageSize=${pageSize}`;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <p className="text-ink/55">
        {labels.items(total)} · {labels.pageOf(page, totalPages)}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            className="rounded-lg border border-ink/15 bg-white/70 px-3 py-1.5 font-medium hover:bg-white"
          >
            {labels.previous}
          </Link>
        ) : (
          <span className="rounded-lg border border-ink/10 px-3 py-1.5 text-ink/35">
            {labels.previous}
          </span>
        )}
        {page < totalPages ? (
          <Link
            href={href(page + 1)}
            className="rounded-lg border border-ink/15 bg-white/70 px-3 py-1.5 font-medium hover:bg-white"
          >
            {labels.next}
          </Link>
        ) : (
          <span className="rounded-lg border border-ink/10 px-3 py-1.5 text-ink/35">
            {labels.next}
          </span>
        )}
      </div>
    </div>
  );
}

export default async function LandingPagesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const page = parsePositiveInt(sp.page, 1);
  const pageSize = parsePositiveInt(sp.pageSize, 20);
  const offerIdParam = Array.isArray(sp.offerId) ? sp.offerId[0] : sp.offerId;
  const lang = await getLang();
  const t = getDictionary(lang);
  const columns = columnsFor(t);
  const pagerLabels: PaginationLabels = {
    items: t.entities.ui.pagination.items,
    pageOf: t.entities.ui.pagination.pageOf,
    previous: t.common.pagination.previous,
    next: t.common.pagination.next,
  };

  let offers: Array<{ id: string; name: string }> = [];
  let error: string | null = null;
  try {
    const res = await entityApi.offers.list(1, 100);
    offers = res.items.map((o) => ({ id: o.id, name: o.name }));
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  const selectedId =
    offerIdParam && offers.some((o) => o.id === offerIdParam)
      ? offerIdParam
      : offers[0]?.id;

  let data: Awaited<ReturnType<typeof entityApi.offers.listLandingPages>> | null =
    null;
  if (!error && selectedId) {
    try {
      data = await entityApi.offers.listLandingPages(selectedId, page, pageSize);
    } catch (e) {
      error = mapEntityErrorMessage(e, lang);
    }
  }

  return (
    <div>
      <EntityPageHeader
        title={t.common.nav.landingPages}
        description={t.entities.landingPages.description}
      />
      {error || !selectedId ? (
        <ErrorState
          message={error ?? t.entities.landingPages.noOffers}
          title={t.common.error.title}
        />
      ) : (
        <>
          <OfferSelector offers={offers} selectedId={selectedId} />
          {!data ? (
            <ErrorState
              message={error ?? t.entities.landingPages.loadError}
              title={t.common.error.title}
            />
          ) : (
            <>
              <DataTable<LandingPage>
                columns={columns}
                rows={data.items}
                emptyText={t.entities.landingPages.empty}
              />
              <OfferPager
                selectedId={selectedId}
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                labels={pagerLabels}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
