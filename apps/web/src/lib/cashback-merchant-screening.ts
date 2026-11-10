/**
 * 返利商家粘贴筛选（cashback merchant screening）纯逻辑。
 *
 * 用户在 55海淘复制一整段商家列表纯文本，粘贴进来后解析 + 筛查，
 * 出短名单 / 备选·待核实 / 排除三档。纯前端，不调任何 API、不碰 Google Ads。
 *
 * 已定口径（2026-11-10 三组实筛结论 + 用户确认，照搬不自创）：
 * - 返利%是给消费者的返现，不是联盟佣金：筛查里绝不拿返利%当佣金率
 *   算单均佣金；佣金只按已知品牌库里可信的佣金率 × 客单价算，没有
 *   依据的一律写"佣金未核实"，不编数字。
 * - 入选门槛二选一：商品价格 ≥ $80，或单均佣金 > $5；目标 ROI ≥ 2。
 * - 硬排除上级联盟 Awin / Impact / CJ；PepperJam = Ascend = Partnerize
 *   同一系统，用户 Ascend 曾被拒，单独标风险不当可用；FlexOffers
 *   用户账号 #1564537 已拒，也标不可用。
 * - unknown 永不判 shortlist。
 * - 品牌词流量（2026-11-08 定规）：无量标"无量"不进主投；"可投"须
 *   有量且 CPC ≤ 盈亏平衡 CPC（单均佣金 ÷ 2，ROI≥2）；CPC 超了标
 *   "超盈亏平衡"；单均佣金未知时不判可投/超标，只显示量和 CPC。
 *   有量判断与展示排序复用 keyword-marks 的 hasVolume /
 *   sortMeasureDisplay，不另写一套。
 */
import { hasVolume } from "@/components/keywords/keyword-marks";

export type RegionCode = "US" | "UK" | "DE" | "CA" | "APAC" | "HK";

export type DemandTier = "strong" | "medium" | "weak" | "veryWeak" | "unknown";

export type Verdict = "shortlist" | "backup" | "excluded";

export type FameLevel = "strong" | "medium" | "weak" | "unknown";

export type GiftFit = "fit" | "general" | "notFit" | "unknown";

export type NetworkStatus = "usable" | "excluded" | "risk" | "unknown";

export interface ParsedMerchant {
  name: string;
  normalizedName: string;
  region: RegionCode | null;
  cashbackPct: number | null;
  cashbackFixedUsd: number | null;
  /** percent = 百分比返利，fixed = 固定金额返利，none = 暂无返利 */
  cashbackKind: "percent" | "fixed" | "none";
  peopleCount: number | null;
  followerCount: number | null;
  /** 粘贴文本里抓到的商品价（$），如套装 $58；£ 价见 priceGbp */
  priceUsd: number | null;
  priceGbp: number | null;
  priceCurrency: "USD" | "GBP" | null;
  notes: string[];
  rawBlock: string;
}

export interface ParseResult {
  merchants: ParsedMerchant[];
  parsedCount: number;
  skippedCount: number;
  skippedLines: string[];
}

/** 2026-11-10 三组实筛写进来的已知品牌库记录。 */
export interface KnownBrandEntry {
  key: string;
  displayName: string;
  /** 美国知名度 + 一句话证据 */
  fame: FameLevel;
  fameEvidence: string;
  priceMinUsd: number | null;
  priceMaxUsd: number | null;
  priceLabel: string;
  networkStatus: NetworkStatus;
  networkLabel: string;
  networkEvidence: string;
  /** 可信才填，否则 null（绝不拿返利%冒充） */
  commissionRatePct: number | null;
  commissionNote: string | null;
  /** 11 月送礼季适配 + 理由 */
  giftFit: GiftFit;
  giftReason: string;
  verdictHint: Verdict;
  /** 判定理由核心（写进结果行） */
  note: string;
  giant?: boolean;
}

export interface ScreenedMerchant extends ParsedMerchant {
  verdict: Verdict;
  reason: string;
  demandTier: DemandTier;
  knownBrand: boolean;
  fame: FameLevel;
  fameEvidence: string;
  priceLabel: string;
  networkStatus: NetworkStatus;
  networkLabel: string;
  estimatedCommissionUsd: number | null;
  commissionBasis: string | null;
  /** 佣金展示文案：如 "4% · 约 $7.12"，未知时为 "未核实" */
  commissionLabel: string;
  giftFit: GiftFit;
  giftReason: string;
  /** 盈亏平衡 CPC = 单均佣金 ÷ 2（ROI≥2），佣金未知时为 null */
  breakevenCpcUsd: number | null;
  keywordMeasure: BrandKeywordMeasure | null;
  keywordVerdict: BrandKeywordVerdict | null;
  keywordNote: string | null;
}

export interface ScreeningResult {
  merchants: ScreenedMerchant[];
  parsedCount: number;
  skippedCount: number;
  skippedLines: string[];
  counts: { shortlist: number; backup: number; excluded: number };
}

// ---------------------------------------------------------------------------
// 品牌词流量
// ---------------------------------------------------------------------------

export interface BrandKeywordMeasure {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: string | null;
  lowTopBid: number | null;
  highTopBid: number | null;
}

export type BrandKeywordVerdict =
  | "no-volume"
  | "investable"
  | "over-breakeven"
  | "unknown";

/**
 * 品牌词流量判定（2026-11-08 定规）：
 * - 无量：searchVolume 为 null / 0（复用 hasVolume：明确 >0 才算有量）。
 * - 可投：有量且 CPC ≤ 盈亏平衡 CPC。
 * - 超盈亏平衡：有量但 CPC > 盈亏平衡 CPC。
 * - 无法判断：有量，但 CPC 或盈亏平衡 CPC 未知（佣金未核实）。
 */
export function brandKeywordVerdict(input: {
  searchVolume: number | null;
  cpc: number | null;
  breakevenCpc: number | null;
}): BrandKeywordVerdict {
  if (!hasVolume(input.searchVolume)) return "no-volume";
  if (input.cpc == null || input.breakevenCpc == null) return "unknown";
  return input.cpc <= input.breakevenCpc ? "investable" : "over-breakeven";
}

