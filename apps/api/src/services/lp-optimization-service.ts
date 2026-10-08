/**
 * LP optimization queue — data-layer service.
 *
 * Tasks are auto-created by the hook (services/lp-analysis-hook.ts) after a
 * landing-page analysis completes: any analysis whose overall score is below
 * OPTIMIZATION_SCORE_THRESHOLD creates (or refreshes) one task per landing
 * page, prioritized by the weakest quality dimension.
 *
 * Pure functions over an injected prisma-like delegate — no direct Prisma
 * import — so unit tests run DB-free.
 */
import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import type {
  LanderAnalysisResult,
  LanderDimension,
  LanderScores,
} from "../ai/lander-analyzer.js";

export type OptimizationPriority = "HIGH" | "MEDIUM" | "LOW";
export type OptimizationTaskStatus = "PENDING" | "IN_PROGRESS" | "DONE";

/** Overall scores at or above this threshold don't create tasks. */
export const OPTIMIZATION_SCORE_THRESHOLD = 70;
/** Cap on persisted issues per task to keep the JSON payload bounded. */
export const MAX_STORED_ISSUES = 20;

export interface OptimizationTaskRow {
  id: string;
  tenantId: string;
  landingPageId: string;
  score: number;
  issues: unknown;
  priority: OptimizationPriority;
  status: OptimizationTaskStatus;
  createdAt: Date;
  completedAt: Date | null;
}

export interface LandingPageRef {
  id: string;
  name: string;
  url: string;
  domain: string;
}

export interface StoredIssue {
  dimension?: string;
  severity?: "high" | "medium" | "low" | string;
  message?: string;
}

export interface OptimizationTaskItem {
  id: string;
  landingPageId: string;
  score: number;
  issues: StoredIssue[];
  priority: OptimizationPriority;
  status: OptimizationTaskStatus;
  createdAt: string;
  completedAt: string | null;
  /** Weakest quality dimension, derived from the stored issues. */
  worstDimension: string;
  landingPage: LandingPageRef | null;
}

/** Minimal prisma surface used by this service (keeps tests DB-free). */
export interface LpOptimizationPrisma {
  landingPageOptimizationTask: {
    findFirst(args: unknown): Promise<OptimizationTaskRow | null>;
    findMany(args: unknown): Promise<OptimizationTaskRow[]>;
    create(args: unknown): Promise<OptimizationTaskRow>;
    update(args: unknown): Promise<OptimizationTaskRow>;
    delete(args: unknown): Promise<OptimizationTaskRow>;
  };
  landingPage: {
    findMany(args: unknown): Promise<LandingPageRef[]>;
  };
}

// ---------------------------------------------------------------------------
// Dimension helpers
// ---------------------------------------------------------------------------

const DIMENSIONS: LanderDimension[] = [
  "performance",
  "cta",
  "trust",
  "mobile",
  "copy",
  "bounceRisk",
];

/**
 * Quality score per dimension (0-100, higher = better). bounceRisk is a risk
 * score in the analyzer, so it is inverted here.
 */
export function dimensionQuality(
  scores: LanderScores
): Record<LanderDimension, number> {
  return {
    performance: scores.performance,
    cta: scores.cta,
    trust: scores.trust,
    mobile: scores.mobile,
    copy: scores.copy,
    bounceRisk: 100 - scores.bounceRisk,
  };
}

/** Priority from the weakest quality dimension. */
export function priorityForScores(
  scores: LanderScores
): OptimizationPriority {
  const min = Math.min(...Object.values(dimensionQuality(scores)));
  if (min < 40) return "HIGH";
  if (min < 60) return "MEDIUM";
  return "LOW";
}

/** Weakest quality dimension key (stable tie-break: DIMENSIONS order). */
export function worstDimensionForScores(
  scores: LanderScores
): LanderDimension {
  const q = dimensionQuality(scores);
  let worst: LanderDimension = DIMENSIONS[0];
  for (const d of DIMENSIONS) {
    if (q[d] < q[worst]) worst = d;
  }
  return worst;
}

export function normalizeIssues(raw: unknown): StoredIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({
      dimension: typeof i.dimension === "string" ? i.dimension : undefined,
      severity: typeof i.severity === "string" ? i.severity : undefined,
      message: typeof i.message === "string" ? i.message : undefined,
    }));
}

/**
 * Approximate the weakest dimension from stored issues only (the task row
 * persists issues, not the raw scores). Severity-weighted votes per
 * dimension; the dimension with the most weight wins.
 */
