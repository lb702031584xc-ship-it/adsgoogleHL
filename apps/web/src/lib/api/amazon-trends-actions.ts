"use server";

/**
 * 热销日历（/amazon/trends）server actions.
 *
 * 后端契约：
 * - GET  /api/v1/amazon/trends/calendar?country=US → { country, countryName, now: { date, hotCategories }, upcoming: [...] }
 * - POST /api/v1/amazon/trends/recommend { country } → { country, countryName, date, categories: [...], cached }
 * 客户端组件通过这里调用，避免 import server-only 模块。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";

export interface TrendsCategoryTag {
  zh: string;
  en: string;
}

export interface TrendsUpcomingHoliday {
  id: string;
  nameZh: string;
  nameEn: string;
  date: string;
  daysLeft: number;
  leadDays: number;
  categories: TrendsCategoryTag[];
  stage: "plan" | "prepare" | "sprint";
  prepAdviceZh: string;
  prepAdviceEn: string;
  note?: string;
}

export interface TrendsCalendar {
  country: string;
  countryName: TrendsCategoryTag;
  now: { date: string; hotCategories: TrendsCategoryTag[] };
  upcoming: TrendsUpcomingHoliday[];
}

export interface TrendsRecommendCategory {
  name: string;
  examples: string[];
  reason: string;
  keywords: string[];
  adAngle: string;
}

export interface TrendsRecommendResult {
  country: string;
  countryName: TrendsCategoryTag;
  date: string;
  categories: TrendsRecommendCategory[];
  cached: boolean;
}

export type TrendsActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

async function callApi<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<TrendsActionResult<T>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      // 忽略解析失败
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, fallback);
  }
}

export async function getTrendsCalendarAction(
  country: string
): Promise<TrendsActionResult<TrendsCalendar>> {
  return callApi<TrendsCalendar>(
    `/api/v1/amazon/trends/calendar?country=${encodeURIComponent(country)}`,
    { method: "GET" },
    "获取节日日历失败。"
  );
}

export async function recommendTrendsAction(
  country: string
): Promise<TrendsActionResult<TrendsRecommendResult>> {
  return callApi<TrendsRecommendResult>(
    "/api/v1/amazon/trends/recommend",
    { method: "POST", body: JSON.stringify({ country }) },
    "AI 推荐生成失败。"
  );
}
