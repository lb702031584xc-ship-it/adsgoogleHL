import { entityApi } from "@/lib/api/entities";
import { DecisionClient } from "@/components/ai/decision-client";

export const dynamic = "force-dynamic";

/** §32 unified AI decision output. */
export default async function AiDecisionPage() {
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
  return <DecisionClient offers={offers} />;
}
