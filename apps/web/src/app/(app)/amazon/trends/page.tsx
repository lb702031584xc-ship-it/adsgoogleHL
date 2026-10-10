import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-trends";
import { AmazonTrendsClient } from "@/components/amazon/amazon-trends-client";

export const dynamic = "force-dynamic";

/**
 * 热销日历：按国家看当季热销品类、未来 90 天购物节时间线、AI 热销推荐。
 * 挂在 Amazon 选品赛道二级菜单（菜单名"热销日历"）。
 */
export default async function AmazonTrendsPage() {
  const lang = await getLang();
  return <AmazonTrendsClient dict={lang === "en" ? en : zh} />;
}
