import { CashbackRotationsClient } from "@/components/cashback/rotations-client";

export const dynamic = "force-dynamic";

/** Feature 3 — 轮换组配置：选 offers、设权重、启停、手动轮换。 */
export default async function CashbackRotationsPage() {
  return <CashbackRotationsClient />;
}
