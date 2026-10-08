import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { TermsClient } from "@/components/ai/terms-client";

export const dynamic = "force-dynamic";

/** Offer terms parsing + batch screening workbench. */
export default async function AiTermsPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  let showSetupNudge = false;
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok && !settings.data.configured) showSetupNudge = true;
  }

  return <TermsClient isAdmin={isAdmin} showSetupNudge={showSetupNudge} />;
}
