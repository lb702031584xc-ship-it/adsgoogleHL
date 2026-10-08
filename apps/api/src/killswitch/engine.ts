/**
 * Phase 3 Optimization — Kill Switch condition engine.
 *
 * Pure addition: evaluates per-offer kill-switch thresholds and, when
 * conditions fire, records the firing and either alerts (default) or
 * auto-pauses every tracking link bound to the offer.
 *
 * Condition order (all must have data, otherwise the condition is skipped):
 *  1. SPEND_PROFIT: actual spend > maxSpend AND expected profit < minExpectedProfit.
 *     Spend is derived from real click counts × the latest ProfitModel base CPC
 *     (the codebase has no true spend table); expected profit is recomputed
 *     from the model inputs against the real click count.
 *  2. CVR_FLOOR: actual conversions / actual clicks < minCvr.
 *  3. POLICY_RISK: latest OfferRiskScore.policyScore converted to risk
 *     (risk = 100 - policyScore; higher score = safer) >= maxPolicyRisk.
 *  4. MERCHANT_TERMINATED: offer.merchant.status = TERMINATED.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";

export type KillSwitchTriggerType =
  | "SPEND_PROFIT"
  | "CVR_FLOOR"
  | "POLICY_RISK"
  | "MERCHANT_TERMINATED";

export interface KillSwitchTrigger {
  type: KillSwitchTriggerType;
  message: string;
  snapshot: Record<string, unknown>;
}

export interface KillSwitchEvaluation {
  offerId: string;
  tenantId: string;
  offerName: string;
  /** Null when the offer has no KillSwitchConfig row yet. */
  config: {
    id: string;
    enabled: boolean;
  } | null;
  triggers: KillSwitchTrigger[];
  /** Condition names skipped because required data was missing. */
  skipped: string[];
}

export interface KillSwitchExecutionResult extends KillSwitchEvaluation {
  /** "NONE" when no condition fired. */
  actionTaken: "NONE" | "ALERT_ONLY" | "PAUSED_ALL_LINKS";
  linksPaused: number;
  eventIds: string[];
  alertCreated: boolean;
}

const ALERT_DEDUPE_MS = 24 * 3600 * 1000;

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface ProfitInputs {
  commission: number;
  expectedCvr: number;
  approvalRate: number;
  attributionRate: number;
  refundRate: number;
  baseCpc: number;
}

function readProfitInputs(model: {
  commission: unknown;
  expectedCvr: unknown;
  approvalRate: unknown;
  attributionRate: unknown;
  refundRate: unknown;
  scenarios: unknown;
}): ProfitInputs | null {
  const commission = toNumber(model.commission);
  const expectedCvr = toNumber(model.expectedCvr);
  const approvalRate = toNumber(model.approvalRate);
  const attributionRate = toNumber(model.attributionRate);
  const refundRate = toNumber(model.refundRate);
  const scenarios = model.scenarios as
    | { base?: { cpc?: unknown } }
    | null
    | undefined;
  const baseCpc = toNumber(scenarios?.base?.cpc);
  if (
    commission === null ||
    expectedCvr === null ||
    approvalRate === null ||
    attributionRate === null ||
    refundRate === null ||
    baseCpc === null ||
    baseCpc <= 0
  ) {
    return null;
  }
  return {
    commission,
    expectedCvr,
    approvalRate,
    attributionRate,
    refundRate,
    baseCpc,
  };
}

/**
 * Evaluate all kill-switch conditions for one offer.
 * Never throws for missing data — the condition is skipped instead.
 */
