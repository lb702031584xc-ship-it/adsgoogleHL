/**
 * 功能 1 — 返利比例监控（rate-watch）核心逻辑：抓取 + 解析 + 比对 + 告警。
 *
 * 架构说明（重要）：
 * - CashbackRateCheck 表尚未合并进 packages/database/prisma/schema.prisma
 *   （按任务约束不碰 schema），因此 PrismaClient 没有对应的 delegate。
 *   本文件用 `prisma.$queryRawUnsafe / $executeRawUnsafe` 做参数化查询，
 *   通过 RateCheckStore 接口隔离 SQL；等迁移 + client 重新生成后，可把
 *   SqlRateCheckStore 换成 delegate 实现，调用方逻辑无需改动。
 * - 抓取复用 ai/fetch-page.ts 的 fetchPageHtml（已防 SSRF），try/catch 包住，
 *   单个 offer 失败只记 unreachable，绝不抛错。
 *
 * 语义：
 * - advertisedRate：用户填写的宣传比例（字符串，如 "8%" / "$12"）。
 * - rateUrl：抓取返利比例的页面 URL；未设置时用 CashbackOffer.originalUrl。
 * - status：ok（一致）| mismatch（不一致 → 写 Alert）| unreachable（抓不到/解析不到）。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import { ValidationError } from "@adlinklab/shared";
import { fetchPageHtml } from "../ai/fetch-page.js";

/** 告警 metric：返利比例不一致。 */
export const CASHBACK_RATE_MISMATCH_METRIC = "cashback_rate_mismatch";

/** 告警去重窗口：同一 offer 同一 metric 24h 内只告警一次。 */
const ALERT_DEDUPE_WINDOW_MS = 24 * 3600 * 1000;

export type RateCheckStatus = "ok" | "mismatch" | "unreachable";

export interface RateCheckRow {
  id: string;
  tenantId: string;
  cashbackOfferId: string;
  advertisedRate: string;
  detectedRate: string | null;
  rateUrl: string | null;
  status: RateCheckStatus;
  checkedAt: Date;
}

export interface RateCheckWithOffer extends RateCheckRow {
  cashbackNetwork: string;
  originalUrl: string;
  offerStatus: string;
}

export interface InsertRateCheckInput {
  cashbackOfferId: string;
  advertisedRate: string;
  detectedRate: string | null;
  rateUrl: string | null;
  status: RateCheckStatus;
}

/**
 * CashbackRateCheck 持久化接口。SQL 实现见 SqlRateCheckStore；
 * 单元测试注入内存假实现即可。
 */
export interface RateCheckStore {
  insert(tenantId: string, input: InsertRateCheckInput): Promise<RateCheckRow>;
  latestForOffer(
    tenantId: string,
    cashbackOfferId: string
  ): Promise<RateCheckRow | null>;
  latestForTenant(tenantId: string): Promise<RateCheckWithOffer[]>;
  historyForOffer(
    tenantId: string,
    cashbackOfferId: string,
    limit: number
  ): Promise<RateCheckRow[]>;
}

// ---------------------------------------------------------------------------
// 比例解析 / 比对
// ---------------------------------------------------------------------------

export type RateKind = "percent" | "amount";

export interface ParsedRate {
  kind: RateKind;
  value: number;
  /** 匹配到的原始文本（如 "8%" / "$12.5"）。 */
  raw: string;
}

const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/;
const AMOUNT_RE = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*\$/;

/**
 * 从文本中解析返利比例：优先提第一个百分比；没有百分比时尝试 $ 金额；
 * 都解析不到返回 null（调用方记为 unreachable）。
 */
export function parseRate(raw: string): ParsedRate | null {
  const text = raw ?? "";
  const pct = PERCENT_RE.exec(text);
  if (pct) {
    return { kind: "percent", value: Number(pct[1]), raw: pct[0] };
  }
  const amt = AMOUNT_RE.exec(text);
  if (amt) {
    const num = amt[1] ?? amt[2];
    return { kind: "amount", value: Number(num), raw: amt[0] };
  }
  return null;
}

export interface CompareResult {
  status: RateCheckStatus;
  /** 抓取页面解析出的比例原文（解析不到时为 null）。 */
  detectedRate: string | null;
}

