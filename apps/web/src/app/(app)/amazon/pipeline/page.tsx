import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-pipeline";
import { AmazonPipelineClient } from "@/components/amazon/amazon-pipeline-client";

export const dynamic = "force-dynamic";

/**
 * 选品流水线：5 道自动门评估候选品，值得测试指数排序。
 * 挂在 Amazon 选品赛道二级菜单（菜单名"选品流水线"）。
 */
export default async function AmazonPipelinePage() {
  const lang = await getLang();
  const l = lang === "en" ? "en" : "zh";
  return <AmazonPipelineClient dict={l === "en" ? en : zh} lang={l} />;
}