export function worstDimensionFromIssues(issues: StoredIssue[]): string {
  const weight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const votes = new Map<string, number>();
  for (const issue of issues) {
    const dim = issue.dimension;
    if (!dim) continue;
    votes.set(
      dim,
      (votes.get(dim) ?? 0) + (weight[String(issue.severity)] ?? 1)
    );
  }
  if (votes.size === 0) return "performance";
  let worst = "";
  let best = -1;
  for (const [dim, score] of votes) {
    if (score > best) {
      best = score;
      worst = dim;
    }
  }
  return worst;
}

const PRIORITY_RANK: Record<OptimizationPriority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

// ---------------------------------------------------------------------------
// Public row serialization
// ---------------------------------------------------------------------------

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toPublicTaskItem(
  row: OptimizationTaskRow,
  landingPage: LandingPageRef | null
): OptimizationTaskItem {
  const issues = normalizeIssues(row.issues);
  return {
    id: row.id,
    landingPageId: row.landingPageId,
    score: row.score,
    issues,
    priority: row.priority,
    status: row.status,
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    completedAt: toIso(row.completedAt),
    worstDimension: worstDimensionFromIssues(issues),
    landingPage,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Create (or refresh) an optimization task from an analysis result.
 * Returns null when the score is at or above the threshold — nothing to do.
 * Deduplicates: an existing PENDING/IN_PROGRESS task for the same landing
 * page is refreshed with the latest score/issues instead of duplicated.
 */
export async function maybeCreateTask(
  prisma: LpOptimizationPrisma,
  tenantId: string,
  landingPageId: string,
  result: LanderAnalysisResult
): Promise<OptimizationTaskRow | null> {
  if (result.overallScore >= OPTIMIZATION_SCORE_THRESHOLD) return null;

  const score = Math.round(result.overallScore);
  const issues = result.issues
    .slice(0, MAX_STORED_ISSUES)
    .map((i) => ({
      dimension: i.dimension,
      severity: i.severity,
      message: i.message,
    }));
  const priority = priorityForScores(result.scores);

  const existing = await prisma.landingPageOptimizationTask.findFirst({
    where: {
      tenantId,
      landingPageId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return prisma.landingPageOptimizationTask.update({
      where: { id: existing.id },
      data: { score, issues: issues as never, priority },
    });
  }
  return prisma.landingPageOptimizationTask.create({
    data: {
      id: randomUUID(),
      tenantId,
      landingPageId,
      score,
      issues: issues as never,
      priority,
      status: "PENDING",
    },
  });
}

/**
 * List tasks for a tenant, sorted by priority (HIGH→MEDIUM→LOW) then oldest
 * first, with the linked landing page's name/url attached.
 */
export async function listTasks(
  prisma: LpOptimizationPrisma,
  tenantId: string,
  status?: OptimizationTaskStatus
): Promise<{ items: OptimizationTaskItem[]; total: number }> {
  const rows = await prisma.landingPageOptimizationTask.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const pageIds = [...new Set(rows.map((r) => r.landingPageId))];
  const pages =
    pageIds.length > 0
      ? await prisma.landingPage.findMany({
          where: { id: { in: pageIds }, tenantId },
        })
      : [];
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const items = rows.map((r) =>
    toPublicTaskItem(r, pageById.get(r.landingPageId) ?? null)
  );
  items.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  return { items, total: items.length };
}

/** Forward-only status transitions; DONE stamps completedAt. */
const TRANSITIONS: Record<OptimizationTaskStatus, OptimizationTaskStatus[]> = {
  PENDING: ["IN_PROGRESS", "DONE"],
  IN_PROGRESS: ["DONE"],
  DONE: [],
};

export async function updateTaskStatus(
  prisma: LpOptimizationPrisma,
  tenantId: string,
  id: string,
  status: OptimizationTaskStatus
): Promise<OptimizationTaskRow> {
  const row = await prisma.landingPageOptimizationTask.findFirst({
    where: { id, tenantId },
  });
  if (!row) throw new NotFoundError("Optimization task not found");
  if (row.status === status) return row;
  if (!TRANSITIONS[row.status].includes(status)) {
    throw new ValidationError(
      `Cannot transition optimization task from ${row.status} to ${status}`
    );
  }
  return prisma.landingPageOptimizationTask.update({
    where: { id: row.id },
    data: {
      status,
      ...(status === "DONE" ? { completedAt: new Date() } : {}),
    },
  });
}

/** Hard delete (the model has no deletedAt). */
export async function archiveTask(
  prisma: LpOptimizationPrisma,
  tenantId: string,
  id: string
): Promise<{ ok: true }> {
  const row = await prisma.landingPageOptimizationTask.findFirst({
    where: { id, tenantId },
  });
  if (!row) throw new NotFoundError("Optimization task not found");
  await prisma.landingPageOptimizationTask.delete({ where: { id: row.id } });
  return { ok: true };
}
