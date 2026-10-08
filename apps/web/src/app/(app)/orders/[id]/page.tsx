import Link from "next/link";
import { entityApi } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
} from "@/lib/api/entities-config";
import {
  DetailList,
  EntityPageHeader,
  ErrorState,
  SectionTitle,
  StatusBadge,
} from "@/components/entities/ui";
import { OrderStatusButtons } from "@/components/entities/order-forms";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

function mono(value: string | null | undefined) {
  return value ?? "—";
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getDictionary(lang);
  const d = t.entities.orders.detail;

  let error: string | null = null;
  let order: Awaited<ReturnType<typeof entityApi.orders.get>> | null = null;
  try {
    order = await entityApi.orders.get(id);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  if (error || !order) {
    return (
      <section className="max-w-4xl">
        <EntityPageHeader
          title={d.title}
          description={t.entities.orders.description}
        />
        <ErrorState
          message={error ?? d.notFound}
          title={t.common.error.title}
        />
        <p className="mt-4">
          <Link href="/orders" className="text-sm text-signal hover:underline">
            {d.backToList}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-4xl">
      <p className="text-sm">
        <Link href="/orders" className="text-ink/60 hover:underline">
          ← {t.common.nav.orders}
        </Link>
      </p>
      <EntityPageHeader
        title={d.title}
        description={t.entities.orders.description}
      />
      <DetailList
        items={[
          { label: t.common.misc.id, value: mono(order.id), mono: true },
          { label: d.labels.orderId, value: mono(order.orderId), mono: true },
          { label: d.labels.clickId, value: mono(order.clickId), mono: true },
          { label: d.labels.conversionId, value: mono(order.conversionId), mono: true },
          { label: d.labels.value, value: `${order.value} ${order.currency}` },
          {
            label: t.common.misc.status,
            value: <StatusBadge value={order.status} />,
          },
          { label: t.common.misc.created, value: formatDateTime(order.createdAt) },
          { label: t.common.misc.updated, value: formatDateTime(order.updatedAt) },
        ]}
      />
      <SectionTitle>{d.changeStatus}</SectionTitle>
      <div className="mt-4">
        <OrderStatusButtons id={order.id} currentStatus={order.status} />
      </div>
    </section>
  );
}
