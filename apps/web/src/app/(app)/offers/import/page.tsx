import { OfferImportClient } from "@/components/offers/import-client";

export const dynamic = "force-dynamic";

/** Bulk offer import (CSV / JSON / URLs). */
export default async function OfferImportPage() {
  return <OfferImportClient />;
}
