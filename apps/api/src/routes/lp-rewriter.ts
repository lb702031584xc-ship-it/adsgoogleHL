/**
 * LP AI Rewriter routes (automation round 2, additive).
 *
 * Contract:
 * - GET  /api/v1/landing-pages/rewritable
 *     → { items: [{ id, name, offerId, offerName, updatedAt }], total }
 *     (pages with HTML content, for the rewrite workbench source picker)
 * - POST /api/v1/landing-pages/:id/rewrite
 *     body: { issues?: [{ dimension?, severity?, message? }],
 *             requirements?: RewriteRequirements }
 *     → generates an AI before/after rewrite draft from the landing page's
 *     HTML + issues (body issues win; otherwise the page's latest
 *     optimization task's issues are reused), persists a DRAFT
 *     LandingPageRewrite, and returns it with the analyzer re-run estimate
 *     plus previewHtml (the rewritten HTML, i.e. what deploy would persist).
 *     With requirements, the prompt is brief-driven instead of issue-driven.
 * - GET  /api/v1/landing-pages/:id/rewrites → { items, total } (newest first)
 * - POST /api/v1/landing-pages/rewrites/:rewriteId/apply
 *     → backs the current LandingPage HTML into
 *     rewrittenContent.originalBackup, applies the before→after
 *     substitutions, flips the rewrite to APPLIED.
 * - POST /api/v1/landing-pages/:id/rewrite also accepts { requirements }
 *     (rewrite-workbench condition form) → requirements-driven prompt.
 * - POST /api/v1/landing-pages/rewrites/:rewriteId/deploy { name, offerId?, url? }
 *     → applies the rewrite to its base HTML and persists it as a NEW
 *     LandingPage; the rewrite flips to DEPLOYED. Template-sourced briefs
 *     (landingPageId null, base HTML in rewrittenContent.baseHtml) deploy
 *     without touching any existing page.
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
  buildRequirementsRewritePrompt,
  buildRewritePrompt,
  pageTextExcerpt,
  parseRewriteRequirements,
  rescoreRewrittenHtml,
  validateRewriteShape,
  type LpRewrite,
  type LpRewriteIssue,
  type RewriteRequirements,
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
  landingPageId: string | null;
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
      offerId: string;
      name: string;
      url: string;
      htmlContent: string | null;
    };
  }

  /** Deploy body URL: optional, but must be http(s) when present. */
  function assertOptionalHttpUrl(raw: unknown): { url: string; domain: string } {
    if (raw === undefined || raw === null || raw === "") {
      return { url: "", domain: "" };
    }
    if (typeof raw !== "string") {
      throw new ValidationError("url must be a string");
    }
    const trimmed = raw.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ValidationError("url must be a valid http(s) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError("url must be a valid http(s) URL");
    }
    return { url: trimmed, domain: parsed.hostname };
  }

  /** Parse an optional UUID body field; throws 400 on malformed values. */
  function asOptionalUuid(raw: unknown, field: string): string | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw !== "string" || !isUuid(raw.trim())) {
      throw new ValidationError(`${field} must be a UUID`);
    }
    return raw.trim();
  }

  /**
   * List this tenant's rewritable landing pages (HTML content present).
   * Used by the rewrite workbench's source picker; returns id/name/offer
   * without the (potentially large) HTML payload.
   */
  app.get("/api/v1/landing-pages/rewritable", async (request) => {
    const tenantId = requireTenant(auth, request);
    const rows = (await prisma.landingPage.findMany({
      where: {
        tenantId,
        deletedAt: null,
        AND: [{ htmlContent: { not: null } }, { htmlContent: { not: "" } }],
      },
      select: {
        id: true,
        name: true,
        offerId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    })) as Array<{
      id: string;
      name: string;
      offerId: string;
      updatedAt: Date;
    }>;
    const offerIds = [...new Set(rows.map((r) => r.offerId))];
    const offers = (await prisma.offer.findMany({
      where: { id: { in: offerIds }, tenantId },
      select: { id: true, name: true },
    })) as Array<{ id: string; name: string }>;
    const offerNames = new Map(offers.map((o) => [o.id, o.name]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        offerId: r.offerId,
        offerName: offerNames.get(r.offerId) ?? "",
        updatedAt:
          r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      })),
      total: rows.length,
    };
  });

  /**
   * Generate a rewrite draft for a landing page.
   *
   * Body: { issues? } (issue-driven, existing behavior) or { requirements? }
   * (workbench condition form — target audience, selling points, tone, CTA
   * copy, discount info, SEO keywords, language, length). When requirements
   * are present the prompt is requirements-driven and the recorded issues
   * list stays empty; the brief is stored in rewrittenContent.requirements.
   */
  app.post<{
    Params: { id: string };
    Body: { issues?: unknown; requirements?: unknown };
  }>("/api/v1/landing-pages/:id/rewrite", async (request) => {
    const tenantId = requireTenant(auth, request);
    const page = await findOwnLandingPage(tenantId, request.params.id);
    const html = page.htmlContent;
    if (!html) {
      throw new ValidationError(
        "该落地页没有可改写的 HTML 内容（仅从模板创建的落地页支持 AI 改写）"
      );
    }

    const body = (request.body ?? {}) as {
      issues?: unknown;
      requirements?: unknown;
    };
    let requirements: RewriteRequirements | undefined;
    try {
      requirements = parseRewriteRequirements(body.requirements);
    } catch (e) {
      // Input-shape problems are the caller's fault (400), not an LLM
      // failure (502).
      if (e instanceof AiError) throw new ValidationError(e.message);
      throw e;
    }

    let issues = asRewriteIssues(body.issues);
    let originalScore: number | undefined;
    if (!requirements) {
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
    } else {
      issues = issues ?? [];
      if (originalScore === undefined) {
        originalScore = Math.round(analyzeLander(html, 0).overallScore);
      }
    }

    const llm = await requireLlmConfig(prisma);
    const prompt = requirements
      ? buildRequirementsRewritePrompt({
          pageName: page.name,
          pageUrl: page.url,
          pageText: pageTextExcerpt(html),
          requirements,
        })
      : buildRewritePrompt({
          pageName: page.name,
          pageUrl: page.url,
          pageText: pageTextExcerpt(html),
          issues: issues ?? [],
          lang: "zh",
        });
    const args: ChatJsonArgs = {
      baseUrl: llm.baseUrl,
      model: llm.model,
      apiKey: llm.apiKey,
      system: prompt.system,
      user: prompt.user,
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
            requirements: requirements ?? null,
            source: { kind: "landingPage", landingPageId: page.id },
          })
        ) as never,
        newScore,
        status: "DRAFT",
      },
    });
    return {
      rewrite: toPublicRewrite(row as never),
      // Rendered result with the rewrites applied (what deploy persists).
      previewHtml: applied.html,
    };
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
      landingPageId: string | null;
      originalScore: number;
      issues: unknown;
      rewrittenContent: unknown;
      newScore: number | null;
      status: string;
      createdAt: Date;
    } | null;
    if (!rewrite) throw new NotFoundError("Rewrite not found");
    if (rewrite.status !== "DRAFT") {
      throw new ConflictError("该改写版本已经处理过（仅草稿可应用）");
    }
    if (!rewrite.landingPageId) {
      throw new ValidationError(
        "该改写没有来源落地页（模板来源的改写请使用部署接口）"
      );
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

  /**
   * Deploy a DRAFT rewrite as a NEW landing page: the before→after pairs are
   * applied to the rewrite's base HTML (the source page's HTML for
   * page-sourced drafts, rewrittenContent.baseHtml for template-sourced
   * briefs) and the result is persisted as a fresh LandingPage. The source
   * page is never mutated. `offerId` defaults to the source page's offer;
   * template-sourced drafts must pass it explicitly.
   */
  app.post<{
    Params: { rewriteId: string };
    Body: { name?: unknown; offerId?: unknown; url?: unknown };
  }>("/api/v1/landing-pages/rewrites/:rewriteId/deploy", async (request) => {
    const tenantId = requireTenant(auth, request);
    const rewriteId = request.params.rewriteId;
    if (!isUuid(rewriteId)) throw new NotFoundError("Rewrite not found");
    const rewrite = (await prisma.landingPageRewrite.findFirst({
      where: { id: rewriteId, tenantId },
    })) as {
      id: string;
      tenantId: string;
      landingPageId: string | null;
      rewrittenContent: unknown;
      status: string;
      createdAt: Date;
      originalScore: number;
      issues: unknown;
      newScore: number | null;
    } | null;
    if (!rewrite) throw new NotFoundError("Rewrite not found");
    if (rewrite.status !== "DRAFT") {
      throw new ConflictError("该改写版本已经处理过（仅草稿可部署）");
    }

    const body = (request.body ?? {}) as {
      name?: unknown;
      offerId?: unknown;
      url?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ValidationError("name is required");
    if (name.length > 200)
      throw new ValidationError("name is too long (max 200 chars)");

    const content = (rewrite.rewrittenContent ?? {}) as {
      rewrites?: LpRewrite[];
      baseHtml?: unknown;
      source?: { kind?: string; landingPageId?: string; templateId?: string };
    };
    const rewrites = Array.isArray(content.rewrites) ? content.rewrites : [];

    // Resolve the base HTML: source page for page drafts, the stored
    // template render for template-sourced briefs.
    let baseHtml = "";
    let defaultOfferId: string | undefined;
    if (rewrite.landingPageId) {
      const page = await findOwnLandingPage(tenantId, rewrite.landingPageId);
      baseHtml = page.htmlContent ?? "";
      defaultOfferId = page.offerId;
    } else if (typeof content.baseHtml === "string" && content.baseHtml) {
      baseHtml = content.baseHtml;
    }
    if (!baseHtml) {
      throw new ValidationError("该改写没有可部署的页面内容");
    }

    const offerId = asOptionalUuid(body.offerId, "offerId") ?? defaultOfferId;
    if (!offerId) {
      throw new ValidationError(
        "offerId is required（模板来源的改写必须指定 offer）"
      );
    }
    const offer = await prisma.offer.findFirst({
      where: { id: offerId, tenantId, deletedAt: null },
    });
    if (!offer) throw new NotFoundError("Offer not found");

    const { url, domain } = assertOptionalHttpUrl(body.url);
    const report = applyRewritesToHtml(baseHtml, rewrites);

    const created = (await prisma.landingPage.create({
      data: {
        id: randomUUID(),
        tenantId,
        offerId,
        name: name.slice(0, 200),
        url,
        domain,
        htmlContent: report.html,
        status: "ACTIVE",
      },
    })) as {
      id: string;
      offerId: string;
      name: string;
      url: string;
      domain: string;
      status: string;
      createdAt: Date;
    };

    const deployedContent = JSON.parse(
      JSON.stringify({
        ...(content as Record<string, unknown>),
        deployedLandingPageId: created.id,
        deployedAt: new Date().toISOString(),
        deployedAppliedCount: report.applied,
        deployedSkipped: report.skipped,
      })
    );
    const updated = (await prisma.landingPageRewrite.update({
      where: { id: rewrite.id },
      data: { status: "DEPLOYED", rewrittenContent: deployedContent as never },
    })) as typeof rewrite;

    return {
      rewrite: toPublicRewrite(updated as never),
      landingPage: {
        id: created.id,
        offerId: created.offerId,
        name: created.name,
        url: created.url,
        domain: created.domain,
        status: created.status,
        createdAt:
          created.createdAt instanceof Date
            ? created.createdAt.toISOString()
            : created.createdAt,
      },
      applied: report.applied,
      skipped: report.skipped,
    };
  });
}
