import { getCurrentUser } from "@/lib/api/auth";
import { getAiSettingsAction } from "@/lib/api/ai-actions";
import { ComplianceClient } from "@/components/ai/compliance-client";

export const dynamic = "force-dynamic";

/** Direct-link compliance URL checker. */
export default async function AiCompliancePage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  // getAiSettings is admin-only; members just type their domains per check.
  let initialOwnedDomains: string[] = [];
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok) initialOwnedDomains = settings.data.ownedDomains ?? [];
  }

  return (
    <ComplianceClient
      isAdmin={isAdmin}
      initialOwnedDomains={initialOwnedDomains}
    />
  );
}
