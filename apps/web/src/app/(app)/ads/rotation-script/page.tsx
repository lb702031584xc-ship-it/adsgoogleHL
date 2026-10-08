import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/ads-rotation";
import { RotationScriptClient } from "@/components/ads/rotation-script-client";

export const dynamic = "force-dynamic";

/** 方案 B — 直链多广告轮流启停 Script 生成器。 */
export default async function RotationScriptPage() {
  const lang = await getLang();
  return <RotationScriptClient dict={lang === "en" ? en : zh} />;
}
