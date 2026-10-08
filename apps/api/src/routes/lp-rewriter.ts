/**
 * LP AI Rewriter routes (automation round 2, additive).
 *
 * Contract:
 * - POST /api/v1/landing-pages/:id/rewrite
 *     body: { issues?: [{ dimension?, severity?, message? }] }
 *     → generates an AI before/after rewrite draft from the landing page's
 *     HTML + issues (body issues win; otherwise the page's latest
 *     optimization task's issues are reused), persists a DRAFT
 *     LandingPageRewrite, and returns it with the analyzer re-run estimate.
 * - GET  /api/v1/landing-pages/:id/rewrites → { items, total } (newest first)
 * - POST /api/v1/landing-pages/rewrites/:rewriteId/apply
 *     → backs the current LandingPage HTML into
 *     rewrittenContent.originalBackup, applies the before→after
 *     substitutions, flips the rewrite to APPLIED.
 *
 * Tenant isolation via requireTenant on every handler. Pure addition: no
 * existing route behavior changed.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import {
  AiError,
  chatJson,
  chatJsonValidated,
  type ChatJsonArgs,
} from "../ai/llm.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import {
  analyzeLander,
  type LanderIssue,
} from "../ai/lander-analyzer.js";
import {
  applyRewritesToHtml,
  buildRewritePrompt,
  pageTextExcerpt,
  rescoreRewrittenHtml,
  validateRewriteShape,
  type LpRewrite,
  type LpRewriteIssue,
} from "../ai/lp-rewriter.js";

export interface LpRewriterDeps {
  prisma: PrismaClient;
  auth: AuthContext;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
}

interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v
  );
}

/** Null when the LLM is not configured — rewrite is AI-only, so the route
 *  then fails with a clear message instead of silently skipping. */
async function requireLlmConfig(
  prisma: PrismaClient
): Promise<LlmConfig> {
  const rows = (await prisma.aiSetting.findMany()) as Array<{
    key: string;
    value: string;
  }>;
  const out: { baseUrl?: string; model?: string; apiKeyEnc?: string } = {};
  for (const r of rows) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
  }
  if (!out.baseUrl || !out.model || !out.apiKeyEnc) {
    throw new AiError(
      "AI 未配置：请先在「AI 设置」中填写模型服务地址、模型与密钥"
    );
  }
  const pepper = assertAiSettingsPepperConfigured();
  return {
    baseUrl: out.baseUrl,
    model: out.model,
    apiKey: decryptSecret(out.apiKeyEnc, pepper),
  };
}

function asRewriteIssues(v: unknown): LpRewriteIssue[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new ValidationError("issues must be an array");
  return v.map((item) => {
    if (typeof item !== "object" || item === null)
      throw new ValidationError("issues items must be objects");
    const r = item as Record<string, unknown>;
    return {
      dimension: typeof r["dimension"] === "string" ? r["dimension"] : undefined,
      severity: typeof r["severity"] === "string" ? r["severity"] : undefined,
      message: typeof r["message"] === "string" ? r["message"] : undefined,
    };
  });
}

