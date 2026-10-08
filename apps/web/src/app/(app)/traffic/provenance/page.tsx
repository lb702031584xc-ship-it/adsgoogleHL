import { ProvenanceClient } from "@/components/traffic/provenance-client";

export const dynamic = "force-dynamic";

/** Conversion provenance: /traffic/provenance?conversionId=<id> */
export default async function ProvenancePage({
  searchParams,
}: {
  searchParams: Promise<{ conversionId?: string }>;
}) {
  const params = await searchParams;
  return (
    <ProvenanceClient
      initialConversionId={
        typeof params.conversionId === "string" &&
        params.conversionId.trim() !== ""
          ? params.conversionId
          : null
      }
    />
  );
}
