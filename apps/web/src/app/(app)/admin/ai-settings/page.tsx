import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";

export const dynamic = "force-dynamic";

/** Admin-only: configure the AI provider used by the analysis workbench. */
export default async function AiSettingsPage() {
  const lang = await getLang();
  const t = getDictionary(lang);

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const res = await getAiSettingsAction();
  if (!res.ok) {
    return (
      <div>
        <EntityPageHeader
          title={t.ai.admin.settings.title}
          description={t.ai.admin.settings.description}
        />
        <ErrorState title={t.common.error.title} message={res.error} />
      </div>
    );
  }

  return <AiSettingsForm initial={res.data} />;
}
