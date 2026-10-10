import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/quickstart";
import { QuickstartClient } from "@/components/onboard/quickstart-client";
import { SopPack } from "@/components/onboard/sop-pack";

export const dynamic = "force-dynamic";

/**
 * "7 天跑起来"任务流（第十二批）+ 开户 SOP 包（第十四批，并入 Day1）。
 */
export default async function QuickstartPage() {
  const lang = await getLang();
  const dict = lang === "en" ? en : zh;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <QuickstartClient dict={dict} />
      <SopPack dict={dict} />
    </div>
  );
}
