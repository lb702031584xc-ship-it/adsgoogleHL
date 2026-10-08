import { RateCompareClient } from "@/components/cashback/rate-compare-client";

export const dynamic = "force-dynamic";

/** Feature 5 — 返利比价：分组列表 + 分组详情（各家比例横向对比表 + 最高标识 + 立即比价）。 */
export default async function RateComparePage() {
  return <RateCompareClient />;
}
