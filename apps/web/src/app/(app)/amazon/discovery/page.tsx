import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-discovery";
import { AmazonDiscoveryClient } from "@/components/amazon/discovery-client";

export const dynamic = "force-dynamic";

/** Amazon 自动选品：配置条件 → 抓取 → 评分推荐 → 一键导入 Offer。 */
export default async function AmazonDiscoveryPage() {
  const lang = await getLang();
  return <AmazonDiscoveryClient dict={lang === "en" ? en : zh} />;
}
