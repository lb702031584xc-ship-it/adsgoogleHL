/**
 * Network API framework — adapter registry.
 *
 * To add a network (e.g. Rakuten): implement `NetworkAdapter` in a new file,
 * then add it to ADAPTERS below. Nothing else changes.
 */
import { ImpactAdapter } from "./impact-adapter.js";
import type { NetworkAdapter } from "./types.js";

export const SUPPORTED_NETWORK_KINDS = ["impact"] as const;
export type SupportedNetworkKind = (typeof SUPPORTED_NETWORK_KINDS)[number];

const ADAPTERS: Record<SupportedNetworkKind, NetworkAdapter> = {
  impact: new ImpactAdapter(),
};

export function getAdapter(kind: string): NetworkAdapter {
  const normalized = kind.trim().toLowerCase();
  const adapter = (ADAPTERS as Record<string, NetworkAdapter>)[normalized];
  if (!adapter) {
    throw new Error(
      `Unsupported network kind "${kind}" (supported: ${SUPPORTED_NETWORK_KINDS.join(", ")})`
    );
  }
  return adapter;
}

export function isSupportedNetworkKind(kind: string): boolean {
  return (SUPPORTED_NETWORK_KINDS as readonly string[]).includes(
    kind.trim().toLowerCase()
  );
}

export { ImpactAdapter } from "./impact-adapter.js";
export type { AdapterContext, NetworkAdapter, NetworkOffer } from "./types.js";
