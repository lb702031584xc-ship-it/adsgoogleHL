/**
 * 功能 2 — 商家返利条款监控 (terms-watch) 核心逻辑.
 *
 * - 抓取: SSRF-safe 的 fetchPageHtml（10s 超时、私网 IP 拦截、手动跟随重定向）.
 * - 变化检测: 页面文本 sha256 hash；hash 变化才做关键词扫描.
 * - 关键词判定: 小写文本匹配禁止类模式（cashback/incentivized/返利 + prohibit/forbidden/禁止等）
 *   与允许类模式，给出 cashbackAllowed 三态 true|false|null.
 * - 关键动作: hash 变化且**新出现**“禁止返利流量”条款 →
 *   severity=critical 告警（metric "cashback_terms_blocked"，24h 同 watch 去重）+
 *   自动暂停该 tenant 下 destinationUrl 含 merchantDomain 的 ACTIVE TrackingLink.
 * - 单个 watch 失败只记 blocked，不抛错；checkAll 永不 throw.
 *
 * DB WIRING NOTE: 本文件通过 `prisma.cashbackTermsWatch` delegate 访问新表。
 * model 定义见 /tmp/terms-watch-models.prisma.txt — 需先加入
 * packages/database/prisma/schema.prisma 并重新生成 Prisma client。
 * delegate 类型在此用本地接口声明，因此 tsc 不依赖已生成的 client。
 */
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { fetchPageHtml } from "../ai/fetch-page.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CashbackTermsWatch 行（Prisma model 的 TypeScript 镜像）。 */
export interface CashbackTermsWatchRow {
  id: string;
  tenantId: string;
  merchantName: string;
  merchantDomain: string;
  termsUrl: string;
  termsHash: string | null;
  cashbackAllowed: boolean | null;
  lastChecked: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Prisma 生成的 cashbackTermsWatch delegate 的最小结构子集。 */
interface CashbackTermsWatchDelegate {
  findMany(args?: unknown): Promise<CashbackTermsWatchRow[]>;
  findFirst(args?: unknown): Promise<CashbackTermsWatchRow | null>;
  create(args: unknown): Promise<CashbackTermsWatchRow>;
  update(args: unknown): Promise<CashbackTermsWatchRow>;
}

function watchStore(prisma: PrismaClient): CashbackTermsWatchDelegate {
  const store = (prisma as unknown as { cashbackTermsWatch?: CashbackTermsWatchDelegate })
    .cashbackTermsWatch;
  if (!store) {
    throw new Error(
      "Prisma client is missing the cashbackTermsWatch delegate — add the CashbackTermsWatch model to schema.prisma and regenerate the client."
    );
  }
  return store;
}

export type TermsWatchStatus = "ok" | "changed" | "blocked";

export interface TermsWatchCheckResult {
  watchId: string;
  status: TermsWatchStatus;
  /** 本次检查 hash 是否发生变化（含首次检查）。 */
  hashChanged: boolean;
  cashbackAllowed: boolean | null;
  /** 本次是否新出现“禁止返利流量”条款（触发 critical 告警 + 自动暂停）。 */
  prohibitedNewly: boolean;
  pausedLinks: number;
  alertCreated: boolean;
  error?: string;
}

export interface TermsWatchCheckSummary {
  checked: number;
  changed: number;
  blocked: number;
  criticalAlerts: number;
  pausedLinks: number;
}

export interface TermsWatchLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface TermsWatchCheckOptions {
  log?: TermsWatchLog;
  /**
   * Injectable fetcher for tests. 默认使用 SSRF-safe 的 fetchPageHtml。
   * 只需要返回 { text, finalUrl }。
   */
  fetchPage?: (url: string) => Promise<{ text: string; finalUrl: string }>;
}

/** Alert metric for terms-blocked critical alerts (stored in Alert.metric). */
export const TERMS_WATCH_ALERT_METRIC = "cashback_terms_blocked";

/** 告警去重窗口：同一 watch 24h 内不重复建 critical 告警。 */
export const ALERT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

const noopLog: TermsWatchLog = {
  info: () => undefined,
  error: () => undefined,
};

// ---------------------------------------------------------------------------
// Hash + keyword classification (pure, unit-testable)
// ---------------------------------------------------------------------------

/** 页面文本 sha256 hex。 */
export function computeTermsHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const PROHIBIT_PATTERNS: RegExp[] = [
  // cashback ... prohibit/forbidden/not allowed/not permitted/banned
  /cashback[^.\n]{0,80}?(prohibit(?:ed|ion|s)?|forbidden|not\s+allowed|not\s+permitted|banned|disallowed)/i,
  // prohibit ... cashback（语序反转）
  /(prohibit(?:ed|ion|s)?|forbidden|not\s+allowed|not\s+permitted|banned|disallowed)[^.\n]{0,80}?cashback/i,
  // incentivized + prohibit 组合
  /incentivized[^.\n]{0,80}?(prohibit(?:ed|ion|s)?|forbidden|not\s+allowed|not\s+permitted|banned|disallowed)/i,
  /(prohibit(?:ed|ion|s)?|forbidden|not\s+allowed|not\s+permitted|banned|disallowed)[^.\n]{0,80}?incentivized/i,
  // 中文：返利 + 禁止/不允许/不得/严禁
  /返利.{0,30}?(禁止|不允许|被禁止|不得|严禁)/,
  /(禁止|不允许|不得|严禁).{0,30}?返利/,
];

const ALLOW_PATTERNS: RegExp[] = [
  /cashback[^.\n]{0,60}?(allowed|permitted|welcome|encouraged)/i,
  /(allowed|permitted|welcome)[^.\n]{0,60}?cashback/i,
  /返利.{0,20}?(允许|可以|欢迎)/,
];

const CASHBACK_KEYWORDS = ["cashback", "incentivized", "返利"];

export interface TermsClassification {
  /** true 允许 / false 禁止 / null 未知 */
  cashbackAllowed: boolean | null;
  /** 命中的禁止类信号（调试/展示用）。 */
  prohibitedSignals: string[];
}

/**
 * 条款文本三态判定：文本先转小写再匹配。
 * - 命中任意禁止类模式 → false
 * - 文本提到 cashback 且命中允许类模式 → true
 * - 否则 → null（未知）
 */
export function classifyTermsText(text: string): TermsClassification {
  const lowered = text.toLowerCase();
  const prohibitedSignals: string[] = [];
  for (const re of PROHIBIT_PATTERNS) {
    const m = re.exec(lowered);
    if (m) prohibitedSignals.push(m[0].slice(0, 120));
  }
  if (prohibitedSignals.length > 0) {
    return { cashbackAllowed: false, prohibitedSignals };
  }
  const mentionsCashback = CASHBACK_KEYWORDS.some((k) => lowered.includes(k));
  if (mentionsCashback && ALLOW_PATTERNS.some((re) => re.test(lowered))) {
    return { cashbackAllowed: true, prohibitedSignals: [] };
  }
  return { cashbackAllowed: null, prohibitedSignals: [] };
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/** "https://WWW.Foo.com/terms" → "www.foo.com"；非法输入返回 null。 */
export function normalizeMerchantDomain(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const withProto = t.includes("://") ? t : `https://${t}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname || u.hostname.includes(" ")) return null;
    return u.hostname;
  } catch {
    return null;
  }
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CRUD helpers (route layer 用)
// ---------------------------------------------------------------------------

export async function listTermsWatches(
  prisma: PrismaClient,
  tenantId: string
): Promise<CashbackTermsWatchRow[]> {
  return watchStore(prisma).findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createTermsWatch(
  prisma: PrismaClient,
  tenantId: string,
  input: { merchantName: string; merchantDomain: string; termsUrl: string }
): Promise<CashbackTermsWatchRow> {
  return watchStore(prisma).create({
    data: {
      id: randomUUID(),
      tenantId,
      merchantName: input.merchantName,
      merchantDomain: input.merchantDomain,
      termsUrl: input.termsUrl,
      termsHash: null,
      cashbackAllowed: null,
      lastChecked: null,
      status: "ok",
    },
  });
}

// ---------------------------------------------------------------------------
// Check logic
// ---------------------------------------------------------------------------

interface AlertRow {
  id: string;
  data: unknown;
}

async function maybeCreateCriticalAlert(
  prisma: PrismaClient,
  tenantId: string,
  watch: CashbackTermsWatchRow,
  pausedLinkIds: string[],
  signals: string[],
  log: TermsWatchLog
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
  const openAlerts = (await prisma.alert.findMany({
    where: {
      tenantId,
      metric: TERMS_WATCH_ALERT_METRIC,
      status: "open",
      createdAt: { gt: since },
    },
    select: { id: true, data: true },
  })) as AlertRow[];
  const dup = openAlerts.some(
    (a) =>
      typeof a.data === "object" &&
      a.data !== null &&
      (a.data as { watchId?: unknown }).watchId === watch.id
  );
  if (dup) {
    log.info("terms-watch alert deduped (24h)", {
      watchId: watch.id,
      tenantId,
    });
    return false;
  }
  await prisma.alert.create({
    data: {
      id: randomUUID(),
      tenantId,
      ruleId: null,
      trackingLinkId: null,
      metric: TERMS_WATCH_ALERT_METRIC,
      severity: "critical",
      message:
        `商家「${watch.merchantName}」的条款页面（${watch.termsUrl}）` +
        `出现“禁止返利流量”类条款，已自动暂停 ${pausedLinkIds.length} 个跟踪链接。` +
        `请人工复核条款后再恢复投放。`,
      // Deep-clone 为 plain JSON，适配 Prisma Json 字段。
      data: JSON.parse(
        JSON.stringify({
          watchId: watch.id,
          merchantName: watch.merchantName,
          merchantDomain: watch.merchantDomain,
          termsUrl: watch.termsUrl,
          pausedLinkIds,
          signals: signals.slice(0, 5),
        })
      ),
      status: "open",
    },
  });
  return true;
}

/**
 * 自动暂停：该 tenant 下所有 ACTIVE、且其 offer destinationUrl 包含
 * merchantDomain 的 TrackingLink（schema 上 destinationUrl 在 Offer 表，
 * 通过 trackingLink.offer 关联匹配）。
 */
async function pauseMerchantTrackingLinks(
  prisma: PrismaClient,
  tenantId: string,
  merchantDomain: string,
  log: TermsWatchLog
): Promise<string[]> {
  const links = await prisma.trackingLink.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      offer: { destinationUrl: { contains: merchantDomain } },
    },
    select: { id: true },
  });
  const paused: string[] = [];
  for (const link of links) {
    try {
      await prisma.trackingLink.update({
        where: { id: link.id },
        data: { status: "PAUSED" },
      });
      paused.push(link.id);
    } catch (error) {
      // 单个暂停失败不影响其余链接。
      log.error("terms-watch failed to pause tracking link", {
        linkId: link.id,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return paused;
}

/**
 * 检查单个 watch。单个 watch 失败只记 blocked，永不 throw。
 */
export async function checkTermsWatch(
  prisma: PrismaClient,
  watch: CashbackTermsWatchRow,
  options: TermsWatchCheckOptions = {}
): Promise<TermsWatchCheckResult> {
  const log = options.log ?? noopLog;
  const fetchFn = options.fetchPage ?? fetchPageHtml;
  const store = watchStore(prisma);

  let text: string;
  try {
    const page = await fetchFn(watch.termsUrl);
    text = page.text;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error("terms-watch fetch blocked", {
      watchId: watch.id,
      tenantId: watch.tenantId,
      error: msg,
    });
    const updated = await store.update({
      where: { id: watch.id },
      data: { status: "blocked", lastChecked: new Date() },
    });
    return {
      watchId: watch.id,
      status: "blocked",
      hashChanged: false,
      cashbackAllowed: updated.cashbackAllowed,
      prohibitedNewly: false,
      pausedLinks: 0,
      alertCreated: false,
      error: msg,
    };
  }

  const hash = computeTermsHash(text);
  const hashChanged = watch.termsHash === null || watch.termsHash !== hash;
  const classification = classifyTermsText(text);
  const newlyProhibited =
    hashChanged &&
    classification.cashbackAllowed === false &&
    watch.cashbackAllowed !== false;

  let pausedLinks: string[] = [];
  let alertCreated = false;
  if (newlyProhibited) {
    log.info("terms-watch detected prohibited cashback terms", {
      watchId: watch.id,
      tenantId: watch.tenantId,
      merchantDomain: watch.merchantDomain,
    });
    // 先暂停，再写 critical 告警（告警 data 携带被暂停的链接）。
    pausedLinks = await pauseMerchantTrackingLinks(
      prisma,
      watch.tenantId,
      watch.merchantDomain,
      log
    );
    alertCreated = await maybeCreateCriticalAlert(
      prisma,
      watch.tenantId,
      watch,
      pausedLinks,
      classification.prohibitedSignals,
      log
    );
  }

  const status: TermsWatchStatus = hashChanged ? "changed" : "ok";
  const updated = await store.update({
    where: { id: watch.id },
    data: {
      termsHash: hash,
      cashbackAllowed: classification.cashbackAllowed,
      lastChecked: new Date(),
      status,
    },
  });
  log.info("terms-watch check complete", {
    watchId: watch.id,
    tenantId: watch.tenantId,
    status,
    hashChanged,
    cashbackAllowed: classification.cashbackAllowed,
    pausedLinks: pausedLinks.length,
  });
  return {
    watchId: watch.id,
    status,
    hashChanged,
    cashbackAllowed: updated.cashbackAllowed,
    prohibitedNewly: newlyProhibited,
    pausedLinks: pausedLinks.length,
    alertCreated,
  };
}

/** 检查一个 tenant（或全部 tenant）的所有 watch；逐个隔离错误，永不 throw。 */
export async function checkAllTermsWatches(
  prisma: PrismaClient,
  tenantId: string | undefined,
  options: TermsWatchCheckOptions = {}
): Promise<TermsWatchCheckSummary> {
  const log = options.log ?? noopLog;
  const summary: TermsWatchCheckSummary = {
    checked: 0,
    changed: 0,
    blocked: 0,
    criticalAlerts: 0,
    pausedLinks: 0,
  };
  let watches: CashbackTermsWatchRow[];
  try {
    watches = await watchStore(prisma).findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    log.error("terms-watch failed to list watches", {
      tenantId: tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    return summary;
  }

  for (const watch of watches) {
    try {
      const result = await checkTermsWatch(prisma, watch, options);
      summary.checked += 1;
      if (result.status === "changed") summary.changed += 1;
      if (result.status === "blocked") summary.blocked += 1;
      if (result.alertCreated) summary.criticalAlerts += 1;
      summary.pausedLinks += result.pausedLinks;
    } catch (error) {
      // 一个 watch 的意外错误不能卡住整轮扫描。
      log.error("terms-watch check failed for watch", {
        watchId: watch.id,
        tenantId: watch.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
}
