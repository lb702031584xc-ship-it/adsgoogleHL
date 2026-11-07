/**
 * 中国量化 P0：v1 选股框架静态快照（2026-11-07 冻结版）。
 * 纯前端展示，不调 API、不写数据库、不接券商、不下单、不构成买入建议。
 *
 * 诚实边界：v1 上线时没有任何一只票的真实因子分——分数须等服务端首次
 * 真实拉取（Baostock / Tushare / AKShare）并按冻结规则算出后才填。
 * 本文件只冻结规则、股票池、因子证据（中证 RankIC）、信号阈值与信号门，
 * 不编造任何个股分数、价格、涨跌或新闻条目。
 *
 * 研究依据：2026-11-07 深度研究（中证指数因子报告，截至 2025 年二季度）。
 * 冻结规则全文见 ~/workspace/cn-quant/cn-v1-preregistration.md。
 */
export const CN_QUANT_DATA_AS_OF = "2026-11-07";
export const CN_QUANT_POOL_SIZE = 30;
export const CN_QUANT_ENTRY_LINE = 70;
export const CN_QUANT_EXIT_LINE = 50;

export type CnQuantPoolRow = {
  code: string;
  name: string;
  sectorZh: string;
};

export const CN_QUANT_POOL: CnQuantPoolRow[] = [
  { code: "600519", name: "贵州茅台", sectorZh: "食品饮料" },
  { code: "000858", name: "五粮液", sectorZh: "食品饮料" },
  { code: "600809", name: "山西汾酒", sectorZh: "食品饮料" },
  { code: "600887", name: "伊利股份", sectorZh: "食品饮料" },
  { code: "600036", name: "招商银行", sectorZh: "银行" },
  { code: "600000", name: "浦发银行", sectorZh: "银行" },
  { code: "601166", name: "兴业银行", sectorZh: "银行" },
  { code: "000001", name: "平安银行", sectorZh: "银行" },
  { code: "601318", name: "中国平安", sectorZh: "非银金融" },
  { code: "600030", name: "中信证券", sectorZh: "非银金融" },
  { code: "601688", name: "华泰证券", sectorZh: "非银金融" },
  { code: "601601", name: "中国太保", sectorZh: "非银金融" },
  { code: "300059", name: "东方财富", sectorZh: "非银金融" },
  { code: "600900", name: "长江电力", sectorZh: "公用事业" },
  { code: "601899", name: "紫金矿业", sectorZh: "有色金属" },
  { code: "000333", name: "美的集团", sectorZh: "家用电器" },
  { code: "000651", name: "格力电器", sectorZh: "家用电器" },
  { code: "600690", name: "海尔智家", sectorZh: "家用电器" },
  { code: "002594", name: "比亚迪", sectorZh: "汽车" },
  { code: "600276", name: "恒瑞医药", sectorZh: "医药生物" },
  { code: "603259", name: "药明康德", sectorZh: "医药生物" },
  { code: "002415", name: "海康威视", sectorZh: "电子" },
  { code: "300750", name: "宁德时代", sectorZh: "电力设备" },
  { code: "000725", name: "京东方A", sectorZh: "电子" },
  { code: "002230", name: "科大讯飞", sectorZh: "计算机" },
  { code: "002352", name: "顺丰控股", sectorZh: "交通运输" },
  { code: "601919", name: "中远海控", sectorZh: "交通运输" },
  { code: "600309", name: "万华化学", sectorZh: "化工" },
  { code: "600031", name: "三一重工", sectorZh: "机械设备" },
  { code: "600048", name: "保利发展", sectorZh: "房地产" },
];

export type CnQuantFactorEvidence = {
  factor: string;
  definition: string;
  rankIc: string;
  winRate: string;
  note: string;
};

/** 中证指数报告（2011–2024，截至 2025 年二季度）：RankIC 均值与胜率。 */
export const CN_QUANT_FACTOR_EVIDENCE: CnQuantFactorEvidence[] = [
  { factor: "低波动", definition: "过去 252 日收益率标准差，越低越好", rankIc: "0.087", winRate: "69%", note: "六维最高；下行市最强，上行市为负" },
  { factor: "价值", definition: "EP / BP / CFP 三者合成", rankIc: "0.059", winRate: "61%", note: "各市值均有效，大市值、金融最强" },
  { factor: "质量", definition: "ROE（TTM）+ 扣非净利润增速", rankIc: "0.045", winRate: "75%", note: "胜率最高；ROE 须同报告期，增速优先扣非口径" },
  { factor: "红利", definition: "过去 3 年平均税后现金股息率", rankIc: "0.044", winRate: "64%", note: "与价值强相关，适合复合；剔除支付率过高者" },
  { factor: "现金流", definition: "经营现金流 / 市值、自由现金流 / 市值", rankIc: "0.029", winRate: "70%", note: "近年各市值有效性均提升" },
  { factor: "反转", definition: "过去 1 个月收益率取反", rankIc: "—", winRate: "—", note: "A 股特色因子；美股式 12-1 动量 RankIC 为 −0.011，整体无效，不用" },
  { factor: "成长", definition: "营收 / 扣非净利润同比", rankIc: "0.009", winRate: "55%", note: "整体弱，不入六维；仅作观察" },
];

