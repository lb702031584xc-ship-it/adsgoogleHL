import { getLang } from "@/i18n/lang";
import { RewriteClient } from "@/components/ai/rewrite-client";

export const dynamic = "force-dynamic";

/** Task 4 — AI 改写部署工作台：选来源 → 填改写条件 → 看 diff/预览 → 一键部署为新落地页。 */
export default async function LanderRewritePage() {
  const lang = await getLang();
  return <RewriteClient lang={lang} />;
}
