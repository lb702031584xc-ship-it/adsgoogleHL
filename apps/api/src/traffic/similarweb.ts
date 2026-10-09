/**
 * SimilarWeb Official API v1 — 官网绝对流量（付费 key，用户自备）。
 *
 * - key 读 AiSetting `traffic.similarwebKey`（加密）；无 key → 所有方法返回 null。
 * - getMonthlyVisits：取上一个完整自然月的 visits（country=us, granularity=monthly）。
 * - getKeywordVolume：SimilarWeb 不提供关键词搜索量 → 逐项 null（由 DataForSEO 负责）。
 *
 * 任何失败 → null，绝不抛错。
 */
import type { PrismaClient } from "@adlinklab/database";
import { readEncryptedTrafficSetting } from "./settings.js";
import type { TrafficProvider } from "./types.js";

export const SIMILARWEB_KEY_SETTING = "traffic.similarwebKey";

/** 上一个完整自然月的 [start_date, end_date]（YYYY-MM-DD，UTC）。 */
export function lastFullMonthRange(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export class SimilarWebProvider implements TrafficProvider {
  readonly name = "similarweb" as const;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getMonthlyVisits(domain: string): Promise<number | null> {
    const apiKey = await readEncryptedTrafficSetting(
      this.prisma,
      SIMILARWEB_KEY_SETTING
    );
    const cleanDomain = (domain ?? "").trim().toLowerCase();
    if (!apiKey || !cleanDomain) return null;
    try {
      const { start, end } = lastFullMonthRange();
      const url =
        `https://api.similarweb.com/v1/website/${encodeURIComponent(cleanDomain)}` +
        `/traffic-and-engagement/visits` +
        `?api_key=${encodeURIComponent(apiKey)}` +
        `&start_date=${start}&end_date=${end}&country=us&granularity=monthly`;
      const res = await this.fetchImpl(url, {
        headers: { "User-Agent": "AdLinkLab/1.0" },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        visits?: Array<{ visits?: unknown }>;
      };
      const entries = Array.isArray(data?.visits) ? data.visits : [];
      const last = entries[entries.length - 1];
      const visits = last?.visits;
      return typeof visits === "number" && Number.isFinite(visits)
        ? visits
        : null;
    } catch {
      return null;
    }
  }

  async getKeywordVolume(
    keywords: string[]
  ): Promise<Array<{ keyword: string; volume: number | null }>> {
    // SimilarWeb 不提供关键词绝对搜索量，该口径由 DataForSEO 负责。
    return keywords.map((keyword) => ({ keyword, volume: null }));
  }
}
