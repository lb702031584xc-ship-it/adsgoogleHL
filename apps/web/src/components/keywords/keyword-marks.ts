/**
 * 长尾流水线（DataForSEO 实测扩词）标记与筛选口径（纯函数，无副作用）：
 * - 已购用户风险 / 型号特征两类启发式标记（确定性规则，是"特征"不是事实）
 * - 本地筛选 outcome 分类：pass / out-volume / out-competition / out-intent
 *   ——筛选只做标记不删词，被过滤的词可展开、可人工勾选保留
 * - 型号词稳定前置、勾选跨筛选/重扩保留等列表口径
 * - 主投口径（2026-11-08 用户定）：主投只取"有量且购买意图"的词；
 *   searchVolume 为 null/0 → 无量，不进主投；意图未知 → 不进主投；
 *   review / compare / info 意图 → 不进主投。无量词不得标"可投"。
 */
import type { DfsCandidate } from "@/lib/api/keyword-dataforseo-actions";

export type CompetitionMode = "lowPlusMedium" | "lowOnly" | "all";

export type FilterOutcome =
  | "pass"
  | "out-volume"
  | "out-competition"
  | "out-intent";

/** 按非字母数字切分 token（统一小写）。 */
export function tokensOf(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const OWNED_RISK_TOKENS = new Set([
  "app",
  "login",
  "support",
  "manual",
  "setup",
  "connect",
  "download",
  "fix",
  "pair",
  "pairing",
  "troubleshoot",
  "troubleshooting",
]);

const OWNED_RISK_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["sign", "in"],
  ["customer", "service"],
  ["how", "to"],
  ["set", "up"],
];

/**
 * 已购用户风险：命中 app / 登录 / 支持 / 说明书类词——搜的人多半已经买了
 * 产品、在找 App 或售后，不是买家。整 token 或固定短语比对，
 * 避免 "apple" 误伤 "app"、"application" 误伤 "app"。
 */
export function isOwnedUserRisk(keyword: string): boolean {
  const tokens = tokensOf(keyword);
  if (tokens.some((tk) => OWNED_RISK_TOKENS.has(tk))) return true;
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (OWNED_RISK_PHRASES.some(([x, y]) => x === a && y === b)) return true;
  }
  return false;
}

/**
 * 型号特征（启发式）：任一 token 含相邻的字母+数字（如 s8、q7、x40、s8pro）。
 * 纯数字（如年份 2024）不算。
 */
export function hasModelToken(keyword: string): boolean {
  return tokensOf(keyword).some((tk) => /[a-z]\d|\d[a-z]/.test(tk));
}

/** 竞争等级：优先响应原文 competition_level，缺失时按 0–1 数值分档；未知 → null（不拦）。 */
export function competitionLevelOf(
  c: DfsCandidate
): "LOW" | "MEDIUM" | "HIGH" | null {
  const raw = c.competitionLevel?.toUpperCase();
  if (raw === "LOW" || raw === "MEDIUM" || raw === "HIGH") return raw;
  if (c.competition === null) return null;
  if (c.competition <= 0.33) return "LOW";
  if (c.competition <= 0.66) return "MEDIUM";
  return "HIGH";
}

export function passesCompetition(
  c: DfsCandidate,
  mode: CompetitionMode
): boolean {
  if (mode === "all") return true;
  const level = competitionLevelOf(c);
  if (level === null) return true; // 未知不误杀
  if (mode === "lowOnly") return level === "LOW";
  return level === "LOW" || level === "MEDIUM";
}

/** 有量：searchVolume 明确 > 0。null / 0 都是无量——未知量不是"有量"，不能冒充。 */
export function hasVolume(searchVolume: number | null): searchVolume is number {
  return searchVolume != null && searchVolume > 0;
}

/** 购买意图：只认 DataForSEO 的 commercial / transactional。 */
export function isBuyIntent(intent: string | null | undefined): boolean {
  return intent === "commercial" || intent === "transactional";
}

/** 主投资格：有量且购买意图。意图未知（null）不进主投。 */
export function isMainListEligible(c: {
  searchVolume: number | null;
  intent?: string | null;
}): boolean {
  return hasVolume(c.searchVolume) && isBuyIntent(c.intent ?? null);
}

export function passesVolume(c: DfsCandidate, minVolume: number): boolean {
  // 无量（null/0）不进主投：主投只取有量词，与 minVolume 阈值无关。
  if (!hasVolume(c.searchVolume)) return false;
  return c.searchVolume >= minVolume;
}

/**
 * 本地筛选分类（不花钱的一轮）：第一道不过就定 outcome——先量后竞争，
 * 与步骤条「本地过滤后 {a} 条」口径一致（out-intent 仍计入本地幸存）。
 */
export function classifyLocalOutcomes(
  candidates: readonly DfsCandidate[],
  opts: { minVolume: number; competitionMode: CompetitionMode }
): Map<string, FilterOutcome> {
  const map = new Map<string, FilterOutcome>();
  for (const c of candidates) {
    const key = c.keyword.toLowerCase();
    if (!passesVolume(c, opts.minVolume)) map.set(key, "out-volume");
    else if (!passesCompetition(c, opts.competitionMode))
      map.set(key, "out-competition");
    else map.set(key, "pass");
  }
  return map;
}

