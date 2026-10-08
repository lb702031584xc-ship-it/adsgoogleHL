import { MonitoringClient } from "@/components/monitoring/monitoring-client";

export const dynamic = "force-dynamic";

/** Traffic quality monitoring: rules, alerts, auto-pause. */
export default async function MonitoringPage() {
  return <MonitoringClient />;
}
