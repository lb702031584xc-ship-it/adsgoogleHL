import { BrandCheckClient } from "@/components/ai/brand-check-client";

export const dynamic = "force-dynamic";

/** Brand keyword conflict check: keywords vs brand terms → negatives. */
export default async function AiBrandCheckPage() {
  return <BrandCheckClient />;
}