/**
 * 比对 advertised（用户填写）与页面抓取文本。
 * advertised 解析失败 → 抛 ValidationError（输入错误，调用方应返回 400）。
 * 页面解析不到 → unreachable；种类不同（% vs $）→ mismatch；
 * 数值差在 1e-3 内 → ok。
 */
export function compareRates(
  advertisedRaw: string,
  pageText: string
): CompareResult {
  const advertised = parseRate(advertisedRaw);
  if (!advertised) {
    throw new ValidationError(
      `advertisedRate 无法解析（需要形如 "8%" 或 "$12" 的比例）: ${advertisedRaw}`
    );
  }
  const detected = parseRate(pageText);
  if (!detected) {
    return { status: "unreachable", detectedRate: null };
  }
  if (detected.kind !== advertised.kind) {
    return { status: "mismatch", detectedRate: detected.raw };
  }
  const equal = Math.abs(detected.value - advertised.value) < 1e-3;
  return {
    status: equal ? "ok" : "mismatch",
    detectedRate: detected.raw,
  };
}

// ---------------------------------------------------------------------------
// SQL 实现（raw SQL：client 尚无 delegate）
// ---------------------------------------------------------------------------

const INSERT_SQL = `INSERT INTO cashback_rate_checks
  (id, tenant_id, cashback_offer_id, advertised_rate, detected_rate, rate_url, status, checked_at)
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, NOW())
  RETURNING id, tenant_id AS "tenantId", cashback_offer_id AS "cashbackOfferId",
            advertised_rate AS "advertisedRate", detected_rate AS "detectedRate",
            rate_url AS "rateUrl", status, checked_at AS "checkedAt"`;

const LATEST_FOR_OFFER_SQL = `SELECT id, tenant_id AS "tenantId",
  cashback_offer_id AS "cashbackOfferId", advertised_rate AS "advertisedRate",
  detected_rate AS "detectedRate", rate_url AS "rateUrl", status, checked_at AS "checkedAt"
  FROM cashback_rate_checks
  WHERE tenant_id = $1::uuid AND cashback_offer_id = $2::uuid
  ORDER BY checked_at DESC LIMIT 1`;

const HISTORY_FOR_OFFER_SQL = `SELECT id, tenant_id AS "tenantId",
  cashback_offer_id AS "cashbackOfferId", advertised_rate AS "advertisedRate",
  detected_rate AS "detectedRate", rate_url AS "rateUrl", status, checked_at AS "checkedAt"
  FROM cashback_rate_checks
  WHERE tenant_id = $1::uuid AND cashback_offer_id = $2::uuid
  ORDER BY checked_at DESC LIMIT $3`;

const LATEST_FOR_TENANT_SQL = `SELECT DISTINCT ON (c.cashback_offer_id)
  c.id, c.tenant_id AS "tenantId", c.cashback_offer_id AS "cashbackOfferId",
  c.advertised_rate AS "advertisedRate", c.detected_rate AS "detectedRate",
  c.rate_url AS "rateUrl", c.status, c.checked_at AS "checkedAt",
  o.cashback_network AS "cashbackNetwork", o.original_url AS "originalUrl",
  o.status AS "offerStatus"
  FROM cashback_rate_checks c
  JOIN cashback_offers o ON o.id = c.cashback_offer_id
  WHERE c.tenant_id = $1::uuid AND o.deleted_at IS NULL
  ORDER BY c.cashback_offer_id, c.checked_at DESC`;

/** Raw-SQL RateCheckStore 实现（参数化查询，无拼接）。 */
export class SqlRateCheckStore implements RateCheckStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(
    tenantId: string,
    input: InsertRateCheckInput
  ): Promise<RateCheckRow> {
    const rows = await this.prisma.$queryRawUnsafe<RateCheckRow[]>(
      INSERT_SQL,
      randomUUID(),
      tenantId,
      input.cashbackOfferId,
      input.advertisedRate,
      input.detectedRate,
      input.rateUrl,
      input.status
    );
    const row = rows[0];
    if (!row) throw new Error("cashback_rate_checks insert returned no row");
    return row;
  }

  async latestForOffer(
    tenantId: string,
    cashbackOfferId: string
  ): Promise<RateCheckRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<RateCheckRow[]>(
      LATEST_FOR_OFFER_SQL,
      tenantId,
      cashbackOfferId
    );
    return rows[0] ?? null;
  }

  async latestForTenant(tenantId: string): Promise<RateCheckWithOffer[]> {
    return this.prisma.$queryRawUnsafe<RateCheckWithOffer[]>(
      LATEST_FOR_TENANT_SQL,
      tenantId
    );
  }

  async historyForOffer(
    tenantId: string,
    cashbackOfferId: string,
    limit: number
  ): Promise<RateCheckRow[]> {
    return this.prisma.$queryRawUnsafe<RateCheckRow[]>(
      HISTORY_FOR_OFFER_SQL,
      tenantId,
      cashbackOfferId,
      Math.max(1, Math.min(200, Math.floor(limit)))
    );
  }
}

