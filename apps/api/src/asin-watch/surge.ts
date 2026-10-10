/**
 * ASIN 需求异动判定（第十批，纯函数）。
 *
 * PA-API 实际返回无 BSR 字段（见 networks/amazon-adapter.ts：只有
 * CustomerReviews.Count / StarRating），用评论数增速做需求代理。
 *
 * 异动规则（满足任一即异动）：
 *  1. 绝对增长：new - old >= growthAbs（如 +500 条）
 *  2. 相对增长：old > 0 且 (new - old) / old * 100 >= growthPct（如 +50%）
 */
export interface SurgeThresholds {
  growthPct: number;
  growthAbs: number;
}

export const DEFAULT_SURGE_THRESHOLDS: SurgeThresholds = {
  growthPct: 50,
  growthAbs: 500,
};

export interface SurgeResult {
  surged: boolean;
  growthPct: number | null;
  growthAbs: number | null;
  reason: string | null;
}

export function detectSurge(
  oldReviewCount: number | null | undefined,
  newReviewCount: number | null | undefined,
  thresholds: SurgeThresholds = DEFAULT_SURGE_THRESHOLDS
): SurgeResult {
  const noData: SurgeResult = {
    surged: false,
    growthPct: null,
    growthAbs: null,
    reason: null,
  };
  if (oldReviewCount == null || newReviewCount == null) return noData;
  const growthAbs = newReviewCount - oldReviewCount;
  const growthPct =
    oldReviewCount > 0
      ? Math.round((growthAbs / oldReviewCount) * 1000) / 10
      : null;
  const result: SurgeResult = {
    surged: false,
    growthPct,
    growthAbs,
    reason: null,
  };
  if (growthAbs >= thresholds.growthAbs) {
    result.surged = true;
    result.reason = `7 天评论增长 +${growthAbs} 条（≥${thresholds.growthAbs} 条）`;
    return result;
  }
  if (
    growthPct !== null &&
    growthPct >= thresholds.growthPct &&
    growthAbs > 0
  ) {
    result.surged = true;
    result.reason = `7 天评论增长 +${growthPct}%（≥${thresholds.growthPct}%）`;
    return result;
  }
  return result;
}
