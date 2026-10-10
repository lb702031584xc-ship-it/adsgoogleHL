import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-combo";
import { ComboDetailClient } from "@/components/amazon/combo-detail-client";

export const dynamic = "force-dynamic";

export default async function AmazonComboDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lang = await getLang();
  return <ComboDetailClient dict={lang === "en" ? en : zh} runId={id} />;
}
