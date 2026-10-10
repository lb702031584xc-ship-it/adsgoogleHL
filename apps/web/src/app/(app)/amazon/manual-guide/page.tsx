import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-manual-guide";
import { AmazonManualGuideClient } from "@/components/amazon/amazon-manual-guide-client";

export const dynamic = "force-dynamic";

/**
 * 无 API 手动选品 SOP：7 天新手引导（定类目 → 扫榜单 → Keepa 验证 → 差评挖掘）。
 * 挂在 Amazon 选品赛道二级菜单（菜单名"手动选品SOP"）。
 */
export default async function AmazonManualGuidePage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <AmazonManualGuideClient dict={l === "en" ? en : zh} lang={l} />;
}
