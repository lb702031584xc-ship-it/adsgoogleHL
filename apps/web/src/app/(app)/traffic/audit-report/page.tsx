import { AuditReportClient } from "@/components/traffic/audit-report-client";

export const dynamic = "force-dynamic";

/** Traffic audit report with filters, totals, sources, and attributions. */
export default async function AuditReportPage() {
  return <AuditReportClient />;
}
