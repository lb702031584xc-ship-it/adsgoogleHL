import { RateWatchClient } from "@/components/cashback/rate-watch-client";
import { listRateWatchAction } from "@/lib/api/cashback-rate-watch-actions";
import { listCashbackOffersAction } from "@/lib/api/cashback-actions";

export const dynamic = "force-dynamic";

/** 功能 1 — 返利比例监控：offer 列表 + 最新检查状态 + 立即检查。 */
export default async function RateWatchPage() {
  const [checksRes, offersRes] = await Promise.all([
    listRateWatchAction(),
    listCashbackOffersAction(),
  ]);
  const checks = checksRes.ok ? checksRes.data : [];
  const offers = offersRes.ok ? offersRes.data.items : [];
  return <RateWatchClient offers={offers} checks={checks} />;
}
