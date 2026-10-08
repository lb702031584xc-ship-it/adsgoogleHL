import Link from "next/link";
import { EntityPageHeader } from "@/components/entities/ui";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { NewRequestForm } from "./new-request-form";

export const dynamic = "force-dynamic";

export default async function NewChangeRequestPage() {
  const lang = await getLang();
  const t = getDictionary(lang);
  return (
    <div className="mx-auto max-w-6xl">
      <EntityPageHeader
        title={t.ops.newChangeRequest.title}
        description={t.ops.newChangeRequest.description}
        actions={
          <Link
            href="/url-versions"
            className="rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-ink/5"
          >
            {t.ops.backToUrlVersions}
          </Link>
        }
      />
      <NewRequestForm />
    </div>
  );
}
