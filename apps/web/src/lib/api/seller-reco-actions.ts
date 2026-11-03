"use server";

/**
 * 卖家工具 AI 推荐 — server action（客户端组件经此调用后端，绝不直连 API）。
 * 后端：POST /api/v1/ai/seller-recommendations（DataForSEO SERP 证据 +
 * 大模型综合）。返回的候选只是“线索”，导入后仍是待核实状态。
 */
import {
  EntityApiError,
  getApiBaseUrl,
} from "./entities-config";
import { sessionHeaders } from "./session";

export interface RecoSourcingLink {
  title: string;
  url: string;
  kind: "wholesale" | "other";
}

export interface RecoCandidate {
  name: string;
  category: string;
  why: string;
  priceHint: number | null;
  sources: string[];
  /** 货源 SERP 结果（≤3 条，批发平台优先）；老版本后端返回时可能缺失。 */
  sourcing?: RecoSourcingLink[];
}

export interface RecoSource {
  title: string;
  url: string;
  snippet: string;
}

export interface RecoResult {
  candidates: RecoCandidate[];
  sources: RecoSource[];
  queries: string[];
  sourcingQueries?: string[];
  serpCalls: number;
  serpCostEstimateUsd: number;
  warnings: string[];
}

export async function requestSellerRecommendationsAction(
  direction: string,
  limit = 5
): Promise<
  | { ok: true; data: RecoResult }
  | { ok: false; error: string }
> {
  try {
    const base = getApiBaseUrl();
    const headers = await sessionHeaders();
    const res = await fetch(`${base}/api/v1/ai/seller-recommendations`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ direction, limit }),
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as {
          message?: string;
          error?: string;
        };
        detail = body.message ?? body.error ?? "";
      } catch {
        /* ignore */
      }
      throw new EntityApiError(
        res.status,
        detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`
      );
    }
    const data = (await res.json()) as RecoResult;
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "推荐失败，请稍后重试。",
    };
  }
}
