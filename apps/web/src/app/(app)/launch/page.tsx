import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/launch";
import { LaunchWizardClient } from "@/components/launch/launch-wizard-client";
import { entityApi } from "@/lib/api/entities";
import { listLaunchChecklists } from "@/lib/api/launch";

export const dynamic = "force-dynamic";

/** Offer 上线一条龙向导：server component 拉数据，client 组件做步骤切换。 */
export default async function LaunchPage() {
  const lang = await getLang();
  const [offersPage, checklists] = await Promise.all([
    entityApi.offers.list(1, 50),
    listLaunchChecklists(),
  ]);
  return (
    <LaunchWizardClient
      dict={lang === "en" ? en : zh}
      offers={offersPage.items}
      initialChecklists={checklists}
    />
  );
}
