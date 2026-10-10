"use server";

/**
 * Amazon 自动选品 server actions.
 * 客户端组件通过这里调用，避免直接 import server-only 的 api client。
 */
import {
  runAmazonDiscovery,
  importAmazonProducts,
  parseAmazonProductUrl,
  getTrafficThresholds,
  updateTrafficThresholds,
  type AmazonDiscoveryCriteria,
  type TrafficThresholds,
  type ParsedAmazonUrl,
} from "./ai";
import type { AmazonScoredProduct } from "./amazon-types";

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