/**
 * 意图过滤结果并入 outcome：只动当前 pass 的行；意图明确非 commercial /
 * transactional → out-intent；意图未知（null 或结果缺失）→ out-intent 且标
 * 未验证（2026-11-08 用户定：意图未知不进主投，可人工勾选保留）。
 * 返回新 Map，不改入参。
 */
export function applyIntentOutcomes(
  outcomes: ReadonlyMap<string, FilterOutcome>,
  intents: ReadonlyMap<string, string | null>
): { outcomes: Map<string, FilterOutcome>; hasUnverified: boolean } {
  const next = new Map(outcomes);
  let hasUnverified = false;
  for (const [key, outcome] of next) {
    if (outcome !== "pass") continue;
    const intent = intents.get(key) ?? null;
    if (intent === null) {
      // 意图未知不进主投（可人工勾选保留）；仍记未验证，供页面提示。
      next.set(key, "out-intent");
      hasUnverified = true;
      continue;
    }
    if (intent !== "commercial" && intent !== "transactional")
      next.set(key, "out-intent");
  }
  return { outcomes: next, hasUnverified };
}

/** 本地幸存数（pass + out-intent）——意图过滤实际处理的规模。 */
export function countLocalSurvivors(
  outcomes: ReadonlyMap<string, FilterOutcome>
): number {
  let n = 0;
  for (const o of outcomes.values())
    if (o === "pass" || o === "out-intent") n++;
  return n;
}

export function countOutcome(
  outcomes: ReadonlyMap<string, FilterOutcome>,
  target: FilterOutcome
): number {
  let n = 0;
  for (const o of outcomes.values()) if (o === target) n++;
  return n;
}

/** 含型号特征的行稳定前置（组内保持原序）。 */
export function modelFirstStable<T extends { keyword: string }>(
  rows: readonly T[]
): T[] {
  const withModel: T[] = [];
  const rest: T[] = [];
  for (const r of rows)
    (hasModelToken(r.keyword) ? withModel : rest).push(r);
  return [...withModel, ...rest];
}

/** 勾选保留：只留下仍在候选集内的词（小写键交集）。 */
export function keepSelectionWithin(
  prev: ReadonlySet<string>,
  keywords: readonly string[]
): Set<string> {
  const alive = new Set(keywords.map((k) => k.toLowerCase()));
  const next = new Set<string>();
  for (const k of prev) if (alive.has(k)) next.add(k);
  return next;
}

/**
 * 测算表展示序（主投清单口径）：有量词在前、按 CPC 升序（CPC 为 null 排组内最后），
 * 无量词沉底保原序。绝不拿 0 冒充数据。
 */
export function sortMeasureDisplay<
  T extends { searchVolume: number | null; cpc: number | null },
>(rows: readonly T[]): T[] {
  const withVolume = rows.filter((r) => hasVolume(r.searchVolume));
  const noVolume = rows.filter((r) => !hasVolume(r.searchVolume));
  withVolume.sort((a, b) => {
    if (a.cpc === null && b.cpc === null) return 0;
    if (a.cpc === null) return 1;
    if (b.cpc === null) return -1;
    return a.cpc - b.cpc;
  });
  return [...withVolume, ...noVolume];
}

export type ImportBlockReason = "no-volume" | "non-buy-intent" | "unknown";

export interface ImportBlock {
  keyword: string;
  reason: ImportBlockReason;
}

/**
 * 导入守门：只有"有量且购买意图"的词能进投放。量以测算结果为准（已测算时）、
 * 否则用扩词量；意图取筛选步的意图标签。被拦的词带原因返回，调用方展示、
 * 不得悄悄建进去。
 */
export function splitImportWords(
  words: readonly string[],
  candidatesByKey: ReadonlyMap<
    string,
    { searchVolume: number | null; intent?: string | null }
  >,
  measureByKey: ReadonlyMap<string, { searchVolume: number | null }>
): { eligible: string[]; blocked: ImportBlock[] } {
  const eligible: string[] = [];
  const blocked: ImportBlock[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    const cand = candidatesByKey.get(key);
    if (!cand) {
      blocked.push({ keyword: word, reason: "unknown" });
      continue;
    }
    // 量以测算结果为准：测算行存在时（哪怕量为 null）不回落到扩词量；
    // 只有未测算的词才用扩词量。
    const measured = measureByKey.get(key);
    const volume =
      measured !== undefined ? measured.searchVolume : cand.searchVolume;
    if (!hasVolume(volume)) {
      blocked.push({ keyword: word, reason: "no-volume" });
      continue;
    }
    const intent = cand.intent ?? null;
    if (intent === null) {
      blocked.push({ keyword: word, reason: "unknown" });
      continue;
    }
    if (!isBuyIntent(intent)) {
      blocked.push({ keyword: word, reason: "non-buy-intent" });
      continue;
    }
    eligible.push(word);
  }
  return { eligible, blocked };
}
