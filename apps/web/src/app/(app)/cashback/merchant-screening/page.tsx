import { MerchantScreeningClient } from "@/components/cashback/merchant-screening-client";

export const dynamic = "force-dynamic";

/** 返利商家粘贴筛选：粘贴 55海淘列表 → 短名单 / 备选 / 排除三档 + 品牌词流量 + 确认最终清单（纯前端）。 */
export default async function MerchantScreeningPage() {
  return <MerchantScreeningClient />;
}
