import { EntityPageHeader } from "@/components/entities/ui";
import { OfferForm } from "@/components/entities/offer-form";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function NewOfferPage() {
  const lang = await getLang();
  const t = getDictionary(lang);

  return (
    <div className="mx-auto max-w-2xl">
      <EntityPageHeader
        title={t.entities.offers.new.title}
        description={t.entities.offers.new.description}
      />
      <OfferForm />
    </div>
  );
}
