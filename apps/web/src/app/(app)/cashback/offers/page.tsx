import { CashbackOffersClient } from "@/components/cashback/offers-client";

export const dynamic = "force-dynamic";

/** Feature 3 — 返利 Offer 列表 + 新增表单（网络选择 / 链接粘贴 / AdsPower 环境下拉）。 */
export default async function CashbackOffersPage() {
  return <CashbackOffersClient />;
}
