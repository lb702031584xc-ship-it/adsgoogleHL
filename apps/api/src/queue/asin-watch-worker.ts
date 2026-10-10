/**
 * ASIN 需求异动监控 worker（第十批，BullMQ 每日任务）。
 *
 * 流程：取所有有跟踪 ASIN 的 tenant → PA-API GetItems 批量快照
 * （reviewCount / rating；PA-API 无 BSR，用评论数增速做需求代理）
 * → 与 7 天前快照对比 → 触发阈值 → 站内通知（alerts，24h 去重）。
 *
 * 单 tenant 失败只记日志，绝不抛错中断整轮。
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  getAmazonItems,
  parseAmazonCredentials,
} from "../networks/amazon-adapter.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import {
  detectSurge,
  DEFAULT_SURGE_THRESHOLDS,
  type SurgeThresholds,
} from "../asin-watch/surge.js";

const ALERT_DEDUPE_MS = 24 * 3600 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

async function getPaApiKey(prisma: PrismaClient): Promise<string | null> {
  const setting = await prisma.aiSetting.findUnique({
    where: { key: "amazon.paapiEnc" },
    select: { value: true },
  });
  if (setting?.value) {
    try {
      const pepper = assertAiSettingsPepperConfigured();
      return decryptSecret(setting.value, pepper);
    } catch {
      return null;
    }
  }
  return process.env.AMAZON_PAAPI_KEY ?? null;
}

async function getSurgeThresholds(
  prisma: PrismaClient
): Promise<SurgeThresholds> {
  try {
    const rows = await prisma.aiSetting.findMany({
      where: { key: { in: ["asinWatch.growthPct", "asinWatch.growthAbs"] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const pct = Number(map.get("asinWatch.growthPct"));
    const abs = Number(map.get("asinWatch.growthAbs"));
    return {
      growthPct:
        Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_SURGE_THRESHOLDS.growthPct,
      growthAbs:
        Number.isFinite(abs) && abs > 0 ? abs : DEFAULT_SURGE_THRESHOLDS.growthAbs,
    };
  } catch {
    return { ...DEFAULT_SURGE_THRESHOLDS };
  }
}

export async function processAsinWatchJob(input: {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  tenantId?: string;
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}): Promise<{
  tenants: number;
  snapshots: number;
  surges: number;
  alertsCreated: number;
}> {
  const log =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[asin-watch] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[asin-watch] ${msg}`, meta ?? ""),
    } as NonNullable<typeof input.log>);

  const apiKey = await getPaApiKey(input.prisma);
  if (!apiKey) {
    log.info("skip: PA-API 凭证未配置");
    return { tenants: 0, snapshots: 0, surges: 0, alertsCreated: 0 };
  }
  let creds;
  try {
    creds = parseAmazonCredentials(apiKey);
  } catch (e) {
    log.error("PA-API 凭证格式错误", { error: String(e) });
    return { tenants: 0, snapshots: 0, surges: 0, alertsCreated: 0 };
  }

  const thresholds = await getSurgeThresholds(input.prisma);
  const tenants = (await input.prisma.asinWatch.findMany({
    where: input.tenantId ? { tenantId: input.tenantId } : {},
    select: { tenantId: true },
    distinct: ["tenantId"],
  })) as Array<{ tenantId: string }>;

  let snapshots = 0;
  let surges = 0;
  let alertsCreated = 0;

  for (const { tenantId } of tenants) {
    try {
      const r = await processTenant(input.prisma, tenantId, creds, thresholds, log);
      snapshots += r.snapshots;
      surges += r.surges;
      alertsCreated += r.alertsCreated;
    } catch (e) {
      log.error("tenant 处理失败", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  log.info("scan complete", {
    triggeredBy: input.triggeredBy,
    tenants: tenants.length,
    snapshots,
    surges,
    alertsCreated,
  });
  return { tenants: tenants.length, snapshots, surges, alertsCreated };
}

async function processTenant(
  prisma: PrismaClient,
  tenantId: string,
  creds: ReturnType<typeof parseAmazonCredentials>,
  thresholds: SurgeThresholds,
  log: NonNullable<Parameters<typeof processAsinWatchJob>[0]["log"]>
): Promise<{ snapshots: number; surges: number; alertsCreated: number }> {
  const watches = (await prisma.asinWatch.findMany({
    where: { tenantId },
    select: { asin: true, title: true },
  })) as Array<{ asin: string; title: string | null }>;
  if (watches.length === 0) return { snapshots: 0, surges: 0, alertsCreated: 0 };

  let snapshots = 0;
  let surges = 0;
  let alertsCreated = 0;

  // GetItems 最多 10 个/次
  for (let i = 0; i < watches.length; i += 10) {
    const batch = watches.slice(i, i + 10);
    let products;
    try {
      products = await getAmazonItems(
        creds,
        batch.map((w) => w.asin)
      );
    } catch (e) {
      log.error("GetItems 失败", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const byAsin = new Map(products.map((p) => [p.asin.toUpperCase(), p]));
    for (const w of batch) {
      const p = byAsin.get(w.asin.toUpperCase());
      if (!p) continue;
      try {
        await prisma.asinSnapshot.create({
          data: {
            id: randomUUID(),
            tenantId,
            asin: w.asin.toUpperCase(),
            reviewCount: p.reviewCount,
            rating: p.rating,
            price: p.price,
            rawJson: JSON.parse(JSON.stringify(p)),
          },
        });
        snapshots += 1;
      } catch (e) {
        log.error("快照写入失败", { tenantId, asin: w.asin });
        continue;
      }
      // 异动判定：与 7 天前（或最早）快照对比
      const baseline = await findBaseline(prisma, tenantId, w.asin.toUpperCase());
      if (!baseline) continue;
      const surge = detectSurge(baseline.reviewCount, p.reviewCount, thresholds);
      if (!surge.surged) continue;
      surges += 1;
      const alerted = await recentAlertExists(prisma, tenantId, w.asin.toUpperCase());
      if (alerted) continue;
      await prisma.alert.create({
        data: {
          id: randomUUID(),
          tenantId,
          metric: "asin_surge",
          severity: "medium",
          message: `需求异动：${w.title ?? w.asin}（${w.asin}）${surge.reason}`,
          data: {
            asin: w.asin.toUpperCase(),
            title: w.title,
            oldReviewCount: baseline.reviewCount,
            newReviewCount: p.reviewCount,
            growthPct: surge.growthPct,
            growthAbs: surge.growthAbs,
          },
        },
      });
      alertsCreated += 1;
      log.info("surge alert", { tenantId, asin: w.asin, reason: surge.reason });
    }
  }
  return { snapshots, surges, alertsCreated };
}

/** 找 7 天前的基线快照（最接近但不超过 7 天前的那条；没有则取最早） */
async function findBaseline(
  prisma: PrismaClient,
  tenantId: string,
  asin: string
): Promise<{ reviewCount: number | null } | null> {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
  const before = (await prisma.asinSnapshot.findFirst({
    where: { tenantId, asin, capturedAt: { lte: cutoff } },
    orderBy: { capturedAt: "desc" },
    select: { reviewCount: true },
  })) as { reviewCount: number | null } | null;
  if (before) return before;
  // 不足 7 天历史：取最早的一条（排除刚刚写入的当前快照）
  const earliest = (await prisma.asinSnapshot.findFirst({
    where: { tenantId, asin, capturedAt: { lt: new Date(Date.now() - 60_000) } },
    orderBy: { capturedAt: "asc" },
    select: { reviewCount: true },
  })) as { reviewCount: number | null } | null;
  return earliest;
}

async function recentAlertExists(
  prisma: PrismaClient,
  tenantId: string,
  asin: string
): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_DEDUPE_MS);
  const count = (await prisma.alert.count({
    where: {
      tenantId,
      metric: "asin_surge",
      createdAt: { gte: since },
    },
  })) as number;
  if (count === 0) return false;
  // 粗粒度去重后再按 data.asin 精确过滤（避免 JSON 查询方言差异）
  const recent = (await prisma.alert.findMany({
    where: { tenantId, metric: "asin_surge", createdAt: { gte: since } },
    select: { data: true },
  })) as Array<{ data: unknown }>;
  return recent.some(
    (a) =>
      a.data !== null &&
      typeof a.data === "object" &&
      (a.data as Record<string, unknown>).asin === asin
  );
}
