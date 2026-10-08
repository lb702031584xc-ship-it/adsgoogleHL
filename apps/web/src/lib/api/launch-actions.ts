"use server";

/**
 * 上线向导 server actions：{ok, data} | {ok:false, error}。
 * Client component 只允许 import 本文件（以及类型），绝不能 import
 * ./entities / ./launch / ./ai / ./lander（它们依赖 next/headers，只能服务端）。
 */
import { EntityApiError } from "./entities-config";
import {
  activateLaunchChecklist,
  completeLaunchStep,
  createLaunchChecklist,
  createLaunchTrackingLink,
  getLaunchChecklist,
  listLaunchChecklists,
  type LaunchActivateResult,
  type LaunchChecklist,
  type LaunchDetail,
} from "./launch";
import { entityApi, type Offer, type Paginated } from "./entities";
import { getAnalysis, listAnalyses, type AiAnalysis } from "./ai";
import {
  listLanderTemplates,
  useLanderTemplate,
  type CreatedLandingPage,
  type LanderTemplate,
} from "./lander";
import { requestAdPlan, type AutoCreateResult } from "./ads-auto";

export type LaunchActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): LaunchActionResult<never> {
  if (e instanceof EntityApiError) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: fallback };
}

async function attempt<T>(
  fn: () => Promise<T>,
  fallback: string
): Promise<LaunchActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return mapError(e, fallback);
  }
}

/* ---------- Checklist ---------- */

export async function listLaunchChecklistsAction(): Promise<
  LaunchActionResult<LaunchChecklist[]>
> {
  return attempt(() => listLaunchChecklists(), "加载上线清单失败，请稍后重试。");
}

export async function createLaunchChecklistAction(
  offerId?: string
): Promise<LaunchActionResult<LaunchChecklist>> {
  return attempt(() => createLaunchChecklist(offerId), "创建上线清单失败，请稍后重试。");
}

export async function getLaunchDetailAction(
  id: string
): Promise<LaunchActionResult<LaunchDetail>> {
  return attempt(() => getLaunchChecklist(id), "加载清单详情失败，请稍后重试。");
}

export async function completeLaunchStepAction(
  id: string,
  step: number,
  data: Record<string, unknown>
): Promise<LaunchActionResult<LaunchChecklist>> {
  return attempt(
    () => completeLaunchStep(id, step, data),
    "保存步骤失败，请稍后重试。"
  );
}

export async function createTrackingLinkAction(
  id: string,
  input: { publicId?: string; status?: string }
): Promise<
  LaunchActionResult<{
    trackingLink: LaunchDetail["trackingLink"];
    checklist: LaunchChecklist;
  }>
> {
  return attempt(
    () => createLaunchTrackingLink(id, input),
    "创建追踪链失败，请稍后重试。"
  );
}

export async function activateLaunchAction(
  id: string
): Promise<LaunchActionResult<LaunchActivateResult>> {
  return attempt(() => activateLaunchChecklist(id), "上线失败，请稍后重试。");
}

/* ---------- Wizard step data (reuse existing modules) ---------- */

export async function listOffersAction(
  page = 1,
  pageSize = 50
): Promise<LaunchActionResult<Paginated<Offer>>> {
  return attempt(() => entityApi.offers.list(page, pageSize), "加载 Offer 列表失败。");
}

export async function getOfferAction(
  id: string
): Promise<LaunchActionResult<Offer>> {
  return attempt(() => entityApi.offers.get(id), "加载 Offer 失败。");
}

export async function listAnalysesAction(): Promise<
  LaunchActionResult<AiAnalysis[]>
> {
  return attempt(async () => {
    const summaries = await listAnalyses();
    const full: AiAnalysis[] = [];
    for (const s of summaries.slice(0, 20)) {
      full.push(await getAnalysis(s.id));
    }
    return full;
  }, "加载 AI 分析失败。");
}

export async function listTemplatesAction(): Promise<
  LaunchActionResult<LanderTemplate[]>
> {
  return attempt(async () => {
    const list = await listLanderTemplates(undefined, "zh");
    return list.items ?? [];
  }, "加载模板库失败。");
}

export async function useTemplateAction(
  templateId: string,
  input: { offerId: string; name: string; variables: Record<string, unknown> }
): Promise<LaunchActionResult<CreatedLandingPage>> {
  return attempt(
    () => useLanderTemplate(templateId, { ...input, lang: "zh" }),
    "从模板生成落地页失败。"
  );
}

export async function generateAdPlanAction(
  urls: string[]
): Promise<LaunchActionResult<AutoCreateResult>> {
  return attempt(
    () => requestAdPlan(urls, { language: "en" }),
    "生成广告计划失败，请稍后重试。"
  );
}
