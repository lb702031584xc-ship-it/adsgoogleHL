import Link from "next/link";
import {
  DetailList,
  EntityPageHeader,
  ErrorState,
  StatusBadge,
} from "@/components/entities/ui";
import { entityApi } from "@/lib/api/entities";
import {
  formatDateTime,
  mapEntityErrorMessage,
} from "@/lib/api/entities-config";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { RequestLifecycleActions } from "./request-actions";

export const dynamic = "force-dynamic";

export default async function ChangeRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const lang = await getLang();
  const t = getDictionary(lang);
  const { id } = await params;

  let request: Awaited<
    ReturnType<typeof entityApi.urlChangeRequests.get>
  > | null = null;
  let error: string | null = null;

  try {
    request = await entityApi.urlChangeRequests.get(id);
  } catch (e) {
    error = mapEntityErrorMessage(e, lang);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <EntityPageHeader
        title={t.ops.changeRequest.title}
        description={t.ops.changeRequest.description}
        actions={
          <Link
            href="/url-versions"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {t.ops.backToUrlVersions}
          </Link>
        }
      />

      {error ? <ErrorState message={error} title={t.common.error.title} /> : null}

      {request ? (
        <>
          <DetailList
            items={[
              { label: t.common.misc.id, value: request.id, mono: true },
              { label: t.ops.labels.entityType, value: request.entityType },
              { label: t.ops.labels.entityId, value: request.entityId, mono: true },
              { label: t.ops.changeRequest.detail.toVersionId, value: request.toVersionId, mono: true },
              {
                label: t.common.misc.status,
                value: <StatusBadge value={request.status} />,
              },
              { label: t.ops.labels.reason, value: request.reason },
              { label: t.ops.labels.requestedBy, value: request.requestedBy },
              { label: t.common.misc.created, value: formatDateTime(request.createdAt) },
              { label: t.common.misc.updated, value: formatDateTime(request.updatedAt) },
            ]}
          />
          <RequestLifecycleActions id={request.id} />
        </>
      ) : null}
    </div>
  );
}
