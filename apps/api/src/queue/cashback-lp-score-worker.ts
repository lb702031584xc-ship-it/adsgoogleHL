/**
 * Feature: 返利落地页合规评分 (lp-cashback-score) — weekly re-score worker.
 *
 * BullMQ worker. WIRING (done by the parent orchestrator, NOT in this file):
 *   - queue name:  `cashback-lp-score`
 *   - job name:    `cashback-lp-score-check`
 *   - repeat:      `0 3 * * 0`  (every Sunday at 03:00)
 *   Register in queue-catalog.ts with:
 *     queueName: "cashback-lp-score",
 *     processorModule: "cashback-lp-score-worker.ts",
 *     processorExport: "processCashbackLpScoreJob",
 *
 * The job re-scores every landing page that is associated with a cashback
 * offer and auto-creates a LandingPageOptimizationTask for pages scoring
 * < 70 (deduplicated: an existing PENDING task for the same landing page
 * is never duplicated; priority < 50 → HIGH, < 70 → MEDIUM).
 *
 * Association (from the Prisma schema — there is no direct
 * LandingPage → CashbackOffer FK):
 *   CashbackOffer.trackingLinkId → TrackingLink.landingPageId → LandingPage
 * i.e. a landing page is in scope when at least one of its tracking links
 * is bound to a cashback offer. The reverse relation
 * TrackingLink.cashbackOffers[] is the same link, queried here from the
 * CashbackOffer side.
 *
 * Never throws: per-page failures are logged and skipped; a top-level
 * failure is caught and reported in the returned summary.
 */
import type { PrismaClient } from "@adlinklab/database";
import { randomUUID } from "node:crypto";
import { scoreCashbackLandingPage } from "../services/cashback-lp-scorer.js";

export interface CashbackLpScoreLog {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CashbackLpScoreJobInput {
  prisma: PrismaClient;
  triggeredBy: "schedule" | "manual";
  /** When set, only this tenant is scanned; otherwise all tenants. */
  tenantId?: string;
  log?: CashbackLpScoreLog;
}

export interface CashbackLpScoreSummary {
  /** Distinct (tenant, landingPage) pairs evaluated. */
  checked: number;
  /** Pages that had HTML content and were scored. */
  scored: number;
  /** Pages skipped because they have no stored HTML content. */
  skippedNoHtml: number;
  /** Optimization tasks created (< 70, deduplicated). */
  tasksCreated: number;
  tenants: number;
}

/**
 * BullMQ processor for the `cashback-lp-score-check` job on the
 * `cashback-lp-score` queue. Returns a summary for observability.
 * Never throws.
 */
export async function processCashbackLpScoreJob(
  input: CashbackLpScoreJobInput
): Promise<CashbackLpScoreSummary> {
  const log: CashbackLpScoreLog =
    input.log ??
    ({
      info: (msg: string, meta?: Record<string, unknown>) =>
        console.log(`[cashback-lp-score] ${msg}`, meta ?? ""),
      error: (msg: string, meta?: Record<string, unknown>) =>
        console.error(`[cashback-lp-score] ${msg}`, meta ?? ""),
    } as CashbackLpScoreLog);

  const summary: CashbackLpScoreSummary = {
    checked: 0,
    scored: 0,
    skippedNoHtml: 0,
    tasksCreated: 0,
    tenants: 0,
  };

  try {
    // All cashback offers bound to a tracking link, grouped per tenant.
    // detectedRate comes from the latest CashbackRateCheck per offer.
    const offers = await input.prisma.cashbackOffer.findMany({
      where: {
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        trackingLinkId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        trackingLink: { select: { landingPageId: true } },
      },
    });

    // landingPageId -> { tenantId, offerIds }
    const pagesByTenant = new Map<string, Map<string, string[]>>();
    for (const offer of offers) {
      const landingPageId = offer.trackingLink?.landingPageId;
      if (!landingPageId) continue;
      let tenantMap = pagesByTenant.get(offer.tenantId);
      if (!tenantMap) {
        tenantMap = new Map<string, string[]>();
        pagesByTenant.set(offer.tenantId, tenantMap);
      }
      const arr = tenantMap.get(landingPageId) ?? [];
      arr.push(offer.id);
      tenantMap.set(landingPageId, arr);
    }
    summary.tenants = pagesByTenant.size;

    for (const [tenantId, landingPages] of pagesByTenant) {
      for (const [landingPageId, offerIds] of landingPages) {
        summary.checked += 1;
        try {
          const page = await input.prisma.landingPage.findFirst({
            where: { id: landingPageId, tenantId },
            select: { id: true, htmlContent: true },
          });
          if (!page || !page.htmlContent) {
            summary.skippedNoHtml += 1;
            continue;
          }
          const latestCheck = await input.prisma.cashbackRateCheck.findFirst({
            where: { tenantId, cashbackOfferId: { in: offerIds } },
            orderBy: { checkedAt: "desc" },
            select: { detectedRate: true },
          });
          const { score, issues } = scoreCashbackLandingPage(
            page.htmlContent,
            { detectedRate: latestCheck?.detectedRate ?? null }
          );
          summary.scored += 1;

          if (score < 70) {
            const existing =
              await input.prisma.landingPageOptimizationTask.findFirst({
                where: { tenantId, landingPageId, status: "PENDING" },
                select: { id: true },
              });
            if (existing) continue;
            await input.prisma.landingPageOptimizationTask.create({
              data: {
                id: randomUUID(),
                tenantId,
                landingPageId,
                score,
                issues,
                priority: score < 50 ? "HIGH" : "MEDIUM",
              },
            });
            summary.tasksCreated += 1;
          }
        } catch (error) {
          // Per-page failure must not wedge the weekly run.
          log.error("cashback-lp-score page failed", {
            tenantId,
            landingPageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    log.error("cashback-lp-score scan aborted", {
      triggeredBy: input.triggeredBy,
      tenantId: input.tenantId ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  log.info("cashback-lp-score scan complete", {
    triggeredBy: input.triggeredBy,
    tenantId: input.tenantId ?? "all",
    ...summary,
  });
  return summary;
}
