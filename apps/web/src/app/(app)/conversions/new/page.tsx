import Link from "next/link";
import { EntityPageHeader } from "@/components/entities/ui";
import { ConversionForms } from "@/components/entities/conversion-forms";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function NewConversionPage() {
  const lang = await getLang();
  const t = getDictionary(lang);

  return (
    <section className="max-w-3xl">
      <p className="text-sm">
        <Link href="/conversions" className="text-ink/60 hover:underline">
          ← {t.common.nav.conversions}
        </Link>
      </p>
      <EntityPageHeader
        title={t.entities.conversions.new.title}
        description={t.entities.conversions.new.description}
      />
      <ConversionForms />
    </section>
  );
}
