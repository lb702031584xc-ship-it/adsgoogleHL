"use server";

/**
 * 流量需求门（traffic gate）server actions.
 *
 * 后端契约：POST /api/v1/traffic/gate
 *   body: { brand?: string, domain?: string, keywords?: string[], geo?: string }
 *   返回 TrafficGate { passed, reason, officialSite, signals }
 * 只做检测展示，不落库。客户端组件通过这里调用，避免 import server-only 模块。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import type { TrafficGate } from "./amazon-types";

export interface TrafficGateInput {
  brand?: string;
  title?: string;
  domain?: string;
  keywords?: string[];
  geo?: string;
  /** 用户手动输入的月访问量（正整数）；后端以它为准判定 */
  manualMonthlyVisits?: number;
}

export type TrafficGateActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

export async function checkTrafficGateAction(
  input: TrafficGateInput
): Promise<TrafficGateActionResult<TrafficGate>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/traffic/gate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `检测失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as TrafficGate;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "检测结果解析失败。");
  }
}

/** 截图 OCR 识别出的指标（识别值，需人工核对）。 */
export interface OcrMetrics {
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  currency: string | null;
  soldCount: number | null;
  confidence: number | null;
  needsReview: true;
}

/**
 * 截图 OCR 识别（第四批）。
 * 后端契约：POST /api/v1/offer-metrics/ocr（multipart 单图 ≤8MB）
 *   → OcrMetrics；识别失败 422。
 * 图片只转发给后端在内存里处理，不落盘。
 */
export async function ocrScreenshotAction(
  formData: FormData
): Promise<TrafficGateActionResult<OcrMetrics>> {
  const file = formData.get("screenshot");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "请先选择一张截图。" };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "只接受图片文件。" };
  }
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  const out = new FormData();
  out.append("screenshot", file, file.name || "screenshot.png");
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/offer-metrics/ocr`, {
      method: "POST",
      headers: { ...authHeaders },
      body: out,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `识别失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as OcrMetrics;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "识别结果解析失败。");
  }
}
