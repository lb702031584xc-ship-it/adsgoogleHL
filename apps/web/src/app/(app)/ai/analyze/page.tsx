import { getCurrentUser } from "@/lib/api/auth";
import {
  getAiSettingsAction,
  listAnalysesAction,
} from "@/lib/api/ai-actions";
import { AnalyzeClient } from "@/components/ai/analyze-client";

export const dynamic = "force-dynamic";

/** AI offer-analysis workbench. */
export default async function AiAnalyzePage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "admin";

  let showSetupNudge = false;
  if (isAdmin) {
    const settings = await getAiSettingsAction();
    if (settings.ok && !settings.data.configured) showSetupNudge = true;
  }

  const historyRes = await listAnalysesAction();
  const history = historyRes.ok ? historyRes.data : [];

  return (
    <AnalyzeClient
      isAdmin={isAdmin}
      showSetupNudge={showSetupNudge}
      initialHistory={history}
    />
  );
}
