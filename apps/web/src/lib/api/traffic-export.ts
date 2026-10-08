/**
 * Client-safe Traffic Intelligence export helpers.
 * CSV downloads go straight to the backend (`?format=csv`) via a plain
 * <a href>; JSON exports are serialised from the already-fetched report in
 * the browser. This module must stay free of server-only imports so client
 * components can use it.
 */
import type { AuditReportParams } from "./traffic-intel";

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
}

export function getProvenanceExportUrl(
  conversionId: string,
  format: "csv"
): string {
  return `${apiBaseUrl()}/api/v1/traffic/provenance/${encodeURIComponent(
    conversionId
  )}/export?format=${format}`;
}

export function getAuditReportExportUrl(
  params: AuditReportParams,
  format: "csv"
): string {
  const qs = new URLSearchParams();
  if (params.merchantId) qs.set("merchantId", params.merchantId);
  if (params.offerId) qs.set("offerId", params.offerId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  qs.set("format", format);
  return `${apiBaseUrl()}/api/v1/traffic/audit-report/export?${qs.toString()}`;
}

/** Trigger a client-side JSON download of an already-fetched report. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
