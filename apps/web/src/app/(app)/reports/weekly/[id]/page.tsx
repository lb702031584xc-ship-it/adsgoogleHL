import { notFound } from "next/navigation";
import { WeeklyReportDetailClient } from "@/components/weekly-report/weekly-report-detail-client";
import { getWeeklyReportAction } from "@/lib/api/weekly-report-actions";

export const dynamic = "force-dynamic";

/** Automation round 2 — weekly report detail. */
export default async function WeeklyReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getWeeklyReportAction(id);
  if (!res.ok) {
    notFound();
  }
  return <WeeklyReportDetailClient report={res.data} />;
}
