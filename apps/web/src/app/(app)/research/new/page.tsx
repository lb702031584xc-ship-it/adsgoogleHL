import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/research";
import { ResearchNewClient } from "@/components/research/research-new-client";

export const dynamic = "force-dynamic";

/** New research test: /research/new */
export default async function ResearchNewPage() {
  const dict = (await getLang()) === "en" ? en : zh;
  return <ResearchNewClient dict={dict} />;
}