export type CnQuantSignal = {
  signal: string;
  threshold: string;
  lag: string;
  status: string;
};

/**
 * 机构信号：阈值全部为建议口径（无监管定稿），须 2–3 个同向才加分，
 * 单信号不触发买卖，任一信号权重不超过总分的 25%。
 */
export const CN_QUANT_SIGNALS: CnQuantSignal[] = [
  { signal: "北向资金", threshold: "个股连续 3 日上榜前十大且净买入占当日成交 >5%，或季度持股占比环比 +0.5pct", lag: "自 2024-08-19 无盘中实时披露，只能盘后/季度看", status: "待接入" },
  { signal: "两融余额", threshold: "融资余额 5 日连增且累计 >2%；个股融资占流通市值 >5% 且 5 日增幅 >20% 为杠杆拥挤预警（反向）", lag: "每日盘后公布，T+1 可用", status: "待接入" },
  { signal: "龙虎榜机构席位", threshold: "机构净买入 >5000 万元且 ≥2 家机构同买；净买入/当日成交 >10% 强、<3% 弱", lag: "盘后公布，T+1 交易；只算前五席位", status: "待接入" },
  { signal: "基金季报持仓", threshold: "持股基金家数环比 +20%，或重仓基金数 0→≥5 家，或持股占流通股环比 +1pct", lag: "滞后最长 15 个工作日；Q1/Q3 不披露全部持仓", status: "待接入" },
  { signal: "机构调研", threshold: "30 日内调研机构 ≥20 家，或场次 ≥3 次，或单次参与 ≥50 家", lag: "调研 ≠ 买入；沪市样本少", status: "待接入" },
  { signal: "大宗交易", threshold: "溢价 >0 且买方为机构、成交额 >3000 万元为强信号；折价 −8% 以下连续多日为出货预警", lag: "折价是常态，须看买卖方身份", status: "待接入" },
  { signal: "股东户数", threshold: "连续 3 期下降累计 >10% 为集中信号；连续 3 期上升累计 >10% 为分散预警", lag: "覆盖不全、非强制披露", status: "待接入" },
];

export type CnQuantNewsGate = {
  event: string;
  level: string;
  action: string;
};

export const CN_QUANT_NEWS_GATES: CnQuantNewsGate[] = [
  { event: "证监会/交易所重大新规首日（交易制度、程序化交易、退市、减持）", level: "全市场暂停新开仓 1–3 日", action: "待细则解读后再开新仓" },
  { event: "央行超预期收紧、汇率大幅波动、指数单日跌幅 >5%、融资余额单日降幅 >2%", level: "全市场暂停新开仓 1–3 日", action: "等信息消化，不追涨杀跌" },
  { event: "业绩预告大幅下滑/亏损、财报披露前 5 日", level: "个股暂停新买入", action: "直至披露后 1 个交易日" },
  { event: "大额解禁（>5% 流通股）、大股东减持计划公告期", level: "个股暂停新买入", action: "直至解禁后 3 日 / 减持期满或公告终止" },
  { event: "ST/*ST、问询函、立案调查、大宗深折价（<−8%）连续出现", level: "个股暂停新买入", action: "移出候选池，直至回复公告/调查结论" },
  { event: "一般性降准降息", level: "观察，不暂停", action: "作 regime 切换：宽松周期提高成长/券商/地产权重上限、降低低波权重" },
  { event: "行业规划征求意见稿、券商研报上调评级、社媒热度上升", level: "观察，不暂停", action: "只调权重，不触发硬门" },
];

export type CnQuantDataSource = {
  source: string;
  use: string;
  token: string;
  status: string;
};

export const CN_QUANT_DATA_SOURCES: CnQuantDataSource[] = [
  { source: "Baostock（证券宝）", use: "主源：历史日 K、财务、行业分类", token: "免费、免注册", status: "未接通" },
  { source: "Tushare Pro", use: "主源：日线 / 财务 / 复权因子最规范", token: "需注册 + token（积分制）", status: "未接通" },
  { source: "AKShare", use: "辅源：行情、资金流、龙虎榜、北向、大宗、两融、新闻", token: "免费、免 token", status: "未接通" },
  { source: "巨潮资讯 cninfo", use: "校验源：法定公告原文（预告、减持、解禁、问询函）", token: "免登录浏览", status: "未接通" },
  { source: "沪深北交易所官网", use: "校验源：交易规则、盘后资金流、停复牌、退市名单", token: "免登录", status: "未接通" },
  { source: "efinance / 东财直连", use: "快照补充：仅低频快照，不得作唯一源", token: "免费、免注册", status: "未接通" },
];
