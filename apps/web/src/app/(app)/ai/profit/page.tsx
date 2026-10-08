import { entityApi } from "@/lib/api/entities";
import { ProfitClient } from "@/components/ai/profit-client";

export const dynamic = "force-dynamic";

/** Profitability calculator with real-data backtest. */
export default async function AiProfitPage() {
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
  return <ProfitClient offers={offers} />;
}
