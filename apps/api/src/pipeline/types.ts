/**
 * 选品流水线（第五批）类型定义。
 *
 * 6 道自动门：
 *  6. denylist — 否定清单门：用户别碰名单命中 / 内置规则（评分<3.5、AI 标记品牌词/政策风险）直接杀
 *  1. quality — 基础质量门：rating ≥ minRating、reviews ≥ minReviews
 *  2. demand   — 需求门：复用流量门 evaluateTrafficGate（含手动值）
 *  3. metrics  — 指标门：复用 offer-metrics 推荐指数（≥ minScore 通过）
 *  4. profit   — 盈亏门：break-even CVR = CPC/佣金；>100% 数学打不平直接杀
 *  5. risk     — 风险门：AI 风控（品牌词/政策风险），high 打回
 *
 * 每道门输出 pass/fail/unknown + 原因；unknown 不杀只降权。
 *
 * 值得测试指数 0-100 = 各门得分加权（权重透明）：
 *  quality 15% / demand 20% / metrics 15% / profit 20% / risk 15% / denylist 15%
 * 门得分映射：pass=100，unknown=50，fail=0。
 * 否定清单门命中 → 直接杀（killed=true），与盈亏门"数学打不平"同级。
 * 机会品（第八批）额外 +10（上限 100），规则透明。
 */
export type GateStatus = "pass" | "fail" | "unknown";

export interface PipelineItemInput {
  asin?: string;
  title: string;
  brand?: string;
  /** Amazon 商品页 URL（无则用 asin 拼 amazon.com/dp/ASIN）。 */
  detailPageUrl?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  /** 手动月访问量（第一批手动值链路，透传给需求门）。 */
  manualMonthlyVisits?: number;
  /** 机会品（第八批）：discovery 机会品模式检出，指数 +10（上限 100）。 */
  opportunity?: boolean;
}

export interface PipelineOptions {
  /** 基础质量门阈值（默认 4.0 / 100）。 */
  minRating?: number;
  minReviews?: number;
  /** 指标门阈值（默认 60）。 */
  minMetricsScore?: number;
  /** 盈亏门：预估 CPC（美元）与单均佣金（美元）。 */
  estimatedCpc?: number;
  commission?: number;
  /** 盈亏门：break-even CVR 上限 %（默认 15；>100 数学打不平直接杀）。 */
  maxBreakEvenCvrPct?: number;
  /** 风险门开关（默认 true；LLM 未配置时 unknown）。 */
  riskCheck?: boolean;
  /** 否定清单内置规则开关（默认 true；页面可关）： */
  /** 评分 < 3.5 直接杀 */
  denyLowRating?: boolean;
  /** AI 风控标记品牌词风险 → 直接杀 */
  denyBrandWord?: boolean;
  /** AI 风控标记政策风险品类 → 直接杀 */
  denyPolicyCategory?: boolean;
  /** Trends geo（默认 US）。 */
  country?: string;
}

export interface GateResult {
  key: "quality" | "demand" | "metrics" | "profit" | "risk" | "denylist";
  status: GateStatus;
  /** 门得分：pass=100 / unknown=50 / fail=0。 */
  score: number;
  reason: string;
  /** 附加数据（调试/展示用）。 */
  detail?: Record<string, unknown>;
}

export interface PipelineItemResult {
  input: PipelineItemInput;
  gates: GateResult[];
  /** 值得测试指数 0-100。 */
  worthIndex: number;
  /** 数学上打不平（profit 门 break-even >100%）→ 直接杀，不建议测试。 */
  killed: boolean;
}

export interface PipelineRunResult {
  items: PipelineItemResult[];
  /** 各门权重（透明）。 */
  weights: Record<string, number>;
  evaluatedAt: string;
}

/**
 * 各门权重（注释 + API 返回 + 页面展示，三处透明）。
 * 批次5追加第 6 道"否定清单门"后重平衡，总和仍为 1。
 */
export const PIPELINE_WEIGHTS = {
  quality: 0.15,
  demand: 0.2,
  metrics: 0.15,
  profit: 0.2,
  risk: 0.15,
  denylist: 0.15,
} as const;

export const GATE_SCORE: Record<GateStatus, number> = {
  pass: 100,
  unknown: 50,
  fail: 0,
};
