import { WeeklyReportListClient } from "@/components/weekly-report/weekly-report-list-client";
import { listWeeklyReportsAction } from "@/lib/api/weekly-report-actions";

export const dynamic = "force-dynamic";

/** Automation round 2 — weekly reports: list + manual generation. */
export default async function WeeklyReportsPage() {
  const res = await listWeeklyReportsAction();
  const initial = res.ok ? res.data.reports : [];
  return <WeeklyReportListClient initial={initial} />;
}
