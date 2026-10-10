import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-watch";
import { AsinWatchClient } from "@/components/amazon/asin-watch-client";

export const dynamic = "force-dynamic";

/**
 * 需求监控（第十批）：ASIN 跟踪 + 每日快照 + 异动通知。
 */
export default async function AmazonWatchPage() {
  const lang = await getLang();
  return <AsinWatchClient dict={lang === "en" ? en : zh} />;
}
