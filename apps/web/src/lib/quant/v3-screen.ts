/**
 * 美股量化 P0：v3 筛选结果静态快照（2026-11-03 冻结版）。
 * 纯前端展示，不调 API、不写数据库、不接券商、不下单。
 * 数据来源：us-quant v3（行业内相对 PE 价值分 + 12-1 动量 + 质量 + 低波动，
 * 四维百分位等权，行业上限 3 只，进场 ≥70 / 退出 <50）。
 * 下一轮复算（2026-12 月初）按冻结的 v3 预登记规则换数据，不改规则；
 * 本文件届时整体替换，并标注新数据日期。
 */
export const QUANT_DATA_AS_OF = "2026-11-03";
export const QUANT_POOL_SIZE = 40;

export type QuantRow = {
  symbol: string;
  name: string;
  sector: string;
  sectorZh: string;
  composite: number;
  value: number;
  momentum: number;
  quality: number;
  lowVol: number;
  peRel: number;
};

export const QUANT_TOP10: QuantRow[] = [
  { symbol: "KO", name: "Coca-Cola", sector: "Staples", sectorZh: "必需消费", composite: 73.1, value: 50.0, momentum: 78.8, quality: 77.4, lowVol: 86.2, peRel: 1.0 },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Health", sectorZh: "医疗", composite: 70.8, value: 72.4, momentum: 88.8, quality: 55.9, lowVol: 66.2, peRel: 0.81 },
  { symbol: "MRK", name: "Merck", sector: "Health", sectorZh: "医疗", composite: 70.1, value: 88.2, momentum: 98.8, quality: 57.4, lowVol: 36.3, peRel: 0.67 },
  { symbol: "UNP", name: "Union Pacific", sector: "Indust", sectorZh: "工业", composite: 65.0, value: 50.0, momentum: 81.2, quality: 57.6, lowVol: 71.2, peRel: 1.0 },
  { symbol: "LIN", name: "Linde", sector: "Materials", sectorZh: "材料", composite: 62.2, value: 50.0, momentum: 66.2, quality: 36.3, lowVol: 96.2, peRel: 1.0 },
  { symbol: "BAC", name: "Bank of America", sector: "Fin", sectorZh: "金融", composite: 59.8, value: 82.9, momentum: 43.8, quality: 31.1, lowVol: 81.2, peRel: 0.76 },
  { symbol: "AAPL", name: "Apple", sector: "Tech", sectorZh: "科技", composite: 58.6, value: 22.4, momentum: 76.2, quality: 82.0, lowVol: 53.8, peRel: 1.4 },
  { symbol: "PG", name: "Procter & Gamble", sector: "Staples", sectorZh: "必需消费", composite: 57.9, value: 80.3, momentum: 28.7, quality: 43.9, lowVol: 78.8, peRel: 0.78 },
  { symbol: "LLY", name: "Eli Lilly", sector: "Health", sectorZh: "医疗", composite: 55.6, value: 6.6, momentum: 83.8, quality: 93.2, lowVol: 38.7, peRel: 2.03 },
  { symbol: "PEP", name: "PepsiCo", sector: "Staples", sectorZh: "必需消费", composite: 55.6, value: 90.8, momentum: 16.2, quality: 46.5, lowVol: 68.8, peRel: 0.56 },
];

export type SignalGateItem = {
  signal: string;
  date: string;
  status: string;
  note: string;
};

export const QUANT_SIGNAL_GATE: SignalGateItem[] = [
  { signal: "中期选举结果", date: "2026-11-03", status: "已过，未触发机械延期", note: "民主党横扫两院（媒体预测，非最终认证）；市场先跌后回升，AI 监管审查不确定性上升，仍偏谨慎。" },
  { signal: "美中关税框架到期", date: "2026-11-10", status: "待定", note: "以实际税率 / 许可条件为准，恶化则进场延期。" },
  { signal: "NVDA 财报", date: "2026-11-17", status: "待定", note: "增速较上季掉 20 个百分点以上，或 capex 指引下调，则进场延期。" },
  { signal: "FOMC 会议", date: "2026-12-08–09", status: "待定", note: "确认加息（是决定，不是概率）则进场延期。" },
  { signal: "苹果毛利率压制", date: "下一季指引", status: "待观察", note: "存储成本压制延续到下一季指引，则观察名单里的 AAPL 打折。" },
];
