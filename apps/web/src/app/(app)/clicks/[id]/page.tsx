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
} from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

function mono(value: string | null | undefined) {
  return value ?? "—";
}

export default async function ClickDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getDictionary(lang);
  const d = t.entities.clicks.detail;

  let error: string | null = null;
  let click: Awaited<ReturnType<typeof entityApi.clicks.get>> | null = null;
  try {
    click = await entityApi.clicks.get(id);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  if (error || !click) {
    return (
      <section className="max-w-4xl">
        <EntityPageHeader
          title={d.title}
          description={t.entities.clicks.description}
        />
        <ErrorState
          message={error ?? d.notFound}
          title={t.common.error.title}
        />
        <p className="mt-4">
          <Link href="/clicks" className="text-sm text-signal hover:underline">
            {d.backToList}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-4xl">
      <p className="text-sm">
        <Link href="/clicks" className="text-ink/60 hover:underline">
          ← {t.common.nav.clicks}
        </Link>
      </p>
      <EntityPageHeader
        title={d.title}
        description={t.entities.clicks.description}
      />
      <DetailList
        items={[
          { label: d.labels.clickId, value: mono(click.clickId), mono: true },
          { label: t.common.misc.id, value: mono(click.id), mono: true },
          {
            label: d.labels.trackingLink,
            value: (
              <Link
                href={`/tracking-links/${click.trackingLinkId}`}
                className="font-mono text-signal hover:underline"
              >
                {click.trackingLinkId}
              </Link>
            ),
            mono: true,
          },
          { label: d.labels.offerId, value: mono(click.offerId), mono: true },
          { label: d.labels.landingPageId, value: mono(click.landingPageId), mono: true },
          { label: d.labels.gclid, value: mono(click.gclid), mono: true },
          { label: d.labels.gbraid, value: mono(click.gbraid), mono: true },
          { label: d.labels.wbraid, value: mono(click.wbraid), mono: true },
          { label: d.labels.utmSource, value: mono(click.utmSource) },
          { label: d.labels.utmMedium, value: mono(click.utmMedium) },
          { label: d.labels.utmCampaign, value: mono(click.utmCampaign) },
          { label: d.labels.utmTerm, value: mono(click.utmTerm) },
          { label: d.labels.utmContent, value: mono(click.utmContent) },
          { label: d.labels.userAgent, value: mono(click.userAgent) },
          { label: d.labels.ipAddress, value: mono(click.ipAddress), mono: true },
          { label: d.labels.referer, value: mono(click.referer) },
          { label: d.labels.country, value: mono(click.country) },
          { label: d.labels.region, value: mono(click.region) },
          { label: d.labels.city, value: mono(click.city) },
          { label: d.labels.deviceType, value: mono(click.deviceType) },
          { label: d.labels.occurredAt, value: formatDateTime(click.occurredAt) },
          { label: t.common.misc.created, value: formatDateTime(click.createdAt) },
        ]}
      />
    </section>
  );
}
