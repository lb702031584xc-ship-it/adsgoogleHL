import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/research";
import { ResearchListClient } from "@/components/research/research-client";

export const dynamic = "force-dynamic";

/** Research Lab test list: /research */
export default async function ResearchPage() {
  const dict = (await getLang()) === "en" ? en : zh;
  return <ResearchListClient dict={dict} />;
}