function toPublicRewrite(row: {
  id: string;
  landingPageId: string;
  originalScore: number;
  issues: unknown;
  rewrittenContent: unknown;
  newScore: number | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    landingPageId: row.landingPageId,
    originalScore: row.originalScore,
    issues: row.issues,
    rewrittenContent: row.rewrittenContent,
    newScore: row.newScore,
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

export async function registerLpRewriterRoutes(
  app: FastifyInstance,
  deps: LpRewriterDeps
): Promise<void> {
  const { prisma, auth } = deps;
  const chatImpl = deps.chatJsonImpl ?? chatJson;
  if (!prisma) return;

  async function findOwnLandingPage(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundError("Landing page not found");
    const page = await prisma.landingPage.findFirst({
      where: { id, tenantId },
    });
    if (!page) throw new NotFoundError("Landing page not found");
    return page as {
      id: string;
      tenantId: string;
      name: string;
      url: string;
      htmlContent: string | null;
    };
  }

  /**
   * Generate a rewrite draft for a landing page.
   */
  app.post<{
    Params: { id: string };
    Body: { issues?: unknown };
  }>("/api/v1/landing-pages/:id/rewrite", async (request) => {
    const tenantId = requireTenant(auth, request);
    const page = await findOwnLandingPage(tenantId, request.params.id);
    const html = page.htmlContent;
    if (!html) {
      throw new ValidationError(
        "该落地页没有可改写的 HTML 内容（仅从模板创建的落地页支持 AI 改写）"
      );
    }

    let issues = asRewriteIssues(
      ((request.body ?? {}) as { issues?: unknown }).issues
    );
    let originalScore: number | undefined;
    if (!issues) {
      const task = await prisma.landingPageOptimizationTask.findFirst({
        where: { tenantId, landingPageId: page.id },
        orderBy: { createdAt: "desc" },
      });
      if (task) {
        issues = asRewriteIssues(task.issues) ?? [];
        originalScore = task.score;
      }
    }
    if (!issues) {
      // No optimization task yet: analyze on the fly for issues + score.
      const analysis = analyzeLander(html, 0);
      issues = analysis.issues.map((i: LanderIssue) => ({
        dimension: i.dimension,
        severity: i.severity,
        message: i.message,
      }));
      originalScore = Math.round(analysis.overallScore);
    }

    const llm = await requireLlmConfig(prisma);
    const { system, user } = buildRewritePrompt({
      pageName: page.name,
      pageUrl: page.url,
      pageText: pageTextExcerpt(html),
      issues,
      lang: "zh",
    });
    const args: ChatJsonArgs = {
      baseUrl: llm.baseUrl,
      model: llm.model,
      apiKey: llm.apiKey,
      system,
      user,
    };
    let llmResult;
    try {
      llmResult = await chatJsonValidated(args, validateRewriteShape, chatImpl);
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("LLM request failed");
    }

    // Deterministic textual apply for the estimate, then re-score with the
    // existing analyzer — the recorded newScore comes from the analyzer.
    const applied = applyRewritesToHtml(html, llmResult.rewrites);
    const newScore = Math.round(rescoreRewrittenHtml(applied.html));

    const row = await prisma.landingPageRewrite.create({
      data: {
        id: randomUUID(),
        tenantId,
        landingPageId: page.id,
        originalScore: originalScore ?? 0,
        issues: JSON.parse(JSON.stringify(issues)) as never,
        rewrittenContent: JSON.parse(
          JSON.stringify({
            rewrites: llmResult.rewrites as LpRewrite[],
            aiEstimatedNewScore: llmResult.aiEstimatedNewScore,
            appliedCount: applied.applied,
            skipped: applied.skipped,
          })
        ) as never,
        newScore,
        status: "DRAFT",
      },
    });
    return { rewrite: toPublicRewrite(row as never) };
  });

  /** List rewrite history for a landing page, newest first. */
  app.get<{
    Params: { id: string };
  }>("/api/v1/landing-pages/:id/rewrites", async (request) => {
    const tenantId = requireTenant(auth, request);
    const page = await findOwnLandingPage(tenantId, request.params.id);
    const rows = await prisma.landingPageRewrite.findMany({
      where: { tenantId, landingPageId: page.id },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: (rows as never[]).map((r) => toPublicRewrite(r as never)),
      total: rows.length,
    };
  });

  /**
   * Apply a DRAFT rewrite: back up the current LandingPage content into
   * rewrittenContent.originalBackup, write the rewritten HTML, flip to
   * APPLIED.
   */
  app.post<{
    Params: { rewriteId: string };
  }>("/api/v1/landing-pages/rewrites/:rewriteId/apply", async (request) => {
    const tenantId = requireTenant(auth, request);
    const rewriteId = request.params.rewriteId;
    if (!isUuid(rewriteId)) throw new NotFoundError("Rewrite not found");
    const rewrite = (await prisma.landingPageRewrite.findFirst({
      where: { id: rewriteId, tenantId },
    })) as {
      id: string;
      tenantId: string;
      landingPageId: string;
      originalScore: number;
      issues: unknown;
      rewrittenContent: unknown;
      newScore: number | null;
      status: string;
      createdAt: Date;
    } | null;
    if (!rewrite) throw new NotFoundError("Rewrite not found");
    if (rewrite.status === "APPLIED") {
      throw new ConflictError("该改写版本已经应用过");
    }

    const page = await findOwnLandingPage(tenantId, rewrite.landingPageId);
    const html = page.htmlContent;
    if (!html) {
      throw new ValidationError("该落地页没有 HTML 内容，无法应用改写");
    }

    const content = (rewrite.rewrittenContent ?? {}) as {
      rewrites?: LpRewrite[];
    };
    const rewrites = Array.isArray(content.rewrites) ? content.rewrites : [];
    const report = applyRewritesToHtml(html, rewrites);

    const newContent = JSON.parse(
      JSON.stringify({
        ...(content as Record<string, unknown>),
        originalBackup: {
          htmlContent: html,
          name: page.name,
          appliedAt: new Date().toISOString(),
          appliedCount: report.applied,
          skipped: report.skipped,
        },
      })
    );

    await prisma.landingPage.update({
      where: { id: page.id },
      data: { htmlContent: report.html },
    });
    const updated = (await prisma.landingPageRewrite.update({
      where: { id: rewrite.id },
      data: { status: "APPLIED", rewrittenContent: newContent as never },
    })) as typeof rewrite;

    return {
      rewrite: toPublicRewrite(updated as never),
      applied: report.applied,
      skipped: report.skipped,
    };
  });
}
