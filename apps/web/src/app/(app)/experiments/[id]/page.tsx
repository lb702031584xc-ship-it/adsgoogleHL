import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/experiment";
import { ExperimentDetailClient } from "@/components/experiments/experiment-detail-client";

export const dynamic = "force-dynamic";

/** Experiment detail: /experiments/[id] */
export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dict = (await getLang()) === "en" ? en : zh;
  return <ExperimentDetailClient experimentId={id} dict={dict} />;
}
