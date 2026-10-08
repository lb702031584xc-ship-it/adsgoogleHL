import { dashboardApi } from "@/lib/api/dashboard";
import { mapDashboardErrorMessage } from "@/lib/api/dashboard-config";
import { getLang } from "@/i18n/lang";
import { ScriptDashboardClient } from "@/components/dashboard/script-dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const lang = await getLang();
  let initialError: string | null = null;
  let summary = null;
  let detail = null;
  let targets: Awaited<
    ReturnType<typeof dashboardApi.getTargets>
  >["items"] = [];
  let logs = null;

  try {
    summary = await dashboardApi.getSummary();
    const integrationId = summary.integration.integrationId;
    if (integrationId) {
      const [detailRes, targetsRes, logsRes] = await Promise.all([
        dashboardApi.getIntegration(integrationId),
        dashboardApi.getTargets(integrationId),
        dashboardApi.getLogs(integrationId, { page: 1, pageSize: 20 }),
      ]);
      detail = detailRes;
      targets = targetsRes.items;
      logs = logsRes;
    }
  } catch (error) {
    initialError = mapDashboardErrorMessage(error, lang);
  }

  return (
    <ScriptDashboardClient
      initialSummary={summary}
      initialDetail={detail}
      initialTargets={targets}
      initialLogs={logs}
      initialError={initialError}
    />
  );
}
