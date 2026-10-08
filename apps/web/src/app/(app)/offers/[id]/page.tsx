import {
  entityApi,
  type LandingPage,
  type Offer,
} from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
  truncate,
} from "@/lib/api/entities-config";
import {
  DataTable,
  DetailList,
  EntityPageHeader,
  ErrorState,
  SectionTitle,
  StatusBadge,
  type Column,
} from "@/components/entities/ui";
import { OfferStatusSwitcher } from "@/components/entities/offer-status-switcher";
import { OfferIntelTabs } from "@/components/offers/offer-intel-tabs";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getDictionary(lang);
  const d = t.entities.offers.detail;

  const landingColumns: Array<Column<LandingPage>> = [
    { header: t.common.misc.name, render: (lp) => lp.name },
    {
      header: d.landingColumns.url,
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
    { header: d.landingColumns.domain, render: (lp) => lp.domain },
    {
      header: t.common.misc.status,
      render: (lp) => <StatusBadge value={lp.status} />,
    },
  ];

  let offer: Offer | null = null;
  let landingPages: LandingPage[] = [];
  let error: string | null = null;
  try {
    const [o, lp] = await Promise.all([
      entityApi.offers.get(id),
      entityApi.offers.listLandingPages(id, 1, 50),
    ]);
    offer = o;
    landingPages = lp.items;
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  if (error || !offer) {
    return (
      <div className="mx-auto max-w-5xl">
        <EntityPageHeader
          title={t.common.nav.offers}
          description={d.description}
        />
        <ErrorState
          message={error ?? d.notFound}
          title={t.common.error.title}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <EntityPageHeader
        title={offer.name}
        description={d.headerDescription(offer.network)}
      />
      <DetailList
        items={[
          { label: t.common.misc.name, value: offer.name },
          { label: d.labels.network, value: offer.network },
          {
            label: t.common.misc.status,
            value: <StatusBadge value={offer.status} />,
          },
          { label: d.labels.priority, value: String(offer.priority) },
          {
            label: d.labels.destinationUrl,
            value: (
              <a
                href={offer.destinationUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-signal hover:underline"
              >
                {offer.destinationUrl}
              </a>
            ),
          },
          { label: d.labels.startsAt, value: formatDateTime(offer.startsAt) },
          { label: d.labels.endsAt, value: formatDateTime(offer.endsAt) },
          { label: t.common.misc.created, value: formatDateTime(offer.createdAt) },
          { label: t.common.misc.updated, value: formatDateTime(offer.updatedAt) },
        ]}
      />
      <OfferStatusSwitcher offerId={offer.id} current={offer.status} />
      <SectionTitle>{t.common.nav.landingPages}</SectionTitle>
      <DataTable<LandingPage>
        columns={landingColumns}
        rows={landingPages}
        emptyText={d.landingEmpty}
      />
      {/* Offer Intelligence (Phase 1): additive tabs, existing content above untouched. */}
      <SectionTitle>{t.ai.intel.tabs.sectionTitle}</SectionTitle>
      <OfferIntelTabs offerId={offer.id} />
    </div>
  );
}
