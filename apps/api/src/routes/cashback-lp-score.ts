/**
 * Feature: 返利落地页合规评分 (lp-cashback-score) — manual scoring API.
 *
 * WIRING (done by the parent orchestrator, NOT in this file):
 *   routes/index.ts:
 *     import { registerCashbackLpScoreRoutes } from "./cashback-lp-score.js";
 *     await registerCashbackLpScoreRoutes(app, { prisma: services.prisma });
 *
 * Endpoints (session auth via authenticateSessionRequest, tenant-isolated):
 * - POST /api/v1/cashback/landing-pages/:id/score
 *     Manual scoring of one landing page.
 *     → { landingPageId, score, issues, taskCreated, taskId }
 * - POST /api/v1/cashback/lp-scores/batch   body: { trackingLinkIds: string[] }
 *     Batch scores keyed by tracking link (used by the /cashback/offers
 *     list to render the 合规分 column without N round-trips).
 *     → { scores: Record<string, { landingPageId, score, issues } | null> }
 *
 * Scoring < 70 auto-creates a LandingPageOptimizationTask (deduplicated:
 * an existing PENDING task for the same landing page is reused, never
 * duplicated). Priority: < 50 → HIGH, < 70 → MEDIUM.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { randomUUID } from "node:crypto";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { scoreCashbackLandingPage } from "../services/cashback-lp-scorer.js";

export interface CashbackLpScoreRouteDeps {
  prisma: PrismaClient;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BATCH_IDS = 100;

async function requireSession(
  deps: CashbackLpScoreRouteDeps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

function asUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ValidationError(`${field} must be a UUID`);
  }
  return value;
}

/**
 * Resolve the latest detected cashback rate for the offer linked to a
 * landing page.
 *
 * NOTE: the feature spec references a CashbackRateCheck table
 * (detectedRate), but no such table exists in this codebase's Prisma
 * schema. Until it lands, this returns null and the rate-accuracy check
 * is skipped (per spec: "没有数据则跳过此项"). When the table is added,
 * wire it here, e.g.:
 *   prisma.cashbackRateCheck.findFirst({
 *     where: { cashbackOfferId, tenantId },
 *     orderBy: { checkedAt: "desc" },
 *     select: { detectedRate: true },
 *   })
 */
async function resolveDetectedRate(
  prisma: PrismaClient,
  tenantId: string,
  landingPageId: string
): Promise<string | null> {
  // LandingPage → TrackingLink.landingPageId → CashbackOffer.trackingLinkId
  // → latest CashbackRateCheck.detectedRate
  const links = await prisma.trackingLink.findMany({
    where: { tenantId, landingPageId, deletedAt: null },
    select: { id: true },
  });
  if (links.length === 0) return null;
  const offers = await prisma.cashbackOffer.findMany({
    where: {
      tenantId,
      deletedAt: null,
      trackingLinkId: { in: links.map((l) => l.id) },
    },
    select: { id: true },
  });
  if (offers.length === 0) return null;
  const latest = await prisma.cashbackRateCheck.findFirst({
    where: {
      tenantId,
      cashbackOfferId: { in: offers.map((o) => o.id) },
    },
    orderBy: { checkedAt: "desc" },
    select: { detectedRate: true },
  });
  return latest?.detectedRate ?? null;
}

interface QueueResult {
  taskCreated: boolean;
  taskId: string | null;
}

/**
 * Create a LandingPageOptimizationTask when score < 70.
 * Idempotent: an existing PENDING task for the same landing page is
 * reused (no duplicate is created).
 */
async function queueTaskIfNeeded(
  prisma: PrismaClient,
  tenantId: string,
  landingPageId: string,
  score: number,
  issues: string[]
): Promise<QueueResult> {
  if (score >= 70) return { taskCreated: false, taskId: null };
  const existing = await prisma.landingPageOptimizationTask.findFirst({
    where: { tenantId, landingPageId, status: "PENDING" },
    select: { id: true },
  });
  if (existing) return { taskCreated: false, taskId: existing.id };
  const created = await prisma.landingPageOptimizationTask.create({
    data: {
      id: randomUUID(),
      tenantId,
      landingPageId,
      score,
      issues,
      priority: score < 50 ? "HIGH" : "MEDIUM",
    },
    select: { id: true },
  });
  return { taskCreated: true, taskId: created.id };
}

export async function registerCashbackLpScoreRoutes(
  app: FastifyInstance,
  deps: CashbackLpScoreRouteDeps
): Promise<void> {
  const { prisma } = deps;

  // Manual scoring of a single landing page.
  app.post<{
    Params: { id: string };
  }>("/api/v1/cashback/landing-pages/:id/score", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const landingPageId = asUuid(request.params.id, "id");

    const page = await prisma.landingPage.findFirst({
      where: { id: landingPageId, tenantId },
      select: { id: true, htmlContent: true },
    });
    if (!page) throw new NotFoundError("LandingPage", landingPageId);

    const detectedRate = await resolveDetectedRate(
      prisma,
      tenantId,
      landingPageId
    );
    const { score, issues } = scoreCashbackLandingPage(
      page.htmlContent ?? "",
      { detectedRate }
    );
    const { taskCreated, taskId } = await queueTaskIfNeeded(
      prisma,
      tenantId,
      landingPageId,
      score,
      issues
    );

    return { landingPageId, score, issues, taskCreated, taskId };
  });

  // Batch scores for the /cashback/offers list (keyed by tracking link id).
  app.post<{
    Body: { trackingLinkIds?: unknown };
  }>("/api/v1/cashback/lp-scores/batch", async (request) => {
    const { tenantId } = await requireSession(deps, request);
    const raw = (request.body ?? {}) as { trackingLinkIds?: unknown };
    if (!Array.isArray(raw.trackingLinkIds)) {
      throw new ValidationError("trackingLinkIds must be an array");
    }
    const ids = raw.trackingLinkIds.slice(0, MAX_BATCH_IDS).map((v, i) => {
      if (typeof v !== "string" || !UUID_RE.test(v)) {
        throw new ValidationError(`trackingLinkIds[${i}] must be a UUID`);
      }
      return v;
    });

    const links = await prisma.trackingLink.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, landingPageId: true },
    });
    const pageIds = links
      .map((l) => l.landingPageId)
      .filter((id): id is string => !!id);
    const pages =
      pageIds.length > 0
        ? await prisma.landingPage.findMany({
            where: { id: { in: pageIds }, tenantId },
            select: { id: true, htmlContent: true },
          })
        : [];
    const pageById = new Map(pages.map((p) => [p.id, p]));

    const scores: Record<
      string,
      { landingPageId: string; score: number; issues: string[] } | null
    > = {};
    for (const link of links) {
      if (!link.landingPageId) {
        scores[link.id] = null;
        continue;
      }
      const page = pageById.get(link.landingPageId);
      if (!page) {
        scores[link.id] = null;
        continue;
      }
      const { score, issues } = scoreCashbackLandingPage(
        page.htmlContent ?? "",
        { detectedRate: null }
      );
      scores[link.id] = { landingPageId: page.id, score, issues };
    }
    // Unknown / foreign-tenant ids are reported as null (no leak).
    for (const id of ids) {
      if (!(id in scores)) scores[id] = null;
    }
    return { scores };
  });
}
