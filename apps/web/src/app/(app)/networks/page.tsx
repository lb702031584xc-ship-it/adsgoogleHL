import { NetworksClient } from "@/components/networks/networks-client";
import { listNetworksAction } from "@/lib/api/network-actions";

export const dynamic = "force-dynamic";

/** Network API framework — affiliate network management + offer staging. */
export default async function NetworksPage() {
  const res = await listNetworksAction();
  const initial = res.ok ? res.data.networks : [];
  const supportedKinds = res.ok ? res.data.supportedKinds : ["impact"];
  return <NetworksClient initial={initial} supportedKinds={supportedKinds} />;
}
