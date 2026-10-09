/**
 * Amazon discovery shared types (client-safe, no server-only imports).
 */

export interface AmazonScoredProduct {
  asin: string;
  title: string;
  detailPageUrl: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  isPrime: boolean;
  availability: string | null;
  score: number;
  estimatedCommission: number | null;
  reasons: string[];
  /** 品牌名称（后端从产品信息/官网检测中提取，可选） */
  brand?: string | null;
  /** 流量需求门判定结果（后端可选字段，缺失时 UI 不展示该行） */
  trafficGate?: TrafficGate | null;
}

/**
 * 流量需求门（traffic gate）判定结果。
 * 数据口径约定：trends = 热度（0-100 相对值，免费）；
 * similarweb = 月访问量（付费 key）；dataforseo = 月搜索量（付费 key）。
 * 绝不许把相对热度写成绝对流量。
 */
export interface TrafficGateSignal {
  source: "trends" | "similarweb" | "dataforseo";
  label: string;
  value: number | null;
  threshold: number | null;
  passed: boolean | null;
  note?: string;
}

export interface TrafficGateOfficialSite {
  found: boolean;
  domain: string | null;
  confidence: "high" | "medium" | "low";
}

export interface TrafficGate {
  passed: boolean | null;
  reason: string;
  officialSite: TrafficGateOfficialSite | null;
  signals: TrafficGateSignal[];
}
