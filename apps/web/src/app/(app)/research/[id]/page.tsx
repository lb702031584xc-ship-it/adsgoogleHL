import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/research";
import { ResearchDetailClient } from "@/components/research/research-detail-client";

export const dynamic = "force-dynamic";

/** Research test detail: /research/[id] */
export default async function ResearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dict = (await getLang()) === "en" ? en : zh;
  return <ResearchDetailClient testId={id} dict={dict} />;
}
