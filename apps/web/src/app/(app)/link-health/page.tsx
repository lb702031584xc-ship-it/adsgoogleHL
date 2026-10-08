import { DeadLinkClient } from "@/components/link-health/link-health-client";
import { listLinkHealthHistoryAction } from "@/lib/api/dead-link-actions";

export const dynamic = "force-dynamic";

/** Automation pack ① — dead link monitor: check history + manual scan. */
export default async function LinkHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const res = await listLinkHealthHistoryAction(page, 20);
  const initial = res.ok
    ? res.data
    : { total: 0, page, pageSize: 20, rows: [] };
  return <DeadLinkClient initial={initial} page={page} />;
}
