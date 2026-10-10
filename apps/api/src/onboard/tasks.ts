/**
 * "7 天跑起来"任务流（第十二批）：任务定义 + 自动完成检测。
 *
 * 7 天任务：
 *  Day1 连上 PA-API（深链接到 AI 设置 PA-API 配置）
 *  Day2 跑一次选品流水线
 *  Day3 生成第一个落地页
 *  Day4 建跟踪链接
 *  Day5 开第一个广告系列
 *  Day6 看到第一次点击
 *  Day7 复盘（看首单仪表盘）
 *
 * 自动检测优先查真实数据；Day7 只能手动标记。
 * "看到第一次真实点击"即毕业。
 */
import type { PrismaClient } from "@adlinklab/database";

export type AutoCheckKind =
  | "paapi"
  | "pipeline"
  | "landing"
  | "tracking"
  | "campaign"
  | "first_click";

export interface OnboardTaskDef {
  day: number;
  key: string;
  deepLink: string;
  /** null = 只能手动标记完成 */
  autoCheck: AutoCheckKind | null;
}

export const ONBOARD_TASKS: OnboardTaskDef[] = [
  { day: 1, key: "paapi", deepLink: "/admin/ai-settings", autoCheck: "paapi" },
  { day: 2, key: "pipeline", deepLink: "/amazon/pipeline", autoCheck: "pipeline" },
  { day: 3, key: "landing", deepLink: "/landing-pages", autoCheck: "landing" },
  { day: 4, key: "tracking", deepLink: "/tracking-links", autoCheck: "tracking" },
  { day: 5, key: "campaign", deepLink: "/campaigns", autoCheck: "campaign" },
  { day: 6, key: "first_click", deepLink: "/monitoring", autoCheck: "first_click" },
  { day: 7, key: "review", deepLink: "/dashboard", autoCheck: null },
];

/**
 * 自动检测各项任务是否已完成（查真实数据，不抛错）。
 * 返回 key → 是否完成的映射。
 */
export async function detectTaskCompletion(
  prisma: PrismaClient,
  tenantId: string
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const safe = async (fn: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await fn();
    } catch {
      return false;
    }
  };
  const [
    paapi,
    pipeline,
    landing,
    tracking,
    campaign,
    firstClick,
  ] = await Promise.all([
    safe(async () => {
      const row = (await prisma.aiSetting.findUnique({
        where: { key: "amazon.paapiEnc" },
        select: { value: true },
      })) as { value: string } | null;
      return !!(row?.value || process.env.AMAZON_PAAPI_KEY);
    }),
    safe(async () => {
      const n = (await prisma.productPipelineRun.count({ where: { tenantId } })) as number;
      return n > 0;
    }),
    safe(async () => {
      const n = (await prisma.landingPage.count({ where: { tenantId } })) as number;
      return n > 0;
    }),
    safe(async () => {
      const n = (await prisma.trackingLink.count({ where: { tenantId } })) as number;
      return n > 0;
    }),
    safe(async () => {
      const n = (await prisma.campaign.count({ where: { tenantId } })) as number;
      return n > 0;
    }),
    safe(async () => {
      const n = (await prisma.click.count({
        where: { tenantId, isTest: { not: true } },
      })) as number;
      return n > 0;
    }),
  ]);
  out.paapi = paapi;
  out.pipeline = pipeline;
  out.landing = landing;
  out.tracking = tracking;
  out.campaign = campaign;
  out.first_click = firstClick;
  return out;
}
