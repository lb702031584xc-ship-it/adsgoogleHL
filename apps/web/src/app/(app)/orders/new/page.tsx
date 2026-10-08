import Link from "next/link";
import { EntityPageHeader } from "@/components/entities/ui";
import { NewOrderForm } from "@/components/entities/order-forms";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const lang = await getLang();
  const t = getDictionary(lang);

  return (
    <section className="max-w-3xl">
      <p className="text-sm">
        <Link href="/orders" className="text-ink/60 hover:underline">
          ← {t.common.nav.orders}
        </Link>
      </p>
      <EntityPageHeader
        title={t.entities.orders.new.title}
        description={t.entities.orders.new.description}
      />
      <NewOrderForm />
    </section>
  );
}
