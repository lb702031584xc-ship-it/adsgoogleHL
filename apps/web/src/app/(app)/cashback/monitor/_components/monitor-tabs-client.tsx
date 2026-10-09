"use client";

/**
 * 返利监控统一页面（/cashback/monitor）的 tab 容器。
 *
 * 五个 tab：Offer 列表 / 返利比例监控 / 商家条款监控 / 跳转链检查 / 返利比例对比。
 * 四个功能 tab 直接复用各自页面已有的 client 组件（内部自带 server action
 * 调用与文案），本组件只做 tab 切换与数据透传。
 *
 * 约束：本组件为 "use client"，绝不 import server-only 模块
 * （next/headers、@/lib/api/entities 等）；mutation 走 server action。
 */
import { useState } from "react";
import { EntityPageHeader } from "@/components/entities/ui";
import { RateWatchClient } from "@/components/cashback/rate-watch-client";
import { TermsWatchClient } from "@/components/cashback/terms-watch-client";
import { RedirectCheckClient } from "@/components/cashback/redirect-check-client";
import { RateCompareClient } from "@/components/cashback/rate-compare-client";
import { MonitorOffersTab } from "./monitor-offers-tab";
import type { CashbackMonitorDict } from "@/i18n/dict/cashback-monitor";
import type { CashbackOffer } from "@/lib/api/cashback";
import type { RateWatchRow } from "@/lib/api/cashback-rate-watch-actions";
import type { RedirectCheckHistory } from "@/lib/api/cashback-redirect-check-actions";

type TabId = "offers" | "rateWatch" | "termsWatch" | "redirectCheck" | "rateCompare";

const TABS: TabId[] = [
  "offers",
  "rateWatch",
  "termsWatch",
  "redirectCheck",
  "rateCompare",
];

export function MonitorTabsClient({
  dict,
  offers,
  rateChecks,
  redirectInitial,
}: {
  dict: CashbackMonitorDict;
  offers: CashbackOffer[];
  rateChecks: RateWatchRow[];
  redirectInitial: RedirectCheckHistory;
}) {
  const [tab, setTab] = useState<TabId>("offers");

  return (
    <div className="space-y-6">
      <EntityPageHeader title={dict.page.title} description={dict.page.description} />

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={dict.page.title}
        className="flex flex-wrap gap-2 border-b border-ink/10 pb-3"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-signal text-white"
                : "border border-ink/15 bg-white text-ink/70 hover:border-ink/40"
            }`}
          >
            {dict.tabs[t]}
          </button>
        ))}
      </div>

      {/* 所有 tab 保持挂载、仅隐藏：切换不丢失各组件本地状态与已加载数据。 */}
      <div hidden={tab !== "offers"}>
        <MonitorOffersTab dict={dict.offers} initialOffers={offers} />
      </div>
      <div hidden={tab !== "rateWatch"}>
        <RateWatchClient offers={offers} checks={rateChecks} />
      </div>
      <div hidden={tab !== "termsWatch"}>
        <TermsWatchClient />
      </div>
      <div hidden={tab !== "redirectCheck"}>
        <RedirectCheckClient initial={redirectInitial} page={redirectInitial.page} />
      </div>
      <div hidden={tab !== "rateCompare"}>
        <RateCompareClient />
      </div>
    </div>
  );
}
