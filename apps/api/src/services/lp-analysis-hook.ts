/**
 * Post-analysis hook: feed analyzer results into the LP optimization queue.
 *
 * Deliberately decoupled from the analyzer (ai/lander-analyzer.ts) and from
 * the analysis route (routes/lander-intel.ts): neither is modified by this
 * task. The coordinator wires `afterAnalysis`/`afterAnalysisForUrl` into the
 * analysis flow.
 *
 * Scoring semantics (shared with the service):
 * - result.overallScore >= 70 → no task is created.
 * - Otherwise one task per landing page (deduped on PENDING/IN_PROGRESS).
 */
import type { LanderAnalysisResult } from "../ai/lander-analyzer.js";
import {
  maybeCreateTask,
  type LpOptimizationPrisma,
  type OptimizationTaskRow,
} from "./lp-optimization-service.js";

/**
 * Create (or refresh) an optimization task for one landing page from a
 * finished analyzer result. Returns null when the score is good enough.
 */
export async function afterAnalysis(
  prisma: LpOptimizationPrisma,
  tenantId: string,
  landingPageId: string,
  result: LanderAnalysisResult
): Promise<OptimizationTaskRow | null> {
  return maybeCreateTask(prisma, tenantId, landingPageId, result);
}

/**
 * Variant for analysis flows that only know the page URL: every tracked
 * landing page of this tenant with an exactly matching URL gets a task.
 */
export async function afterAnalysisForUrl(
  prisma: LpOptimizationPrisma,
  tenantId: string,
  url: string,
  result: LanderAnalysisResult
): Promise<Array<OptimizationTaskRow | null>> {
  const pages = await prisma.landingPage.findMany({
    where: { tenantId, url },
  });
  const out: Array<OptimizationTaskRow | null> = [];
  for (const page of pages) {
    out.push(await afterAnalysis(prisma, tenantId, page.id, result));
  }
  return out;
}
