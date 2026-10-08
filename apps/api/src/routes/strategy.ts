/**
 * Phase 5 — AI Decision Engine routes.
 *
 * POST /api/v1/offers/:id/strategy      → full-chain StrategyOutput
 * GET  /api/v1/offers/:id/campaign-plan → campaign plan JSON (?download=1 for attachment)
 *
 * Session auth only (one tenant per user). The coordinator wires
 * registerStrategyRoutes in routes/index.ts.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { NotFoundError, UnauthorizedError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  buildCampaignPlan,
  runFullStrategy,
  type StrategyDeps,
} from "../ai/orchestrator.js";
import { validateDecisionShape } from "../ai/pipeline.js";

export interface StrategyRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests (fake LLM). */
  chatJsonImpl?: StrategyDeps["chatJsonImpl"];
  fetchPageImpl?: StrategyDeps["fetchPageImpl"];
  researchAnalystImpl?: StrategyDeps["researchAnalystImpl"];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireSession(
  deps: StrategyRouteDeps,
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

function requireOfferId(request: FastifyRequest): string {
  const { id } = request.params as { id: string };
  if (!UUID_RE.test(id)) throw new NotFoundError("Offer", id);
  return id;
}

export async function registerStrategyRoutes(
  app: FastifyInstance,
  deps: StrategyRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /** Full-chain strategy orchestration: Phase 1-4 → StrategyOutput. */
  app.post("/api/v1/offers/:id/strategy", async (request) => {
    const info = await requireSession(deps, request);
    const id = requireOfferId(request);
    const output = await runFullStrategy(
      {
        prisma,
        chatJsonImpl: deps.chatJsonImpl,
        fetchPageImpl: deps.fetchPageImpl,
        researchAnalystImpl: deps.researchAnalystImpl,
      },
      info.tenantId,
      id,
      { userId: info.id }
    );
    // Frozen §32 contract on the decision payload.
    return {
      ...output,
      decision: validateDecisionShape(JSON.parse(JSON.stringify(output.decision))),
    };
  });

  /**
   * Campaign plan document (read-only). `?download=1` returns it as a
   * file attachment. Never creates anything in Google Ads.
   */
  app.get("/api/v1/offers/:id/campaign-plan", async (request, reply) => {
    const info = await requireSession(deps, request);
    const id = requireOfferId(request);
    const plan = await buildCampaignPlan({ prisma }, info.tenantId, id);
    const { download } = request.query as { download?: string };
    if (download === "1") {
      const name = plan.offerName.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60) || "offer";
      reply.header(
        "content-disposition",
        `attachment; filename="campaign-plan-${name}.json"`
      );
    }
    return plan;
  });
}