export async function evaluateKillSwitch(
  prisma: PrismaClient,
  offerId: string
): Promise<KillSwitchEvaluation> {
  const offer = (await prisma.offer.findUnique({
    where: { id: offerId },
    include: { merchant: true },
  })) as {
    id: string;
    tenantId: string;
    name: string;
    deletedAt: Date | null;
    merchantId: string | null;
    merchant: { status: string } | null;
  } | null;
  if (!offer || offer.deletedAt) {
    throw new Error(`kill-switch: offer not found: ${offerId}`);
  }
  const { tenantId } = offer;

  const config = (await prisma.killSwitchConfig.findUnique({
    where: { offerId },
  })) as {
    id: string;
    tenantId: string;
    enabled: boolean;
    maxSpend: unknown;
    minExpectedProfit: unknown;
    minCvr: unknown;
    maxPolicyRisk: unknown;
    pauseOnMerchantTerminated: boolean;
  } | null;

  const evaluation: KillSwitchEvaluation = {
    offerId,
    tenantId,
    offerName: offer.name,
    config:
      config && config.tenantId === tenantId
        ? { id: config.id, enabled: config.enabled }
        : null,
    triggers: [],
    skipped: [],
  };
  // Defensive tenant isolation: a config row for another tenant is ignored.
  if (!evaluation.config || !config) return evaluation;

  const pushTrigger = (t: KillSwitchTrigger) => evaluation.triggers.push(t);
  const skip = (name: string) => evaluation.skipped.push(name);

  // ---- (1) Spend + expected profit -------------------------------------
  const maxSpend = toNumber(config.maxSpend);
  const minExpectedProfit = toNumber(config.minExpectedProfit);
  if (maxSpend === null || minExpectedProfit === null) {
    skip("SPEND_PROFIT:config-thresholds-unset");
  } else {
    const clicks = (await prisma.click.count({
      // Test clicks (link-chain verification) never count as real traffic.
      where: { tenantId, offerId, isTest: { not: true } },
    })) as number;
    const model = (await prisma.profitModel.findFirst({
      where: { tenantId, offerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })) as {
      commission: unknown;
      expectedCvr: unknown;
      approvalRate: unknown;
      attributionRate: unknown;
      refundRate: unknown;
      scenarios: unknown;
    } | null;
    const inputs = model ? readProfitInputs(model) : null;
    if (clicks <= 0 || !inputs) {
      skip("SPEND_PROFIT:missing-clicks-or-profit-model");
    } else {
      const spend = clicks * inputs.baseCpc;
      const revenue =
        clicks *
        (inputs.expectedCvr / 100) *
        inputs.approvalRate *
        inputs.commission *
        inputs.attributionRate;
      const refundCost = revenue * inputs.refundRate;
      const expectedProfit = revenue - spend - refundCost;
      if (spend > maxSpend && expectedProfit < minExpectedProfit) {
        pushTrigger({
          type: "SPEND_PROFIT",
          message: `spend ${spend.toFixed(2)} > maxSpend ${maxSpend} and expected profit ${expectedProfit.toFixed(2)} < minExpectedProfit ${minExpectedProfit}`,
          snapshot: {
            clicks,
            baseCpc: inputs.baseCpc,
            spend: Math.round(spend * 100) / 100,
            expectedProfit: Math.round(expectedProfit * 100) / 100,
            maxSpend,
            minExpectedProfit,
          },
        });
      }
    }
  }

  // ---- (2) Actual CVR floor --------------------------------------------
  const minCvr = toNumber(config.minCvr);
  if (minCvr === null) {
    skip("CVR_FLOOR:config-threshold-unset");
  } else {
    const [clicks, conversions] = (await Promise.all([
      prisma.click.count({
        where: { tenantId, offerId, isTest: { not: true } },
      }),
      prisma.conversion.count({
        where: {
          tenantId,
          deletedAt: null,
          click: { offerId, isTest: { not: true } },
        },
      }),
    ])) as [number, number];
    if (clicks <= 0) {
      skip("CVR_FLOOR:no-clicks");
    } else {
      const cvr = conversions / clicks;
      if (cvr < minCvr) {
        pushTrigger({
          type: "CVR_FLOOR",
          message: `actual CVR ${(cvr * 100).toFixed(2)}% (${conversions}/${clicks}) < minCvr ${(minCvr * 100).toFixed(2)}%`,
          snapshot: { clicks, conversions, cvr, minCvr },
        });
      }
    }
  }

  // ---- (3) Policy risk ---------------------------------------------------
  const maxPolicyRisk = toNumber(config.maxPolicyRisk);
  if (maxPolicyRisk === null) {
    skip("POLICY_RISK:config-threshold-unset");
  } else {
    const score = (await prisma.offerRiskScore.findFirst({
      where: { tenantId, offerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { policyScore: true },
    })) as { policyScore: number | null } | null;
    const policyScore = score ? toNumber(score.policyScore) : null;
    if (policyScore === null) {
      skip("POLICY_RISK:no-risk-score");
    } else {
      // policyScore is 0-100 "safety" (higher = safer); risk is its inverse.
      const risk = 100 - policyScore;
      if (risk >= maxPolicyRisk) {
        pushTrigger({
          type: "POLICY_RISK",
          message: `policy risk ${risk} (policyScore ${policyScore}) >= maxPolicyRisk ${maxPolicyRisk}`,
          snapshot: { policyScore, risk, maxPolicyRisk },
        });
      }
    }
  }

  // ---- (4) Merchant terminated -------------------------------------------
  if (!config.pauseOnMerchantTerminated) {
    skip("MERCHANT_TERMINATED:disabled-in-config");
  } else if (!offer.merchantId) {
    skip("MERCHANT_TERMINATED:no-merchant-linked");
  } else if (offer.merchant?.status?.toUpperCase() === "TERMINATED") {
    pushTrigger({
      type: "MERCHANT_TERMINATED",
      message: `merchant ${offer.merchantId} status is TERMINATED`,
      snapshot: { merchantId: offer.merchantId, status: offer.merchant?.status },
    });
  }

  return evaluation;
}

export interface ExecuteKillSwitchOptions {
  actorId?: string;
  requestId?: string;
  jobId?: string;
  triggeredBy?: "schedule" | "manual" | "api";
}

/**
 * Evaluate and, when conditions fire, record KillSwitchEvents and either
 * alert (config.enabled=false) or auto-pause all bound tracking links.
 */
export async function executeKillSwitch(
  prisma: PrismaClient,
  offerId: string,
  opts: ExecuteKillSwitchOptions = {}
): Promise<KillSwitchExecutionResult> {
  const evaluation = await evaluateKillSwitch(prisma, offerId);
  const base: KillSwitchExecutionResult = {
    ...evaluation,
    actionTaken: "NONE",
    linksPaused: 0,
    eventIds: [],
    alertCreated: false,
  };
  if (evaluation.triggers.length === 0 || !evaluation.config) return base;

  const autoExecute = evaluation.config.enabled;
  const actionTaken = autoExecute ? "PAUSED_ALL_LINKS" : "ALERT_ONLY";

  // Pause once (only links not already paused count).
  let linksPaused = 0;
  let pausedLinkIds: string[] = [];
  if (autoExecute) {
    const bindings = (await prisma.trackingLinkOffer.findMany({
      where: { tenantId: evaluation.tenantId, offerId },
      select: { trackingLinkId: true },
    })) as Array<{ trackingLinkId: string }>;
    const linkIds = [...new Set(bindings.map((b) => b.trackingLinkId))];
    if (linkIds.length > 0) {
      const updated = (await prisma.trackingLink.updateMany({
        where: {
          tenantId: evaluation.tenantId,
          id: { in: linkIds },
          status: { not: "PAUSED" },
          deletedAt: null,
        },
        data: { status: "PAUSED" },
      })) as { count: number };
      linksPaused = updated.count;
      pausedLinkIds = linkIds;
    }
  }
  base.linksPaused = linksPaused;
  base.actionTaken = actionTaken;

  for (const trigger of evaluation.triggers) {
    const event = (await prisma.killSwitchEvent.create({
      data: {
        id: randomUUID(),
        tenantId: evaluation.tenantId,
        offerId,
        triggeredBy: trigger.type,
        conditionSnapshot: JSON.parse(
          JSON.stringify({
            ...trigger.snapshot,
            message: trigger.message,
            autoExecute,
            actionTaken,
            offerName: evaluation.offerName,
            triggeredBySource: opts.triggeredBy ?? "schedule",
          })
        ),
        actionTaken,
        linksPaused,
        autoExecute,
      },
      select: { id: true },
    })) as { id: string };
    base.eventIds.push(event.id);
  }

  // Alert (deduped 24h) — fires for both ALERT_ONLY and auto-pause runs so
  // the operator always sees the firing in the alerts surface.
  const since = new Date(Date.now() - ALERT_DEDUPE_MS);
  const recentAlerts = (await prisma.alert.findMany({
    where: {
      tenantId: evaluation.tenantId,
      metric: "kill_switch",
      status: "open",
      createdAt: { gt: since },
    },
    select: { id: true, data: true },
  })) as Array<{ id: string; data: unknown }>;
  // Narrow the dedupe to this offer in code (JSON path filters vary by DB).
  const offerAlerted = recentAlerts.some(
    (a) =>
      a.data !== null &&
      typeof a.data === "object" &&
      (a.data as Record<string, unknown>).offerId === offerId
  );
  if (!offerAlerted) {
    await prisma.alert.create({
      data: {
        id: randomUUID(),
        tenantId: evaluation.tenantId,
        metric: "kill_switch",
        severity: autoExecute ? "high" : "medium",
        message:
          `Kill switch ${actionTaken === "PAUSED_ALL_LINKS" ? "AUTO-PAUSED" : "alert"} ` +
          `for offer "${evaluation.offerName}": ${evaluation.triggers.map((t) => t.type).join(", ")}`,
        data: JSON.parse(
          JSON.stringify({
            offerId,
            offerName: evaluation.offerName,
            triggers: evaluation.triggers.map((t) => ({
              type: t.type,
              message: t.message,
            })),
            actionTaken,
            linksPaused,
            autoExecute,
          })
        ),
      },
    });
    base.alertCreated = true;
  }

  // Audit trail for the auto-pause decision.
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      tenantId: evaluation.tenantId,
      actorId: opts.actorId ?? null,
      action: autoExecute ? "KILL_SWITCH_AUTO_PAUSE" : "KILL_SWITCH_ALERT",
      entityType: "Offer",
      entityId: offerId,
      before: undefined as never,
      after: JSON.parse(
        JSON.stringify({
          triggers: evaluation.triggers.map((t) => t.type),
          actionTaken,
          linksPaused,
          pausedLinkIds,
        })
      ) as never,
      reason: `kill-switch fired (${evaluation.triggers.map((t) => t.type).join(", ")}); ${actionTaken}`,
      requestId: opts.requestId ?? null,
      jobId: opts.jobId ?? null,
    },
  });

  return base;
}
