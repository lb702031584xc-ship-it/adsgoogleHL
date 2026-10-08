import { RedirectCheckClient } from "@/components/cashback/redirect-check-client";
import { listRedirectChecksAction } from "@/lib/api/cashback-redirect-check-actions";

export const dynamic = "force-dynamic";

/** Feature 4 — 跳转链检测：check history + manual full scan. */
export default async function RedirectCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const res = await listRedirectChecksAction(page, 20);
  const initial = res.ok
    ? res.data
    : { total: 0, page, pageSize: 20, rows: [] };
  return <RedirectCheckClient initial={initial} page={page} />;
}
