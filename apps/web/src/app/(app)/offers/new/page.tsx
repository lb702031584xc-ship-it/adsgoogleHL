import { Suspense } from "react";
import { NewOfferTabs } from "@/components/offers/new-offer-tabs";

export const dynamic = "force-dynamic";

/** Unified offer creation: manual form + bulk import tabs. */
export default async function NewOfferPage() {
  return (
    <Suspense>
      <NewOfferTabs />
    </Suspense>
  );
}