/** 品牌名 → 品牌词种子（去地区后缀、小写），如 "Katie Loxton US" → "katie loxton"。 */
export function brandSeedKeyword(displayName: string): string {
  return displayName
    .replace(/\s*\((US|UK|DE|CA|APAC|HK|USA|Canada)\)\s*$/i, "")
    .replace(/\s+(US|UK|DE|CA|APAC|HK|USA)\s*$/i, "")
    .replace(/\s+US\s*&\s*Canada\s*$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * 2026-11-08 DataForSEO 实测过的真数，只作示例行与测试用。
 * 只属于 Ogee / Dooney 这两家，绝不套用到别的品牌上。
 */
export const KNOWN_BRAND_KEYWORD_EXAMPLES: ReadonlyArray<{
  brandKey: string;
  measure: BrandKeywordMeasure;
  note: string;
}> = [
  {
    brandKey: "ogee",
    measure: {
      keyword: "ogee makeup",
      searchVolume: 22000,
      cpc: 2.08,
      competition: null,
      lowTopBid: null,
      highTopBid: null,
    },
    note: "2026-11-08 DataForSEO 实测",
  },
  {
    brandKey: "dooney and bourke",
    measure: {
      keyword: "dooney & bourke bags",
      searchVolume: 27100,
      cpc: 0.56,
      competition: null,
      lowTopBid: null,
      highTopBid: null,
    },
    note: "2026-11-08 DataForSEO 实测",
  },
  {
    brandKey: "dooney and bourke",
    measure: {
      keyword: "dooney outlet",
      searchVolume: 33100,
      cpc: 0.55,
      competition: null,
      lowTopBid: null,
      highTopBid: null,
    },
    note: "2026-11-08 DataForSEO 实测",
  },
];

// ---------------------------------------------------------------------------
// 规范化与工具
// ---------------------------------------------------------------------------

const REGION_SUFFIXES = ["us", "uk", "de", "ca", "apac", "hk", "usa", "canada"];

/** 规范化品牌名：小写、去地区后缀、&→and、去标点、压空格。去重与归属都用它。 */
export function normalizeBrandName(name: string): string {
  let s = name.toLowerCase().trim();
  s = s.replace(/\((us|uk|de|ca|apac|hk|usa|canada)\)/g, " ");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[.'’"]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ");
  const parts = s.split(" ").filter(Boolean);
  while (parts.length > 1 && REGION_SUFFIXES.includes(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

/** 人数分档，只作需求佐证：≥10000 强、1000–9999 中、100–999 弱、<100 极弱、null 未知。 */
export function demandTierFor(peopleCount: number | null): DemandTier {
  if (peopleCount == null) return "unknown";
  if (peopleCount >= 10000) return "strong";
  if (peopleCount >= 1000) return "medium";
  if (peopleCount >= 100) return "weak";
  return "veryWeak";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseCountToken(token: string): number | null {
  const m = token.replace(/,/g, "").match(/^([\d.]+)\s*(万)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] ? Math.round(n * 10000) : n;
}

// ---------------------------------------------------------------------------
// 已知品牌库（2026-11-10 三组实筛结论）
// ---------------------------------------------------------------------------

function entry(e: Omit<KnownBrandEntry, "key">): KnownBrandEntry {
  return { ...e, key: normalizeBrandName(e.displayName) };
}

export const KNOWN_BRANDS: readonly KnownBrandEntry[] = [
  entry({
    displayName: "Eileen Fisher",
    fame: "medium",
    fameEvidence: "美国可持续时尚小众品牌，5,726人获得返利，知名度中强",
    priceMinUsd: 178,
    priceMaxUsd: 228,
    priceLabel: "$178–$228",
    networkStatus: "usable",
    networkLabel: "Rakuten（可用）",
    networkEvidence: "Rakuten 返现页 + 道德时尚品牌列名（间接证据，MID/条款待后台核实）",
    commissionRatePct: 4,
    commissionNote: "第三方口径，待 Rakuten 后台核实",
    giftFit: "general",
    giftReason: "偏正装，节日送礼适配一般",
    verdictHint: "shortlist",
    note: "唯一客单价与预估佣金双过线；需先在 Rakuten 后台核实真实佣金率与品牌词条款",
  }),
  entry({
    displayName: "ROVE Dash Cam",
    fame: "strong",
    fameEvidence: "自称美国领先行车记录仪品牌，R2-4K 亚马逊月销 4,027 台，官网 40,000+ 五星评价",
    priceMinUsd: 129.99,
    priceMaxUsd: 149.99,
    priceLabel: "$129.99–$149.99（只推 $130+ 档）",
    networkStatus: "unknown",
    networkLabel: "未核实（官网自营 5%）",
    networkEvidence: "官网自营计划 5%，55海淘上游链路未核实",
    commissionRatePct: 5,
    commissionNote: "官网自营 5% 口径",
    giftFit: "general",
    giftReason: "行车记录仪是安全刚需，送礼属性一般",
    verdictHint: "shortlist",
    note: "条件性短名单：价格/佣金/知名度三项成立，须先实测 55海淘跳转链确认上级网络 + 品牌词/直链条款；$90 档单均 $4.52 不过线，只推 $130+ 档",
  }),
  entry({
    displayName: "Leatherman",
    fame: "strong",
    fameEvidence: "美国波特兰老牌多功能工具，1983 年起家，户外/EDC 圈认知极高，4.9 万人获得返利",
    priceMinUsd: 99.95,
    priceMaxUsd: 249.95,
    priceLabel: "$99.95–$249.95",
    networkStatus: "risk",
    networkLabel: "PepperJam（风险）",
    networkEvidence: "55海淘链路 PepperJam；PepperJam = Ascend = Partnerize，用户 Ascend 曾被拒",
    commissionRatePct: null,
    commissionNote: "PepperJam 费率查不到；CJ 8% 的公开记录不能当 PepperJam 费率用",
    giftFit: "fit",
    giftReason: "工具类节日礼物很好讲",
    verdictHint: "excluded",
    note: "上级联盟 PepperJam = Ascend 曾被拒，仍是拦路项；另一条已知路径 CJ 也在排除名单，ROI 算不出",
  }),
  entry({
    displayName: "Dooney & Bourke",
    fame: "strong",
    fameEvidence: "美国轻奢包袋品牌，1.3 万人获得返利",
    priceMinUsd: 300,
    priceMaxUsd: 400,
    priceLabel: "$300–$400（约）",
    networkStatus: "risk",
    networkLabel: "PepperJam（风险）",
    networkEvidence: "55海淘链路 PepperJam；PepperJam = Ascend = Partnerize，用户 Ascend 曾被拒",
    commissionRatePct: null,
    commissionNote: "真实佣金率仍未核实",
    giftFit: "fit",
    giftReason: "包袋节日送礼适配好",
    verdictHint: "excluded",
    note: "已在跑（单一系列、三条广告在投），重复不新推；另：PepperJam = Ascend 曾被拒",
  }),
  entry({
    displayName: "Ogee",
    fame: "medium",
    fameEvidence: "美国有机彩妆小众品牌，clean beauty 圈子有名",
    priceMinUsd: 100,
    priceMaxUsd: 100,
    priceLabel: "约 $100（篮子）",
    networkStatus: "usable",
    networkLabel: "Rakuten（可用）",
    networkEvidence: "Rakuten MID 46672",
    commissionRatePct: 3,
    commissionNote: "Rakuten 3.00%，last-click，30 天 cookie，无阶梯",
    giftFit: "general",
    giftReason: "美妆套装/礼盒可作礼品，但佣金太低算不过账",
    verdictHint: "excluded",
    note: "已搁置：3% 佣金、约 $100 篮子，单均约 $3.00，ROI≥2 没有一条词能过，不交加入申请",
  }),
  entry({
    displayName: "SKIMS",
    fame: "strong",
    fameEvidence: "知名度顶级，2 万人获得返利，$148 advent calendar 在售",
    priceMinUsd: 58,
    priceMaxUsd: 80,
    priceLabel: "$58–$80",
    networkStatus: "unknown",
    networkLabel: "未核实（Impact / Rakuten 未分清）",
    networkEvidence: "Impact 与 Rakuten 双轨并存；11-04 Awin 跳转异常无法证实也无法证伪",
    commissionRatePct: null,
    commissionNote: "5%–10% 区间，顶格 10% 才过 $5 线",
    giftFit: "fit",
    giftReason: "节日送礼适配高，advent calendar 在售",
    verdictHint: "backup",
    note: "卡点：上级在 Impact（排除）与 Rakuten（可用）之间未分清，必须实测 55海淘实时跳转链；若是 Rakuten 可升短名单，若是 Impact/Awin 则改排除",
  }),
  entry({
    displayName: "Cecred",
    fame: "strong",
    fameEvidence: "Beyoncé 品牌，Ulta 1400+ 门店在售",
    priceMinUsd: 30,
    priceMaxUsd: 98,
    priceLabel: "$30–$98",
    networkStatus: "unknown",
    networkLabel: "未核实（官网自营 Pro 计划）",
    networkEvidence: "官网为品牌自营 Pro Affiliate 计划，55海淘上级未核实",
    commissionRatePct: 15,
    commissionNote: "官网实证 15%",
    giftFit: "general",
    giftReason: "洗护套装可作礼品，但偏日常消耗",
    verdictHint: "backup",
    note: "卡点：Pro 计划限持证发型师、55海淘上级未核实，先核准入与跳转链再定",
  }),
  entry({
    displayName: "Katie Loxton US",
    fame: "medium",
    fameEvidence: "轻奢礼品品牌，1.4 万人获得返利，时尚组最高",
    priceMinUsd: 59,
    priceMaxUsd: 160,
    priceLabel: "$59–$160（只推 $129+ 款）",
    networkStatus: "usable",
    networkLabel: "Rakuten（可用）",
    networkEvidence: "官网隐私页明文列 Rakuten Advertising；MID/费率/条款未核实",
    commissionRatePct: null,
    commissionNote: "4% 与 1.9% 两源冲突，未核实",
    giftFit: "fit",
    giftReason: "包袋/礼品定位，送礼适配最好",
    verdictHint: "backup",
    note: "卡点：经济账只在 $129+ 高价款成立，先核佣金率",
  }),
  entry({
    displayName: "Bambu Lab",
    fame: "strong",
    fameEvidence: "入门级 3D 打印市场领先，P1S Combo 亚马逊月销 3,000+ 台",
    priceMinUsd: 399,
    priceMaxUsd: 549,
    priceLabel: "$399–$549（主力 P1S / P1S Combo）",
    networkStatus: "unknown",
    networkLabel: "未核实（多网并存）",
    networkEvidence: "ShareASale 记录已关闭不可采信；另有 Awin 商家页、Siteplug 1% 记录；55海淘本链未核实",
    commissionRatePct: null,
    commissionNote: "1% 与 3% 冲突，未核实",
    giftFit: "fit",
    giftReason: "黑五适配度高（黑五至 12 月 1 日，A1 mini $199、P2S $449）",
    verdictHint: "backup",
    note: "卡点：佣金率与网络未核实；若实测链是 Awin 改判排除，若是 1% 则主力款不过 $5 线",
  }),
  entry({
    displayName: "JLab",
    fame: "strong",
    fameEvidence: "自称全美 #1 平价真无线品牌、#1 儿童耳机品牌，2005 年成立于加州圣地亚哥",
    priceMinUsd: 30,
    priceMaxUsd: 69.99,
    priceLabel: "$30–$69.99（只做 $69.99+）",
    networkStatus: "unknown",
    networkLabel: "未核实",
    networkEvidence: "公开搜索未见 Rakuten / Partnerize / Awin / Impact / CJ 的美国计划；55海淘上游未核实",
    commissionRatePct: null,
    commissionNote: "佣金率来源冲突 6 倍以上，无法采信任一",
    giftFit: "fit",
    giftReason: "耳机是典型节日礼物",
    verdictHint: "backup",
    note: "卡点：客单价结构最弱、佣金率未核实；如要推进只做 JBuds Lux（$69.99）及以上型号，并先核实真实佣金率与 SEM 条款",
  }),
  entry({
    displayName: "Baobab Collection USA",
    fame: "medium",
    fameEvidence: "奢华香薰蜡烛品牌，Saks 在售，1,534 人获得返利",
    priceMinUsd: 145,
    priceMaxUsd: 385,
    priceLabel: "$145–$385",
    networkStatus: "excluded",
    networkLabel: "FlexOffers（不可用）",
    networkEvidence: "FlexOffers 8%（美国）/ Skimlinks 10%；用户 FlexOffers 账号 #1564537 已拒",
    commissionRatePct: 8,
    commissionNote: "FlexOffers 8% 口径",
    giftFit: "fit",
    giftReason: "奢华蜡烛送礼季最强",
    verdictHint: "backup",
    note: "卡点：唯一卡在网络不在可用名单（FlexOffers 已拒，Skimlinks 待核接入）；若 Skimlinks 不可用则本组全灭",
  }),
  entry({
    displayName: "Private Internet Access",
    fame: "strong",
    fameEvidence: "美国知名 VPN 品牌",
    priceMinUsd: 56.94,
    priceMaxUsd: 56.94,
    priceLabel: "$56.94（2 年 + 4 月一次付清）",
    networkStatus: "unknown",
    networkLabel: "未核实（Kape 自营）",
    networkEvidence: "Kape 自营 TUNE（HasOffers），另有 FlexOffers；一处称 Impact，来源冲突未核实",
    commissionRatePct: null,
    commissionNote: "80% 只限月付单，不是整单；2 年单标准 33%、续费 24% 的说法未核实",
    giftFit: "general",
    giftReason: "VPN 非实物礼品，但黑五正值 VPN 需求峰",
    verdictHint: "backup",
    note: "卡点：网络不在可用名单内，Kape 直签通道待核实；80% 噱头已拆穿，只限月付单",
  }),
  entry({
    displayName: "Fenty Beauty",
    fame: "strong",
    fameEvidence: "Rihanna 品牌，2.2 万人获得返利，知名度/需求最强",
    priceMinUsd: 40,
    priceMaxUsd: 48,
    priceLabel: "$40–$48（单件）",
    networkStatus: "unknown",
    networkLabel: "未核实（Rakuten / Impact 未分清）",
    networkEvidence: "Rakuten 有注册页证据，Impact 亦多源报",
    commissionRatePct: null,
    commissionNote: "单件佣金低，过线靠未核实的篮子",
    giftFit: "general",
    giftReason: "美妆节日礼盒有需求，但主力单件偏自用",
    verdictHint: "backup",
    note: "卡点：单件佣金低、过线靠未核实的篮子，且网络未分清",
  }),
  entry({
    displayName: "Trish McEvoy",
    fame: "weak",
    fameEvidence: "美国小众彩妆，知名度/人数双垫底（6,533 人获得返利）",
    priceMinUsd: 82,
    priceMaxUsd: 87,
    priceLabel: "$82–$87（Makeup Planner）",
    networkStatus: "excluded",
    networkLabel: "FlexOffers（不可用）",
    networkEvidence: "FlexOffers 官网目录 5%、10 天 cookie；用户 FlexOffers 账号 #1564537 已拒",
    commissionRatePct: 5,
    commissionNote: "FlexOffers 官网 5% 为准；另有 6%/8% 冲突",
    giftFit: "general",
    giftReason: "化妆包/套装可作礼品",
    verdictHint: "excluded",
    note: "主力单品佣金 $4.10–$4.35 不过 $5 线，且 FlexOffers 已拒",
  }),
  entry({
    displayName: "Wildflower Cases",
    fame: "medium",
    fameEvidence: "美国年轻群体知名手机壳品牌，5,151 人获得返利，需求真",
    priceMinUsd: 35,
    priceMaxUsd: 41,
    priceLabel: "$35–$41",
    networkStatus: "usable",
    networkLabel: "Rakuten US（可用）",
    networkEvidence: "Rakuten US（FMTC #53768）；AU 站是 Awin，只做 US 不碰 AU",
    commissionRatePct: null,
    commissionNote: "佣金率未核实；即使按最乐观 7% 算 $37 也仅约 $2.59",
    giftFit: "general",
    giftReason: "手机壳可作小礼物，但单价低",
    verdictHint: "excluded",
    note: "网络可用，但客单价结构性不过线：$35–$41，价格 <$80 且任何合理费率都算不出 >$5",
  }),
  entry({
    displayName: "Roberto Cavalli",
    fame: "strong",
    fameEvidence: "意大利奢侈品牌，美国知名度高，8,001 人获得返利",
    priceMinUsd: 1000,
    priceMaxUsd: 2500,
    priceLabel: "$1,000–$2,500（转售标价）",
    networkStatus: "excluded",
    networkLabel: "FlexOffers（不可用）",
    networkEvidence: "FlexOffers 官网项目页 10%、30 天 cookie，唯一已验证通道；用户 FlexOffers 账号 #1564537 已拒",
    commissionRatePct: 10,
    commissionNote: "FlexOffers 10% 口径",
    giftFit: "fit",
    giftReason: "奢侈品礼品属性强",
    verdictHint: "backup",
    note: "暂缓：佣金数字最漂亮（$56–$100），但 FlexOffers 通道已拒；只查 Rakuten 后台有无同品牌项目，有则核费率与条款，无则搁置",
  }),
  entry({
    displayName: "Currentbody US",
    fame: "medium",
    fameEvidence: "美容仪品牌，美国知名度过关，7,192 人获得返利",
    priceMinUsd: 469.99,
    priceMaxUsd: 569.99,
    priceLabel: "$469.99–$569.99（LED 面罩）",
    networkStatus: "excluded",
    networkLabel: "Awin（排除）",
    networkEvidence: "多源一致为 Awin；条款禁品牌词竞价、禁广告文案/展示 URL 用域名、PPC 直链不付全佣",
    commissionRatePct: null,
    commissionNote: "$8/单、4%、1.8%、6% 来源冲突，不采信",
    giftFit: "fit",
    giftReason: "美容仪是节日大件礼品",
    verdictHint: "excluded",
    note: "上级是排除名单 Awin，且品牌词 PPC 明文禁止",
  }),
  entry({
    displayName: "Thymes",
    fame: "medium",
    fameEvidence: "美国香氛品牌，Frasier Fir 节日蜡烛知名",
    priceMinUsd: 37,
    priceMaxUsd: 78,
    priceLabel: "$37–$78（Frasier Fir 蜡烛）",
    networkStatus: "risk",
    networkLabel: "PepperJam（风险）",
    networkEvidence: "PublisherRest 列 PepperJamNetwork；PepperJam = Ascend = Partnerize，用户 Ascend 曾被拒",
    commissionRatePct: null,
    commissionNote: "佣金率未核实；$58 要过 $5 需费率 >8.6%，无证据",
    giftFit: "fit",
    giftReason: "节日蜡烛送礼最强",
    verdictHint: "excluded",
    note: "节日适配最强，但佣金率未核实、单价低，且唯一网络是曾被拒的 PepperJam 系",
  }),
  entry({
    displayName: "White Fox Boutique US",
    fame: "medium",
    fameEvidence: "美国快时尚女装，2.9 万人获得返利，本组最高，需求热度最高",
    priceMinUsd: 61.31,
    priceMaxUsd: 109.99,
    priceLabel: "均价 $61.31；连衣裙 $69.99–$109.99",
    networkStatus: "excluded",
    networkLabel: "FlexOffers（不可用）",
    networkEvidence: "LinkMyDeals 明文 FlexOffers 分发；无 Rakuten / Partnerize 证据；用户 FlexOffers 账号 #1564537 已拒",
    commissionRatePct: null,
    commissionNote: "1.6% / 2% / 4% 冲突，未核实；验算 $61.31×4%≈$2.45、$109.99×4%≈$4.40，均 <$5",
    giftFit: "general",
    giftReason: "女装节日需求有，但深度 7 折后实售多为 $24–$27",
    verdictHint: "excluded",
    note: "需求热度最高 ≠ 佣金价值：客单价 <$80 且验算佣金均 <$5，网络不在可用名单",
  }),
  entry({
    displayName: "Tenways",
    fame: "weak",
    fameEvidence: "荷兰品牌，美国 2025 年才上线，认知尚浅",
    priceMinUsd: 1499,
    priceMaxUsd: 5499,
    priceLabel: "$1,499–$5,499",
    networkStatus: "excluded",
    networkLabel: "Awin（排除）",
    networkEvidence: "Awin ID 27143；官网亦称最高 6%/30 天 cookie",
    commissionRatePct: 6,
    commissionNote: "Awin 官网最高 6%",
    giftFit: "general",
    giftReason: "电单车是大件，节日礼品属性弱",
    verdictHint: "excluded",
    note: "上级联盟就是 Awin；条款明文：无书面同意不得用品牌词做付费搜索、直接链接不得拿全额佣金；另有部分型号售罄",
  }),
  entry({
    displayName: "Nixon",
    fame: "medium",
    fameEvidence: "1997/1998 年创立于加州 Encinitas，手表小众品牌，nixon.com 访客 51.4% 来自美国",
    priceMinUsd: 150,
    priceMaxUsd: 300,
    priceLabel: "$150–$300（主力）",
    networkStatus: "excluded",
    networkLabel: "Awin（排除）",
    networkEvidence: "Awin 项目 ID 24041，名称与 55海淘条目逐字对应",
    commissionRatePct: 5,
    commissionNote: "Awin 官网默认 5%",
    giftFit: "fit",
    giftReason: "手表是典型节日礼物",
    verdictHint: "excluded",
    note: "价格、佣金、美国小众知名度均过关，但上级联盟是 Awin，一票否决；返利仅 25 人，需求佐证最弱",
  }),
  entry({
    displayName: "Michael Kors Outlet US",
    fame: "strong",
    fameEvidence: "美国轻奢品牌，知名度高，1,362 人获得返利",
    priceMinUsd: 79,
    priceMaxUsd: 199,
    priceLabel: "$79–$199（主力）",
    networkStatus: "excluded",
    networkLabel: "CJ（排除）",
    networkEvidence: "多处均指 CJ 管理、佣金 2%；Awin 只见于 EU 项目；Rakuten 未见直营 MID",
    commissionRatePct: 2,
    commissionNote: "美国 CJ 口径 2%",
    giftFit: "fit",
    giftReason: "包袋节日送礼适配好",
    verdictHint: "excluded",
    note: "上级联盟是 CJ，属排除名单；价格过关、需求最强、送礼适配也好，但网络一票否决",
  }),
  entry({
    displayName: "UGREEN",
    fame: "medium",
    fameEvidence: "充电配件品牌，美国知名度中等",
    priceMinUsd: 10,
    priceMaxUsd: 30,
    priceLabel: "$10–$30（主力配件）",
    networkStatus: "excluded",
    networkLabel: "Awin（排除）",
    networkEvidence: "Awin 官网 UGREEN (Global) 计划最高 15%/60 天；官网 FAQ 亦提 impact.com 报表",
    commissionRatePct: null,
    commissionNote: "佣金率未核实；主力配件客单价低，单均佣金多 <$5",
    giftFit: "general",
    giftReason: "配件偏自用，礼品属性一般",
    verdictHint: "excluded",
    note: "两条硬伤叠加：上级联盟含 Awin，按口径排除；主力配件客单价低，须靠 $100+ 旗舰才达标",
  }),
  entry({
    displayName: "Aiper",
    fame: "medium",
    fameEvidence: "泳池清洁机器人品牌，美国有一定知名度",
    priceMinUsd: 119.99,
    priceMaxUsd: 1999.99,
    priceLabel: "$119.99–$1,999.99（主力 Scuba S1 约 $500–$550）",
    networkStatus: "excluded",
    networkLabel: "Impact（排除）",
    networkEvidence: "FMTC 2026-10-12 最新记录 #58154 为 Impact；旧 ShareASale 已过期",
    commissionRatePct: null,
    commissionNote: "Lasso 称最高 7.5%，未核实",
    giftFit: "notFit",
    giftReason: "11 月泳池淡季；Seagull Pro 2025-03-20 CPSC 召回 32,660 台（充电起火风险），不能主推该型号",
    verdictHint: "excluded",
    note: "最新记录走 Impact（排除网）；11 月泳池淡季、55海淘仅 39 人佐证弱；Seagull Pro 有召回",
  }),
  entry({
    displayName: "MiniTool",
    fame: "medium",
    fameEvidence: "Windows 工具软件品牌，有一定知名度，420 人获得返利",
    priceMinUsd: 59,
    priceMaxUsd: 159,
    priceLabel: "$59–$159/年（Pro $59、Platinum $109、Ultimate $159 终身）",
    networkStatus: "excluded",
    networkLabel: "CJ + Awin（排除）",
    networkEvidence: "官网 affiliate 页原文：available on CJ and Awin networks",
    commissionRatePct: null,
    commissionNote: "第三方称 18%–36%，官方称最高 70%；按 $96.30 第三方 AOV 算曾达 $19.26–$28.89，但网络双排除",
    giftFit: "notFit",
    giftReason: "软件工具非节日礼品",
    verdictHint: "excluded",
    note: "经济学全组最强，但网络双双在排除名单，FlexOffers 另有 listing 也因用户 FlexOffers 已拒而不可用",
  }),
  entry({
    displayName: "Avast",
    fame: "strong",
    fameEvidence: "全球知名杀毒软件品牌",
    priceMinUsd: 60,
    priceMaxUsd: 60,
    priceLabel: "约 $60/单",
    networkStatus: "excluded",
    networkLabel: "CJ（排除）",
    networkEvidence: "多源一致为 CJ，45–60 天 cookie",
    commissionRatePct: null,
    commissionNote: "第三方称 25%–30%，不付续费",
    giftFit: "notFit",
    giftReason: "杀毒软件非节日礼品",
    verdictHint: "excluded",
    note: "CJ 硬排除；12 人返利，需求信号极弱",
  }),
  entry({
    displayName: "AVG",
    fame: "strong",
    fameEvidence: "全球知名杀毒软件品牌，与 Avast 同属 Gen Digital",
    priceMinUsd: 60,
    priceMaxUsd: 60,
    priceLabel: "约 $60/单",
    networkStatus: "excluded",
    networkLabel: "CJ（排除）",
    networkEvidence: "多源一致为 CJ；官网另称经 Impact 最高 30%——CJ 与 Impact 双双排除",
    commissionRatePct: null,
    commissionNote: "第三方称 25%–35%",
    giftFit: "notFit",
    giftReason: "杀毒软件非节日礼品",
    verdictHint: "excluded",
    note: "与 Avast 同属 Gen Digital，网络双重排除，不重复推",
  }),
  entry({
    displayName: "iMobie",
    fame: "weak",
    fameEvidence: "苹果工具软件品牌，美国知名度有限",
    priceMinUsd: 39.99,
    priceMaxUsd: 69.99,
    priceLabel: "$39.99–$69.99/年（AnyTrans / AnyUnlock）",
    networkStatus: "excluded",
    networkLabel: "Impact（排除）",
    networkEvidence: "官网原文：Impact 或 Avangate",
    commissionRatePct: null,
    commissionNote: "官网起步 35%、最高 70%，120 天 cookie；60 天退款期，逆转风险高",
    giftFit: "notFit",
    giftReason: "iPhone 工具纯搜索需求，非送礼季品",
    verdictHint: "excluded",
    note: "Impact 硬排除；且非送礼季品",
  }),
  entry({
    displayName: "SAXX Underwear US",
    fame: "medium",
    fameEvidence: "美国男士内裤品牌，有一定知名度，300 人获得返利",
    priceMinUsd: 36,
    priceMaxUsd: 63,
    priceLabel: "$36–$63（单条 $36–$37，3 条装 $63）",
    networkStatus: "excluded",
    networkLabel: "CJ（排除）",
    networkEvidence: "CJ（6%–15% 各源不一）+ FlexOffers 12%；用户 FlexOffers 账号 #1564537 已拒",
    commissionRatePct: 12,
    commissionNote: "FlexOffers 12% 口径；单条 $36×12%=$4.32",
    giftFit: "fit",
    giftReason: "男士内裤/礼盒有节日男士礼品属性",
    verdictHint: "excluded",
    note: "单条佣金 $4.32 不过 $5 线（只有组包才过线），网络 CJ 排除 + FlexOffers 已拒",
  }),
  entry({
    displayName: "Lilly Lashes",
    fame: "medium",
    fameEvidence: "美国假睫毛品牌，95 人获得返利",
    priceMinUsd: 18,
    priceMaxUsd: 30,
    priceLabel: "$18–$30/副",
    networkStatus: "excluded",
    networkLabel: "Impact（排除）",
    networkEvidence: "Impact 15% / FlexOffers 12%；另有 Closed PPC 条款：禁品牌词竞价",
    commissionRatePct: null,
    commissionNote: "单副 $3.60–$4.50，均不过 $5；需篮子 >$42 才过线",
    giftFit: "general",
    giftReason: "美妆小件可作礼品添头",
    verdictHint: "excluded",
    note: "网络双排除 + 单副佣金不过线 + 明文禁 PPC，三重不过",
  }),
  entry({
    displayName: "NARS CA",
    fame: "strong",
    fameEvidence: "知名美妆品牌，但此条为加拿大站",
    priceMinUsd: 36,
    priceMaxUsd: 45,
    priceLabel: "$36–$45",
    networkStatus: "unknown",
    networkLabel: "未核实（CA 清单）",
    networkEvidence: "CA 清单本身非美国；美国版在 Rakuten 3%–8%",
    commissionRatePct: null,
    commissionNote: "单品佣金仅 $2.16–$2.88",
    giftFit: "general",
    giftReason: "美妆节日礼盒有需求，但此条非美国",
    verdictHint: "excluded",
    note: "非美国（CA）+ 仅 4 人返利 + 单品佣金不过线",
  }),
  entry({
    displayName: "Swarovski HK",
    fame: "strong",
    fameEvidence: "全球知名珠宝品牌，但此条为香港站",
    priceMinUsd: null,
    priceMaxUsd: null,
    priceLabel: "£79（心形水晶手链，£ 价）",
    networkStatus: "excluded",
    networkLabel: "FlexOffers（不可用）",
    networkEvidence: "FlexOffers 4% 为主；各区 1.6%–4%",
    commissionRatePct: null,
    commissionNote: "约 £2.53–£3.16，远低于 $5 线",
    giftFit: "fit",
    giftReason: "珠宝送礼属性强，但此条非美国",
    verdictHint: "excluded",
    note: "HK 非美国 + 佣金率仅个位数 + FlexOffers 已拒；珠宝送礼属性再强也补不上佣金",
  }),
  entry({
    displayName: "The Home Depot",
    fame: "strong",
    fameEvidence: "美国最大建材零售巨头，4,441 人获得返利",
    priceMinUsd: null,
    priceMaxUsd: null,
    priceLabel: "无单一主力价（$10 小件到数百美元大家电）",
    networkStatus: "unknown",
    networkLabel: "未核实（Rakuten 有据，但多网并存）",
    networkEvidence: "一源称经 Rakuten Advertising，另有来源称经 Impact 或 CJ；55海淘上游未核实",
    commissionRatePct: null,
    commissionNote: "第三方称 2%–8%，品类费率未核实",
    giftFit: "general",
    giftReason: "品类太杂，无单一礼品款",
    verdictHint: "excluded",
    note: "巨头非小众：巨头零售商，与本批目标方向相反；无单一英雄商品可做一条广告",
    giant: true,
  }),
  entry({
    displayName: "Crocs DE",
    fame: "strong",
    fameEvidence: "全球知名鞋履品牌，但此条为德国站",
    priceMinUsd: 49.99,
    priceMaxUsd: 54.99,
    priceLabel: "$49.99–$54.99（Classic Clog）",
    networkStatus: "unknown",
    networkLabel: "未核实（DE 项目）",
    networkEvidence: "DE 项目见于 FlexOffers（4%）、Awin（Closed）等；美国站是 Impact 6%，不能混用",
    commissionRatePct: null,
    commissionNote: "按 FlexOffers DE 项目 4% 算约 $2.20，仍 <$5",
    giftFit: "general",
    giftReason: "鞋履可作礼品，但此条非美国",
    verdictHint: "excluded",
    note: "DE = 德国站，非美国站；价格与佣金双双不过门槛（<$80 且 <$5）",
  }),
  entry({
    displayName: "Vevor",
    fame: "medium",
    fameEvidence: "工具/设备品牌，美国有一定知名度",
    priceMinUsd: null,
    priceMaxUsd: null,
    priceLabel: "未核实",
    networkStatus: "unknown",
    networkLabel: "未核实",
    networkEvidence: "55海淘 2.4% 返利，9 人获得返利",
    commissionRatePct: null,
    commissionNote: null,
    giftFit: "general",
    giftReason: "工具类节日礼物属性一般",
    verdictHint: "excluded",
    note: "已有系列在跑（封口机、取暖器），重复不新推",
  }),
  entry({
    displayName: "Roborock US",
    fame: "strong",
    fameEvidence: "扫地机器人品牌，美国知名度高",
    priceMinUsd: null,
    priceMaxUsd: null,
    priceLabel: "未核实",
    networkStatus: "unknown",
    networkLabel: "未核实（PartnerBoost 品牌已批）",
    networkEvidence: "PartnerBoost 账号 electrovibelab，Roborock 品牌 2026-10-16 已批",
    commissionRatePct: null,
    commissionNote: null,
    giftFit: "general",
    giftReason: "家电偏自用，节日礼品属性一般",
    verdictHint: "excluded",
    note: "已有系列在跑，重复不新推",
  }),
  entry({
    displayName: "Dore & Rose",
    fame: "unknown",
    fameEvidence: "未核实：荷兰品牌（阿姆斯特丹地址），美国知名度证据不足",
    priceMinUsd: 54,
    priceMaxUsd: 132,
    priceLabel: "$54–$132（丝质枕套）",
    networkStatus: "unknown",
    networkLabel: "未核实",
    networkEvidence: "公开搜索未找到可信联盟项目；不要与 Rakuten 6% 的 Derek Rose 混淆，那是另一品牌",
    commissionRatePct: null,
    commissionNote: "搜到的 7.5% 是同名混淆的 Der Rose，不能套用",
    giftFit: "general",
    giftReason: "丝质枕套可作礼品，但联盟通道未核实",
    verdictHint: "excluded",
    note: "无可验证联盟通道 + 荷兰品牌，美国知名度证据不足；1,409 人只是返利热度，不是联盟需求佐证",
  }),
  entry({
    displayName: "Gaia",
    fame: "medium",
    fameEvidence: "健康流媒体订阅品牌，2,069 人获得返利",
    priceMinUsd: 11.99,
    priceMaxUsd: 119,
    priceLabel: "$11.99/月，$119/年",
    networkStatus: "unknown",
    networkLabel: "未核实",
    networkEvidence: "一源称 25% recurring，一源称 20%，一源称无联盟项目；无任何来源点名网络",
    commissionRatePct: null,
    commissionNote: "月付 $2.40–$3.00 不过线；年付 $119×25%=$29.75 只有“年付单全额计佣”才成立，该前提未核实",
    giftFit: "general",
    giftReason: "订阅非实物礼品",
    verdictHint: "excluded",
    note: "月付经济学双不过线 + 网络未核实 + 7 天免费试用 + 流失；2,069 人是返利热度不是付费转化",
  }),
  entry({
    displayName: "GearUP",
    fame: "weak",
    fameEvidence: "游戏加速器品牌，美国知名度有限",
    priceMinUsd: 6,
    priceMaxUsd: 6,
    priceLabel: "约 $6/月，纯订阅",
    networkStatus: "excluded",
    networkLabel: "Impact（排除）",
    networkEvidence: "官网原文：managed through Impact；另有评测称经 CJ",
    commissionRatePct: null,
    commissionNote: "$6×70%=$4.20，且只付新用户首单，不 recurring",
    giftFit: "notFit",
    giftReason: "游戏类按既定规则不走 Google 搜索 CPS",
    verdictHint: "excluded",
    note: "Impact 硬排除 + $4.20 不过 $5 + 游戏类不走 Google 搜索 CPS，三重排除",
  }),
];

const KNOWN_BY_KEY = new Map(KNOWN_BRANDS.map((b) => [b.key, b]));

const NON_US_REGIONS: readonly RegionCode[] = ["UK", "DE", "CA", "APAC", "HK"];

function estimateCommission(
  ratePct: number | null,
  priceMinUsd: number | null
): { estimated: number | null; basis: string | null } {
  if (ratePct == null || priceMinUsd == null) return { estimated: null, basis: null };
  return {
    estimated: round2((priceMinUsd * ratePct) / 100),
    basis: null,
  };
}

// ---------------------------------------------------------------------------
// 解析：55海淘粘贴文本 → 商家块
// ---------------------------------------------------------------------------

const NAME_LIKE = /^[A-Za-z][A-Za-z0-9 .&'’\-()+]*$/;
const FIELD_KEYWORDS = [
"返利",
"获得返利",
"成功下单",
"人关注",
"去购买",
"免邮",
"直邮",
"折",
"订阅",
"首单",
"低至",
"满额",
"新客",
"新人",
];

function looksLikeBrandName(line: string): boolean {
if (!NAME_LIKE.test(line) || line.length > 40) return false;
return!FIELD_KEYWORDS.some((k) => line.includes(k));
}

function isSlashMerchantLine(line: string): boolean {
return (
line.includes(" / ") && (line.includes("返利") || line.includes("获得返利") || line.includes("成功下单"))
);
}

/** 把粘贴文本切成商家块：空行分块；斜杠单行（"品牌 / 返利 / 人数"）自成一块；已成块后又出现品牌名行时也分块。 */
function splitIntoBlocks(input: string): string[][] {
const lines = input.split("\n").map((l) => l.trim());
const blocks: string[][] = [];
let current: string[] = [];
const flush = () => {
if (current.length > 0) blocks.push(current);
current = [];
};
const blockHasField = (b: string[]): boolean =>
b.some((l) => l.includes("返利") || l.includes("获得返利") || l.includes("成功下单"));
for (const line of lines) {
if (line === "") {
flush();
continue;
}
if (line === "去购买 拿返利" || line === "去购买") {
if (current.length > 0) current.push(line);
continue;
}
if (isSlashMerchantLine(line)) {
flush();
current = [line];
flush();
continue;
}
if (current.length > 0 && blockHasField(current) && looksLikeBrandName(line)) {
flush();
}
current.push(line);
}
flush();
return blocks;
}

function extractPrice(blockText: string): {
priceUsd: number | null;
priceGbp: number | null;
priceCurrency: "USD" | "GBP" | null;
} {
const gbpMatch = blockText.match(/£([\d,]+(?:\.\d+)?)/);
const usdMatches = [...blockText.matchAll(/(?<!满)\$([\d,]+(?:\.\d+)?)/g)];
const priceGbp = gbpMatch? Number(gbpMatch[1].replace(/,/g, "")): null;
const priceUsd =
usdMatches.length > 0? Number(usdMatches[0][1].replace(/,/g, "")): null;
const priceCurrency = priceGbp!= null? "GBP": priceUsd!= null? "USD": null;
return { priceUsd, priceGbp, priceCurrency};
}

function detectRegion(name: string): RegionCode | null {
if (/\bUS\b/i.test(name) || /\bUSA\b/i.test(name) || /U\.S\./i.test(name)) return "US";
if (/\bHK\b/i.test(name)) return "HK";
if (/\bDE\b/i.test(name)) return "DE";
if (/\bCA\b/i.test(name)) return "CA";
if (/APAC/i.test(name)) return "APAC";
if (/\bUK\b/i.test(name)) return "UK";
return null;
}

function parseBlock(block: string[]): ParsedMerchant | null {
// 斜杠单行先拆成段；否则按行处理。
let lines = block;
if (block.length === 1 && block[0].includes(" / ")) {
lines = block[0]
.split(" / ")
.map((s) => s.trim())
.filter(Boolean);
}
const nameLine = lines.find((l) => looksLikeBrandName(l))?? lines.find((l) =>!FIELD_KEYWORDS.some((k) => l.includes(k)) && l!== "去购买 拿返利");
if (!nameLine) return null;
const name = nameLine.trim();
if (name === "" || name.includes("返利")) return null;
const text = lines.join(" ");

let cashbackPct: number | null = null;
let cashbackFixedUsd: number | null = null;
let cashbackKind: ParsedMerchant["cashbackKind"] = "none";
if (/暂无返利/.test(text)) {
cashbackKind = "none";
} else {
const fixed = text.match(/返利最高\s*\$([\d,]+(?:\.\d+)?)/);
const pctMax = text.match(/最高\s*([\d.]+)\s*%/);
const pctPlain = text.match(/([\d.]+)\s*%\s*返利/);
if (fixed) {
cashbackFixedUsd = Number(fixed[1].replace(/,/g, ""));
cashbackKind = "fixed";
} else if (pctMax) {
cashbackPct = Number(pctMax[1]);
cashbackKind = "percent";
} else if (pctPlain) {
cashbackPct = Number(pctPlain[1]);
cashbackKind = "percent";
}
}

let peopleCount: number | null = null;
const wanPeople = text.match(/([\d.]+)\s*万\s*人(?:获得返利|成功下单)/);
const plainPeople = text.match(/([\d,]+)\s*人(?:获得返利|成功下单)/);
if (wanPeople) peopleCount = parseCountToken(`${wanPeople[1]}万`);
else if (plainPeople) peopleCount = parseCountToken(plainPeople[1]);

let followerCount: number | null = null;
const follower = text.match(/([\d,]+(?:\.\d+)?)\s*(万)?人关注/);
if (follower) followerCount = parseCountToken(follower[2]? `${follower[1]}万`: follower[1]);

const { priceUsd, priceGbp, priceCurrency} = extractPrice(text);
const notes = lines.filter((l) => l!== nameLine && l!== "去购买 拿返利" && l!== "去购买");

return {
name,
normalizedName: normalizeBrandName(name),
region: detectRegion(name),
cashbackPct,
cashbackFixedUsd,
cashbackKind,
peopleCount,
followerCount,
priceUsd,
priceGbp,
priceCurrency,
notes,
rawBlock: block.join("\n"),
};
}

/**
* 解析 55海淘粘贴文本。无法解析的块与重复品牌计入 skippedCount 并
* 列在 skippedLines 里，不静默丢数。
*/
export function parseCashbackMerchants(input: string): ParseResult {
const blocks = splitIntoBlocks(input);
const merchants: ParsedMerchant[] = [];
const skippedLines: string[] = [];
const seen = new Set<string>();
for (const block of blocks) {
const parsed = parseBlock(block);
if (!parsed) {
skippedLines.push(block.join(" / "));
continue;
}
if (seen.has(parsed.normalizedName)) {
skippedLines.push(`重复品牌：${parsed.name}`);
continue;
}
seen.add(parsed.normalizedName);
merchants.push(parsed);
}
return {
merchants,
parsedCount: merchants.length,
skippedCount: skippedLines.length,
skippedLines,
};
}

// ---------------------------------------------------------------------------
// 筛查
// ---------------------------------------------------------------------------

function commissionLabelFor(
ratePct: number | null,
estimated: number | null
): string {
if (ratePct!= null && estimated!= null) return `${ratePct}% · 约 $${estimated.toFixed(2)}`;
if (ratePct!= null) return `${ratePct}%`;
return "未核实";
}

function screenOne(parsed: ParsedMerchant, seen: Set<string>): ScreenedMerchant {
const demandTier = demandTierFor(parsed.peopleCount);
const known = KNOWN_BY_KEY.get(parsed.normalizedName);
const base = {
...parsed,
demandTier,
knownBrand: known!= null,
keywordMeasure: null as BrandKeywordMeasure | null,
keywordVerdict: null as BrandKeywordVerdict | null,
keywordNote: null as string | null,
};

if (seen.has(parsed.normalizedName)) {
return {
...base,
verdict: "excluded",
reason: "同品牌重复，仅保留第一条",
fame: "unknown",
fameEvidence: "未核实",
priceLabel: "未核实",
networkStatus: "unknown",
networkLabel: "未核实",
estimatedCommissionUsd: null,
commissionBasis: null,
commissionLabel: "未核实",
giftFit: "unknown",
giftReason: "未核实",
breakevenCpcUsd: null,
};
}
seen.add(parsed.normalizedName);

// 1. 非美国：名字带 HK/DE/CA/APAC/UK，或价格是 £。
const nonUsRegion =
parsed.region!= null && (NON_US_REGIONS as readonly string[]).includes(parsed.region)
? parsed.region
: null;
if (nonUsRegion || parsed.priceCurrency === "GBP") {
const where = nonUsRegion?? "£ 价格";
return {
...base,
verdict: "excluded",
reason: `非美国（${where}）：不在美国投放范围内`,
fame: known?.fame?? "unknown",
fameEvidence: known?.fameEvidence?? "未核实",
priceLabel: known?.priceLabel?? (parsed.priceGbp!= null? `£${parsed.priceGbp}`: parsed.priceUsd!= null? `$${parsed.priceUsd}（粘贴文本中的商品价）`: "未核实"),
networkStatus: known?.networkStatus?? "unknown",
networkLabel: known?.networkLabel?? "未核实",
estimatedCommissionUsd: null,
commissionBasis: null,
commissionLabel: "未核实",
giftFit: known?.giftFit?? "unknown",
giftReason: known?.giftReason?? "未核实",
breakevenCpcUsd: null,
};
}

// 2. 巨头非小众。
if (known?.giant) {
return {
...base,
verdict: "excluded",
reason: known.note,
fame: known.fame,
fameEvidence: known.fameEvidence,
priceLabel: known.priceLabel,
networkStatus: known.networkStatus,
networkLabel: known.networkLabel,
estimatedCommissionUsd: null,
commissionBasis: null,
commissionLabel: "未核实",
giftFit: known.giftFit,
giftReason: known.giftReason,
breakevenCpcUsd: null,
};
}

if (known) {
const { estimated} = estimateCommission(known.commissionRatePct, known.priceMinUsd);
const basis =
known.commissionRatePct!= null && known.priceMinUsd!= null && estimated!= null
? `$${known.priceMinUsd}×${known.commissionRatePct}%≈$${estimated.toFixed(2)}${known.commissionNote? `（${known.commissionNote}）`: ""}`
: known.commissionNote?? null;
const breakevenCpcUsd = estimated!= null? round2(estimated / 2): null;
const common = {
...base,
fame: known.fame,
fameEvidence: known.fameEvidence,
priceLabel: known.priceLabel,
networkStatus: known.networkStatus,
networkLabel: known.networkLabel,
estimatedCommissionUsd: estimated,
commissionBasis: basis,
commissionLabel: commissionLabelFor(known.commissionRatePct, estimated),
giftFit: known.giftFit,
giftReason: known.giftReason,
breakevenCpcUsd,
};
if (known.verdictHint === "excluded") {
return {...common, verdict: "excluded", reason: known.note};
}
if (known.verdictHint === "shortlist") {
// 经济学复核：价格 ≥$80 或单均佣金 >$5 二选一；算不过就降为排除。
const pricePass = known.priceMinUsd!= null && known.priceMinUsd >= 80;
const commissionPass = estimated!= null && estimated > 5;
if (!pricePass &&!commissionPass) {
return {
...common,
verdict: "excluded",
reason: `经济学算不过线：价格 ${known.priceLabel}、单均佣金 ${estimated!= null? `约 $${estimated.toFixed(2)}`: "未核实"}，价格 <$80 且佣金 ≤$5`,
};
}
return {
...common,
verdict: "shortlist",
reason: `${known.note}${basis? `；佣金依据：${basis}`: ""}`,
};
}
return {...common, verdict: "backup", reason: known.note};
}

// 3. 未在库里：网络未核实 → 最多 backup，永不 shortlist；佣金未核实，不编数字。
const demandNote =
parsed.peopleCount!= null
? `需求佐证：${parsed.peopleCount.toLocaleString("en-US")} 人获得返利`
: "需求佐证未知（粘贴文本中无人数）";
return {
...base,
verdict: "backup",
reason: `网络未核实，需实测跳转链；佣金未核实。${demandNote}`,
fame: "unknown",
fameEvidence: "未核实：粘贴文本中无知名度佐证",
priceLabel:
parsed.priceUsd!= null
? `$${parsed.priceUsd}（粘贴文本中的商品价）`
: parsed.priceGbp!= null
? `£${parsed.priceGbp}`
: "未核实",
networkStatus: "unknown",
networkLabel: "未核实",
estimatedCommissionUsd: null,
commissionBasis: null,
commissionLabel: "未核实",
giftFit: "unknown",
giftReason: "未核实",
breakevenCpcUsd: null,
};
}

export function screenCashbackMerchants(parsed: ParsedMerchant[]): ScreeningResult {
const seen = new Set<string>();
const merchants = parsed.map((p) => screenOne(p, seen));
return {
merchants,
parsedCount: parsed.length,
skippedCount: 0,
skippedLines: [],
counts: {
shortlist: merchants.filter((m) => m.verdict === "shortlist").length,
backup: merchants.filter((m) => m.verdict === "backup").length,
excluded: merchants.filter((m) => m.verdict === "excluded").length,
},
};
}

/** 一步到位：解析粘贴文本并筛查。 */
export function screenCashbackText(input: string): ScreeningResult {
const parsed = parseCashbackMerchants(input);
const screened = screenCashbackMerchants(parsed.merchants);
return {
...screened,
parsedCount: parsed.parsedCount,
skippedCount: parsed.skippedCount,
skippedLines: parsed.skippedLines,
};
}

// ---------------------------------------------------------------------------
// 品牌词流量表粘贴解析
// ---------------------------------------------------------------------------

export interface KeywordTableParseResult {
rows: BrandKeywordMeasure[];
parsedCount: number;
skippedCount: number;
skippedLines: string[];
}

function parseVolumeToken(token: string | undefined): number | null | "invalid" {
if (token == null) return null;
const t = token.trim().replace(/[$,]/g, "").replace(/，/g, "");
if (t === "" || t === "—" || t === "-" || /^null$/i.test(t)) return null;
const k = t.match(/^([\d.]+)\s*K$/i);
if (k) return Math.round(Number(k[1]) * 1000);
const n = Number(t);
return Number.isFinite(n)? n: "invalid";
}

function parseCpcToken(token: string | undefined): number | null | "invalid" {
if (token == null) return null;
const t = token.trim().replace(/[$,]/g, "").replace(/，/g, "");
if (t === "" || t === "—" || t === "-" || /^null$/i.test(t)) return null;
const n = Number(t);
return Number.isFinite(n)? n: "invalid";
}

function splitKeywordLine(line: string): string[] {
if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
if (line.includes(",")) return line.split(",").map((s) => s.trim());
if (line.includes("，")) return line.split("，").map((s) => s.trim());
return line.split(/\s+/).map((s) => s.trim());
}

/**
* 解析品牌词流量表粘贴（每行"词、搜索量、CPC"，逗号/制表符/空格分隔都认；
* 搜索量支持 27,100 千分位与 22K 写法）。空量、0 量都保留为行（量 null / 0），
* 只有词为空或量/CPC token 无法解析的行才计入 skippedCount，不静默丢。
*/
export function parseKeywordTable(input: string): KeywordTableParseResult {
const rows: BrandKeywordMeasure[] = [];
const skippedLines: string[] = [];
for (const rawLine of input.split("\n")) {
const line = rawLine.trim();
if (line === "") continue;
let parts = splitKeywordLine(line);
// 逗号分隔时千分位会把 "27,100" 拆成两段：重组为 词 / 量 / CPC。
if (parts.length > 3) {
const keyword = parts[0];
const cpcToken = parts[parts.length - 1];
const volumeToken = parts.slice(1, -1).join("");
parts = [keyword, volumeToken, cpcToken];
}
if (parts.length < 2) {
skippedLines.push(line);
continue;
}
const keyword = parts[0];
if (keyword === "") {
skippedLines.push(line);
continue;
}
const volume = parseVolumeToken(parts[1]);
const cpc = parseCpcToken(parts[2]);
if (volume === "invalid" || cpc === "invalid") {
skippedLines.push(line);
continue;
}
rows.push({
keyword,
searchVolume: volume,
cpc,
competition: null,
lowTopBid: null,
highTopBid: null,
});
}
return { rows, parsedCount: rows.length, skippedCount: skippedLines.length, skippedLines};
}

// ---------------------------------------------------------------------------
// 品牌词流量归属 + 短名单升/降档
// ---------------------------------------------------------------------------

export interface ApplyKeywordTrafficResult {
result: ScreeningResult;
appliedCount: number;
unmatchedCount: number;
}

function matchMeasureToMerchant(
keyword: string,
merchants: readonly ScreenedMerchant[]
): ScreenedMerchant | null {
const key = normalizeBrandName(keyword);
const exact = merchants.find((m) => m.normalizedName === key);
if (exact) return exact;
// 词表里的词可能是 "品牌 + 修饰词"（如 eileen fisher dresses）：取最长前缀匹配。
const prefix = merchants
.filter((m) => key.startsWith(m.normalizedName) && m.normalizedName.length > 0)
.sort((a, b) => b.normalizedName.length - a.normalizedName.length)[0];
return prefix?? null;
}

/**
* 把品牌词流量（实测拉取或粘贴导入）归属到短名单/备选行，更新判定：
* - 短名单 + 有量且 CPC ≤ 盈亏平衡 → 留在短名单（流量可得通过）。
* - 短名单 + 无量 → 降为备选（无量不直接杀品牌：品牌词无量可能是品牌
* 太小众，通用词/型号词另算）。
* - 短名单 + 超盈亏平衡 → 降为备选。
* - 佣金未核实 → 不判可投/超标，只显示量和 CPC。
* 排除档不参与归属（拉取时本来就不测排除档）。
*/
export function applyKeywordTraffic(
screening: ScreeningResult,
measures: readonly BrandKeywordMeasure[]
): ApplyKeywordTrafficResult {
let appliedCount = 0;
let unmatchedCount = 0;
const merchants = screening.merchants.map((m) => {
if (m.verdict === "excluded") return m;
const measure = measures
.map((row) => ({ row, target: matchMeasureToMerchant(row.keyword, screening.merchants)}))
.find((x) => x.target === m)?.row;
if (!measure) return m;
appliedCount += 1;
const verdict = brandKeywordVerdict({
searchVolume: measure.searchVolume,
cpc: measure.cpc,
breakevenCpc: m.breakevenCpcUsd,
});
const volumeText =
measure.searchVolume!= null? measure.searchVolume.toLocaleString("en-US"): "未知";
const cpcText = measure.cpc!= null? `$${measure.cpc.toFixed(2)}`: "未知";
if (verdict === "no-volume") {
const note = `品牌词流量：无量（"${measure.keyword}" 搜索量 ${volumeText}，品牌可能太小众，通用词/型号词另算，不直接杀品牌）`;
if (m.verdict === "shortlist") {
return {...m, keywordMeasure: measure, keywordVerdict: verdict, keywordNote: note, verdict: "backup" as Verdict, reason: `${m.reason}；${note}`};
}
return {...m, keywordMeasure: measure, keywordVerdict: verdict, keywordNote: note};
}
if (verdict === "over-breakeven") {
const note = `品牌词流量：CPC ${cpcText} 超盈亏平衡 $${m.breakevenCpcUsd?.toFixed(2)}（单均佣金 $${m.estimatedCommissionUsd?.toFixed(2)} ÷ 2），品牌词暂不可投`;
if (m.verdict === "shortlist") {
return {...m, keywordMeasure: measure, keywordVerdict: verdict, keywordNote: note, verdict: "backup" as Verdict, reason: `${m.reason}；${note}`};
}
return {...m, keywordMeasure: measure, keywordVerdict: verdict, keywordNote: note};
}
if (verdict === "investable") {
const note = `品牌词流量：有量（${volumeText}）且 CPC ${cpcText} ≤ 盈亏平衡 $${m.breakevenCpcUsd?.toFixed(2)}，可投`;
return {...m, keywordMeasure: measure, keywordVerdict: verdict, keywordNote: note};
}
return {
...m,
keywordMeasure: measure,
keywordVerdict: verdict,
keywordNote: "品牌词流量：佣金未核实，无法算盈亏平衡（只显示量和 CPC）",
};
});
// 未归属统计：量表里没有对应到任何短名单/备选行的行数。
for (const row of measures) {
if (!matchMeasureToMerchant(row.keyword, screening.merchants)) unmatchedCount += 1;
else {
const target = matchMeasureToMerchant(row.keyword, screening.merchants);
if (target && target.verdict === "excluded") unmatchedCount += 1;
}
}
const result: ScreeningResult = {
...screening,
merchants,
counts: {
shortlist: merchants.filter((m) => m.verdict === "shortlist").length,
backup: merchants.filter((m) => m.verdict === "backup").length,
excluded: merchants.filter((m) => m.verdict === "excluded").length,
},
};
return { result, appliedCount, unmatchedCount};
}

// ---------------------------------------------------------------------------
// 汇总文本（复制到剪贴板用）
// ---------------------------------------------------------------------------

export function formatScreeningSummary(result: ScreeningResult, lang: "zh" | "en"): string {
const by = (v: Verdict) => result.merchants.filter((m) => m.verdict === v);
const line = (m: ScreenedMerchant) => `- ${m.name}：${m.reason}`;
if (lang === "en") {
return [
`Cashback merchant screening (${result.parsedCount} parsed, ${result.skippedCount} skipped; shortlist ${result.counts.shortlist}, backup ${result.counts.backup}, excluded ${result.counts.excluded})`,
"[Shortlist]",
...by("shortlist").map(line),
"[Backup / to verify]",
...by("backup").map(line),
"[Excluded]",
...by("excluded").map(line),
"Note: cashback % is what consumers get, not the affiliate commission; this screening never uses cashback % to compute commission.",
].join("\n");
}
return [
`返利商家筛选汇总（已解析 ${result.parsedCount} 家，跳过 ${result.skippedCount} 行；短名单 ${result.counts.shortlist} 家、备选 ${result.counts.backup} 家、排除 ${result.counts.excluded} 家）`,
"",
...by("shortlist").map(line),
"",
...by("backup").map(line),
"",
...by("excluded").map(line),
"注意：返利%是给消费者的返现，不是联盟佣金；本筛查未用返利%算佣金。",
].join("\n");
}

export function formatConfirmedList(
selected: readonly ScreenedMerchant[],
lang: "zh" | "en"
): string {
if (selected.length === 0) {
return lang === "en"
? "Confirmed list is empty — tick shortlist/backup brands first."
: "最终清单为空，请先勾选短名单/备选品牌。";
}
const head =
lang === "en"
? `Confirmed final list (${selected.length}):`
: `最终清单（${selected.length} 家）：`;
return [
head,
...selected.map((m) => `- ${m.name}（${m.verdict === "shortlist"? "短名单": "备选"}）：${m.reason}`),
lang === "en"
? "Display only — no Offer or campaign was created. Creating a campaign needs a separate confirmation."
: "仅站内汇总展示，未建 Offer、未建系列；建系列前须另行确认。",
].join("\n");
}
