import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/keyword-starter";
import { KeywordStarterClient } from "@/components/keywords/keyword-starter-client";

export const dynamic = "force-dynamic";

/**
 * 类目关键词启动包（第十六批）。
 */
export default async function KeywordStarterPage() {
  const lang = await getLang();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <KeywordStarterClient dict={lang === "en" ? en : zh} lang={lang} />
    </div>
  );
}
