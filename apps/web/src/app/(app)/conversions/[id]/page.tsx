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
import { ConversionLifecycleButtons } from "@/components/entities/conversion-lifecycle";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

function mono(value: string | null | undefined) {
  return value ?? "—";
}

export default async function ConversionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  const t = getDictionary(lang);
  const d = t.entities.conversions.detail;

  let error: string | null = null;
  let conversion: Awaited<
    ReturnType<typeof entityApi.conversions.get>
  > | null = null;
  try {
    conversion = await entityApi.conversions.get(id);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  if (error || !conversion) {
    return (
      <section className="max-w-4xl">
        <EntityPageHeader
          title={d.title}
          description={t.entities.conversions.description}
        />
        <ErrorState
          message={error ?? d.notFound}
          title={t.common.error.title}
        />
        <p className="mt-4">
          <Link
            href="/conversions"
            className="text-sm text-signal hover:underline"
          >
            {d.backToList}
          </Link>
        </p>
      </section>
    );
  }

  const valueDisplay =
    conversion.value == null || conversion.value === ""
      ? "—"
      : conversion.currency
        ? `${conversion.value} ${conversion.currency}`
        : conversion.value;

  return (
    <section className="max-w-4xl">
      <p className="text-sm">
        <Link href="/conversions" className="text-ink/60 hover:underline">
          ← {t.common.nav.conversions}
        </Link>
      </p>
      <EntityPageHeader
        title={d.title}
        description={t.entities.conversions.description}
      />
      <DetailList
        items={[
          { label: t.common.misc.id, value: mono(conversion.id), mono: true },
          { label: d.labels.clickId, value: mono(conversion.clickId), mono: true },
          { label: d.labels.conversionAction, value: mono(conversion.conversionAction) },
          {
            label: d.labels.conversionTime,
            value: formatDateTime(conversion.conversionTime),
          },
          { label: d.labels.value, value: valueDisplay },
          {
            label: t.common.misc.status,
            value: <StatusBadge value={conversion.status} />,
          },
          {
            label: d.labels.uploadStatus,
            value: <StatusBadge value={conversion.googleUploadStatus} />,
          },
          { label: d.labels.gclid, value: mono(conversion.gclid), mono: true },
          { label: d.labels.orderId, value: mono(conversion.orderId), mono: true },
          { label: t.common.misc.created, value: formatDateTime(conversion.createdAt) },
          { label: t.common.misc.updated, value: formatDateTime(conversion.updatedAt) },
        ]}
      />
      <SectionTitle>{d.uploadLifecycle}</SectionTitle>
      <div className="mt-4">
        <ConversionLifecycleButtons id={conversion.id} />
      </div>
      <p className="mt-6">
        <Link
          href={`/traffic/provenance?conversionId=${encodeURIComponent(conversion.id)}`}
          className="inline-block rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
        >
          {d.viewProvenance}
        </Link>
      </p>
    </section>
  );
}
