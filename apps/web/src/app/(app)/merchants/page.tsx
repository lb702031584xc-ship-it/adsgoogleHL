import { MerchantsClient } from "@/components/merchants/merchants-client";

export const dynamic = "force-dynamic";

/** Merchant profiles with risk scores + affiliate-network management. */
export default async function MerchantsPage() {
  return <MerchantsClient />;
}
