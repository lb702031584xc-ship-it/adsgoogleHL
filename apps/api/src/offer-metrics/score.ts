/**
 * Offer 推荐指数（0-100）：基于抓取到的真实指标加权，公式透明。
 *
 * 分项（只对有数据的分项计分；无任何可用指标 → score null，不编分）：
 *  - rating（权重 40%）：rating / 5 * 100
 *  - reviewCount（权重 35%）：min(100, log10(n+1) / 4 * 100)   // 约 1 万条评论拿满
 *  - soldCount（权重 25%）：min(100, log10(n+1) / 5 * 100)
 *
 * final = 有数据的分项按权重加权平均（权重按实际参与分项归一化）。
 *
 * 等级：
 *  - ≥80 强烈推荐 / 60-79 值得一试 / 40-59 谨慎 / <40 不推荐
 */
import type { OfferMetrics } from "./scrape.js";

export type ScoreGrade = "strong" | "good" | "caution" | "avoid";

export const GRADE_LABEL: Record<ScoreGrade, { zh: string; en: string }> = {
  strong: { zh: "强烈推荐", en: "Highly recommended" },
  good: { zh: "值得一试", en: "Worth trying" },
  caution: { zh: "谨慎", en: "Caution" },
  avoid: { zh: "不推荐", en: "Not recommended" },
};

export interface ScoreBreakdownItem {
  /** 分项 key：rating / reviewCount / soldCount */
  key: string;
  /** 权重（0-1）。 */
  weight: number;
  /** 是否参与计分。 */
  contributed: boolean;
  /** 原始值（未获取时为 null）。 */
  rawValue: number | null;
  /** 分项得分 0-100（未参与时为 null）。 */
  score: number | null;
}

export interface OfferScore {
  /** 0-100 取整；无任何可用指标时为 null。 */
  score: number | null;
  grade: ScoreGrade | null;
  breakdown: ScoreBreakdownItem[];
  /** 参与计分的分项数。 */
  contributedCount: number;
}

const WEIGHTS = { rating: 0.4, reviewCount: 0.35, soldCount: 0.25 } as const;

function ratingScore(rating: number): number {
  return Math.min(100, Math.max(0, (rating / 5) * 100));
}

function reviewCountScore(n: number): number {
  return Math.min(100, (Math.log10(n + 1) / 4) * 100);
}

function soldCountScore(n: number): number {
  return Math.min(100, (Math.log10(n + 1) / 5) * 100);
}

export function gradeFor(score: number): ScoreGrade {
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "caution";
  return "avoid";
}

export function scoreOfferMetrics(m: Pick<OfferMetrics, "rating" | "reviewCount" | "soldCount">): OfferScore {
  const items: ScoreBreakdownItem[] = [
    {
      key: "rating",
      weight: WEIGHTS.rating,
      contributed: m.rating !== null,
      rawValue: m.rating,
      score: m.rating !== null ? Math.round(ratingScore(m.rating) * 10) / 10 : null,
    },
    {
      key: "reviewCount",
      weight: WEIGHTS.reviewCount,
      contributed: m.reviewCount !== null,
      rawValue: m.reviewCount,
      score:
        m.reviewCount !== null
          ? Math.round(reviewCountScore(m.reviewCount) * 10) / 10
          : null,
    },
    {
      key: "soldCount",
      weight: WEIGHTS.soldCount,
      contributed: m.soldCount !== null,
      rawValue: m.soldCount,
      score:
        m.soldCount !== null
          ? Math.round(soldCountScore(m.soldCount) * 10) / 10
          : null,
    },
  ];

  const contributed = items.filter((i) => i.contributed && i.score !== null);
  if (contributed.length === 0) {
    return { score: null, grade: null, breakdown: items, contributedCount: 0 };
  }
  const weightSum = contributed.reduce((s, i) => s + i.weight, 0);
  const weighted =
    contributed.reduce((s, i) => s + (i.score as number) * i.weight, 0) / weightSum;
  const score = Math.round(weighted);
  return { score, grade: gradeFor(score), breakdown: items, contributedCount: contributed.length };
}
