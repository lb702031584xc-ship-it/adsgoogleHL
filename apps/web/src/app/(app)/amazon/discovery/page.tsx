import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-discovery";
import { AmazonDiscoveryClient } from "@/components/amazon/discovery-client";

export const dynamic = "force-dynamic";

/** Amazon 自动选品：配置条件 → 抓取 → 评分推荐 → 一键导入 Offer。 */
export default async function AmazonDiscoveryPage({
  searchParams,
}: {
  searchParams?: Promise<{ keyword?: string }>;
}) {
  const lang = await getLang();
  // 热销日历"去选品"跳转带 ?keyword=xxx，预填关键词输入框。
  const sp = (await searchParams) ?? {};
  const initialKeyword =
    typeof sp.keyword === "string" ? sp.keyword.slice(0, 100) : "";
  return (
    <AmazonDiscoveryClient
      dict={lang === "en" ? en : zh}
      initialKeyword={initialKeyword}
    />
  );
}