// ---------------------------------------------------------------------------
// 抓取 + 检查
// ---------------------------------------------------------------------------

/** 可注入的抓取实现：默认 fetchPageHtml。返回页面纯文本。 */
export type RatePageFetch = (url: string) => Promise<string>;

export async function defaultRatePageFetch(url: string): Promise<string> {
  const page = await fetchPageHtml(url);
  return page.text;
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export interface RateCheckOffer {
  id: string;
  tenantId: string;
  cashbackNetwork: string;
  originalUrl: string;
}

export interface CheckSingleOfferOpts {
  /** 覆盖本次使用的宣传比例；不传则用该 offer 最近一次检查的 advertisedRate。 */
  advertisedRate?: string;
  /** 覆盖本次抓取的 URL；不传则用最近一次检查的 rateUrl，仍无则用 originalUrl。 */
  rateUrl?: string;
  fetchImpl?: RatePageFetch;
  store?: RateCheckStore;
}

export interface CheckSingleOfferResult {
  check: RateCheckRow;
  /** 是否写了 mismatch 告警。 */
  alertCreated: boolean;
}

/**
 * 对单个 offer 做一次返利比例检查：抓取 → 解析 → 比对 → 落库 → mismatch 告警。
 * advertisedRate 未设置（且 opts 也没给）时抛 ValidationError，调用方转 400。
 * 抓取/解析失败一律记 unreachable，不抛错。
 */
export async function checkSingleOffer(
  prisma: PrismaClient,
  tenantId: string,
  offer: RateCheckOffer,
  opts: CheckSingleOfferOpts = {}
): Promise<CheckSingleOfferResult> {
  const store = opts.store ?? new SqlRateCheckStore(prisma);
  const fetchImpl = opts.fetchImpl ?? defaultRatePageFetch;

  const prev = await store.latestForOffer(tenantId, offer.id);
  const advertisedRate = opts.advertisedRate ?? prev?.advertisedRate ?? null;
  if (!advertisedRate || !advertisedRate.trim()) {
    throw new ValidationError(
      "请先设置宣传比例（advertisedRate），例如 \"8%\""
    );
  }
  // 先做输入校验：advertisedRate 必须能被解析，否则直接 400，不落库。
  compareRates(advertisedRate, advertisedRate);

  const rateUrl =
    opts.rateUrl ?? prev?.rateUrl ?? offer.originalUrl ?? null;

  let status: RateCheckStatus;
  let detectedRate: string | null = null;
  if (!rateUrl || !isHttpUrl(rateUrl)) {
    status = "unreachable";
  } else {
    try {
      const text = await fetchImpl(rateUrl);
      const compared = compareRates(advertisedRate, text);
      status = compared.status;
      detectedRate = compared.detectedRate;
    } catch {
      // 抓取失败（SSRF 拦截 / 超时 / DNS 等）→ unreachable，不抛错。
      status = "unreachable";
    }
  }

  const check = await store.insert(tenantId, {
    cashbackOfferId: offer.id,
    advertisedRate,
    detectedRate,
    rateUrl,
    status,
  });

  let alertCreated = false;
  if (status === "mismatch") {
    alertCreated = await maybeCreateMismatchAlert(
      prisma,
      tenantId,
      offer,
      advertisedRate,
      detectedRate
    );
  }
  return { check, alertCreated };
}

/**
 * mismatch 时写 Alert（24h 内同 offer 同 metric 已有 open 告警则去重）。
 * 永不抛错：告警失败不能影响检查流程。
 */
export async function maybeCreateMismatchAlert(
  prisma: PrismaClient,
  tenantId: string,
  offer: RateCheckOffer,
  advertisedRate: string,
  detectedRate: string | null
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - ALERT_DEDUPE_WINDOW_MS);
    const recent = await prisma.alert.findMany({
      where: {
        tenantId,
        metric: CASHBACK_RATE_MISMATCH_METRIC,
        status: "open",
        createdAt: { gte: since },
      },
      select: { id: true, data: true },
    });
    const dup = recent.some(
      (r) =>
        r.data != null &&
        typeof r.data === "object" &&
        (r.data as Record<string, unknown>).cashbackOfferId === offer.id
    );
    if (dup) return false;

    const network = offer.cashbackNetwork || "返利";
    await prisma.alert.create({
      data: {
        id: randomUUID(),
        tenantId,
        ruleId: null,
        trackingLinkId: null,
        metric: CASHBACK_RATE_MISMATCH_METRIC,
        severity: "warning",
        message: `返利比例不一致：${network} offer（${offer.id}）宣传比例为 ${advertisedRate}，实际抓取到 ${detectedRate ?? "（未解析到）"}。请核对商家页面是否已调整比例。`,
        data: JSON.parse(
          JSON.stringify({
            entityType: "CashbackOffer",
            cashbackOfferId: offer.id,
            cashbackNetwork: offer.cashbackNetwork,
            advertisedRate,
            detectedRate,
            rateUrl: offer.originalUrl,
          })
        ),
        status: "open",
      },
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 批量扫描（worker 调用）
// ---------------------------------------------------------------------------

export interface RateWatchScanSummary {
  checked: number;
  ok: number;
  mismatch: number;
  unreachable: number;
  alertsCreated: number;
  /** 有 active offer 但从未设置 advertisedRate，跳过。 */
  skippedNoConfig: number;
}

export interface CheckAllActiveOffersOpts {
  fetchImpl?: RatePageFetch;
  store?: RateCheckStore;
}

/**
 * 扫描该租户（或全租户）所有 status=active 且未删除的 CashbackOffer，
 * 逐个做比例检查。单个 offer 失败不影响其他；整体永不抛错。
 */
export async function checkAllActiveOffers(
  prisma: PrismaClient,
  tenantId: string | undefined,
  opts: CheckAllActiveOffersOpts = {}
): Promise<RateWatchScanSummary> {
  const summary: RateWatchScanSummary = {
    checked: 0,
    ok: 0,
    mismatch: 0,
    unreachable: 0,
    alertsCreated: 0,
    skippedNoConfig: 0,
  };
  const store = opts.store ?? new SqlRateCheckStore(prisma);

  let offers: RateCheckOffer[];
  try {
    offers = await prisma.cashbackOffer.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: "active",
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        cashbackNetwork: true,
        originalUrl: true,
      },
    });
  } catch {
    return summary;
  }

  for (const offer of offers) {
    try {
      const prev = await store.latestForOffer(offer.tenantId, offer.id);
      const advertised = prev?.advertisedRate;
      if (!advertised || !advertised.trim()) {
        summary.skippedNoConfig += 1;
        continue;
      }
      const { check, alertCreated } = await checkSingleOffer(
        prisma,
        offer.tenantId,
        offer,
        { fetchImpl: opts.fetchImpl, store }
      );
      summary.checked += 1;
      summary[check.status] += 1;
      if (alertCreated) summary.alertsCreated += 1;
    } catch {
      // 单个 offer 的任何意外错误都只跳过，不中断整批扫描。
    }
  }
  return summary;
}

/** 列表：该租户每个 offer 的最新一次检查（带 offer 信息）。 */
export async function listLatestRateChecks(
  prisma: PrismaClient,
  tenantId: string,
  store?: RateCheckStore
): Promise<RateCheckWithOffer[]> {
  return (store ?? new SqlRateCheckStore(prisma)).latestForTenant(tenantId);
}

/** 历史：单个 offer 的检查记录（倒序）。 */
export async function listRateCheckHistory(
  prisma: PrismaClient,
  tenantId: string,
  cashbackOfferId: string,
  limit = 50,
  store?: RateCheckStore
): Promise<RateCheckRow[]> {
  return (store ?? new SqlRateCheckStore(prisma)).historyForOffer(
    tenantId,
    cashbackOfferId,
    limit
  );
}
