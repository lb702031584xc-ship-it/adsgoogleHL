"use server";

/**
 * Amazon 自动选品 server actions.
 * 客户端组件通过这里调用，避免直接 import server-only 的 api client。
 */
import {
  runAmazonDiscovery,
  importAmazonProducts,
  parseAmazonProductUrl,
  getKeepaStatus,
  validateKeepa,
  getKeepaVisionStatus,
  judgeKeepaManual,
  getTrafficThresholds,
  updateTrafficThresholds,
  type AmazonDiscoveryCriteria,
  type TrafficThresholds,
  type ParsedAmazonUrl,
  type KeepaValidateItem,
  type KeepaVisionJudgment,
  type KeepaManualInput,
  type KeepaManualJudgment,
} from "./ai";
import type { AmazonScoredProduct } from "./amazon-types";
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export type AmazonActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error ? e.message : fallback,
  };
}

export async function runAmazonDiscoveryAction(
  criteria: AmazonDiscoveryCriteria
): Promise<
  AmazonActionResult<{
    runId: string;
    products: AmazonScoredProduct[];
    totalFound: number;
    totalKept: number;
    errors: string[];
  }>
> {
  try {
    const data = await runAmazonDiscovery(criteria);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "选品失败，请稍后重试。");
  }
}

export async function importAmazonProductsAction(
  runId: string,
  asins: string[]
): Promise<
  AmazonActionResult<{ imported: Array<{ asin: string; offerId: string }>; count: number }>
> {
  try {
    const data = await importAmazonProducts(runId, asins);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "导入失败，请稍后重试。");
  }
}

export async function getTrafficThresholdsAction(): Promise<
  AmazonActionResult<TrafficThresholds>
> {
  try {
    const data = await getTrafficThresholds();
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "加载流量门阈值失败。");
  }
}

export async function saveTrafficThresholdsAction(
  input: Partial<TrafficThresholds>
): Promise<AmazonActionResult<TrafficThresholds>> {
  try {
    const data = await updateTrafficThresholds(input);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "保存阈值失败，请稍后重试。");
  }
}

export async function parseAmazonProductUrlAction(
  url: string
): Promise<AmazonActionResult<ParsedAmazonUrl>> {
  try {
    const data = await parseAmazonProductUrl(url);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "链接解析失败，请检查链接后重试。");
  }
}

export async function getKeepaStatusAction(): Promise<
  AmazonActionResult<{ hasKey: boolean }>
> {
  try {
    const data = await getKeepaStatus();
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "获取 Keepa 配置状态失败。");
  }
}

export async function validateKeepaAction(
  asins: string[],
  country?: string
): Promise<AmazonActionResult<{ results: KeepaValidateItem[] }>> {
  try {
    const data = await validateKeepa(asins, country);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "Keepa 筛选失败，请稍后重试。");
  }
}

export async function getKeepaVisionStatusAction(): Promise<
  AmazonActionResult<{ llmConfigured: boolean }>
> {
  try {
    const data = await getKeepaVisionStatus();
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "获取 AI 看图配置状态失败。");
  }
}

/**
 * Keepa 截图 AI 看图判断。
 * 后端契约：POST /api/v1/keepa/vision-judge（multipart：price/rank 各 ≤5MB jpeg/png/webp，asin 可选）
 *   → KeepaVisionJudgment；无 LLM 配置/模型不支持 vision → 400。
 * 图片只转发给后端在内存里处理，不落盘。
 */
export async function judgeKeepaVisionAction(
  formData: FormData
): Promise<AmazonActionResult<KeepaVisionJudgment>> {
  const price = formData.get("price");
  const rank = formData.get("rank");
  const asin = formData.get("asin");
  if (
    !(price instanceof File || rank instanceof File) ||
    ((price instanceof File ? price.size : 0) === 0 &&
      (rank instanceof File ? rank.size : 0) === 0)
  ) {
    return { ok: false, error: "请至少上传一张截图（价格历史或排名）。" };
  }
  for (const [label, f] of [
    ["价格图", price],
    ["排名图", rank],
  ] as const) {
    if (f instanceof File && f.size > 0) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
        return { ok: false, error: `${label}只接受 jpeg/png/webp 图片。` };
      }
      if (f.size > 5 * 1024 * 1024) {
        return { ok: false, error: `${label}超过 5MB 上限。` };
      }
    }
  }
  const out = new FormData();
  if (price instanceof File && price.size > 0) out.append("price", price, price.name || "price.png");
  if (rank instanceof File && rank.size > 0) out.append("rank", rank, rank.name || "rank.png");
  if (typeof asin === "string" && asin.trim()) out.append("asin", asin.trim());
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1/keepa/vision-judge`, {
      method: "POST",
      headers: { ...(await sessionHeaders()) },
      body: out,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) {
    redirect("/login");
  }
  if (!res.ok) {
    let message = `AI 看图失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as KeepaVisionJudgment;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "AI 看图结果解析失败。");
  }
}

/**
 * Keepa 手动输入数字判定（"AI 看图"弹窗手动模式）。
 * 后端契约：POST /api/v1/keepa/manual-judge（JSON 数字，纯计算）
 *   → KeepaManualJudgment；非法输入 → 400。
 */
export async function judgeKeepaManualAction(
  input: KeepaManualInput
): Promise<AmazonActionResult<KeepaManualJudgment>> {
  try {
    const data = await judgeKeepaManual(input);
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "手动判断失败，请检查输入后重试。");
  }
}
