import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/cashback-monitor";
import { listCashbackOffersAction } from "@/lib/api/cashback-actions";
import { listRateWatchAction } from "@/lib/api/cashback-rate-watch-actions";
import {
  listRedirectChecksAction,
  type RedirectCheckHistory,
} from "@/lib/api/cashback-redirect-check-actions";
import { MonitorTabsClient } from "./_components/monitor-tabs-client";

export const dynamic = "force-dynamic";

/**
 * 返利监控统一页面：Offer 列表 + 返利比例监控 + 商家条款监控 +
 * 跳转链检查 + 返利比例对比。
 *
 * 四个功能 tab 复用各自页面已有的 client 组件与 server action，
 * 不重写 API 调用逻辑；旧的四个页面保留不动。
 */
export default async function CashbackMonitorPage() {
  const [offersRes, checksRes, redirectsRes] = await Promise.all([
    listCashbackOffersAction(),
    listRateWatchAction(),
    listRedirectChecksAction(1, 20),
  ]);
  const offers = offersRes.ok ? offersRes.data.items : [];
  const rateChecks = checksRes.ok ? checksRes.data : [];
  const redirectInitial: RedirectCheckHistory = redirectsRes.ok
    ? redirectsRes.data
    : { total: 0, page: 1, pageSize: 20, rows: [] };
  const lang = await getLang();
  const dict = lang === "en" ? en : zh;

  return (
    <MonitorTabsClient
      dict={dict}
      offers={offers}
      rateChecks={rateChecks}
      redirectInitial={redirectInitial}
    />
  );
}
