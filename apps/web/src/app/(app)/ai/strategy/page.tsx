import { entityApi } from "@/lib/api/entities";
import { StrategyClient } from "@/components/strategy/strategy-client";

export const dynamic = "force-dynamic";

/** Phase 5 one-stop strategy page: /ai/strategy */
export default async function StrategyPage() {
  let offers: { id: string; name: string; network: string }[] = [];
  try {
    const data = await entityApi.offers.list(1, 200);
    offers = (data.items ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      network: o.network,
    }));
  } catch {
    /* page still renders; selector will be empty */
  }
  return <StrategyClient offers={offers} />;
}
