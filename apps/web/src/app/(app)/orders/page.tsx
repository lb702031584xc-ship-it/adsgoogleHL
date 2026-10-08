import { entityApi, type Order } from "@/lib/api/entities";
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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const { page, pageSize } = parsePaging(await searchParams);
  const lang = await getLang();
  const t = getDictionary(lang);

  const columns: Array<Column<Order>> = [
    {
      header: t.entities.orders.columns.orderId,
      render: (o) => (
        <span className="font-mono text-[13px]">{truncate(o.orderId, 36)}</span>
      ),
    },
    {
      header: t.entities.orders.columns.clickId,
      render: (o) => (
        <span className="font-mono text-[13px]">{truncate(o.clickId, 18)}</span>
      ),
    },
    {
      header: t.entities.orders.columns.value,
      render: (o) => `${o.value} ${o.currency}`,
    },
    {
      header: t.common.misc.status,
      render: (o) => <StatusBadge value={o.status} />,
    },
    { header: t.common.misc.created, render: (o) => formatDateTime(o.createdAt) },
  ];

  let error: string | null = null;
  let data: Awaited<ReturnType<typeof entityApi.orders.list>> | null = null;
  try {
    data = await entityApi.orders.list(page, pageSize);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  return (
    <section className="max-w-6xl">
      <EntityPageHeader
        title={t.common.nav.orders}
        description={t.entities.orders.description}
        actions={
          <PrimaryLink href="/orders/new">{t.entities.orders.newOrder}</PrimaryLink>
        }
      />
      {error || !data ? (
        <ErrorState
          message={error ?? t.entities.orders.loadError}
          title={t.common.error.title}
        />
      ) : (
        <>
          <DataTable<Order>
            columns={columns}
            rows={data.items}
            rowHref={(o) => `/orders/${o.id}`}
            emptyText={t.entities.orders.empty}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            basePath="/orders"
            labels={paginationLabels(t)}
          />
        </>
      )}
    </section>
  );
}
