import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/experiment";
import { ExperimentsClient } from "@/components/experiments/experiments-client";

export const dynamic = "force-dynamic";

/** Experiment list: /experiments */
export default async function ExperimentsPage() {
  const dict = (await getLang()) === "en" ? en : zh;
  return <ExperimentsClient dict={dict} />;
}
