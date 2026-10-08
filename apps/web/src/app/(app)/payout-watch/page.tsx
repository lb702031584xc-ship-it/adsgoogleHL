import { PayoutWatchClient } from "@/components/payout-watch/payout-watch-client";

export const dynamic = "force-dynamic";

/** Automation pack ③ — payout (commission) change monitoring. */
export default async function PayoutWatchPage() {
  return <PayoutWatchClient />;
}
