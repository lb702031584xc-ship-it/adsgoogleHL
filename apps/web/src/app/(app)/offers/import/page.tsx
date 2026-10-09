import { redirect } from "next/navigation";

/** Merged into /offers/new (tab). Keep the old URL working. */
export default async function OfferImportPage() {
  redirect("/offers/new?tab=import");
}
