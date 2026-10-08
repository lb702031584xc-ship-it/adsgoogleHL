import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  DEFAULT_VARIANTS,
  fetchAllVariants,
  type RequestVariant,
  type VariantFetchResult,
} from "../research/fetcher.js";
import {
  bandForScore,
  compareResponses,
  scoreDifferential,
  type DifferentialBand,
  type DifferentialMetrics,
} from "../research/detector.js";
import {
  CLASSIFICATIONS,
  DIFFERENCE_DISCLAIMER,
  classifyDifferential,
  type ClassifiedResponse,
  type ClassificationResult,
  type CloakClassification,
  type VariantAxes,
} from "../research/classifier.js";
import { simulateHtmlComparison } from "../research/simulate.js";

/**
 * Phase 4 Research Lab API (session auth, one tenant per user).
 *
 * ISOLATION IRON RULE: this module must never import tracking/campaign write
 * modules (tracking-link writes, TrackingLink updates, click ingestion,
 * worker queues, ...). The only cross-domain access allowed is a READ-ONLY
 * Offer lookup to resolve a target URL. Nothing here writes outside the
 * research_* / cloaking_findings tables (plus the test's own status field).
 */

export interface ResearchRouteDeps {
  prisma: PrismaClient;
  /** Injectable fetcher for tests; defaults to the real multi-variant fetcher. */
  fetchVariantsImpl?: (
    url: string,
    variants: RequestVariant[]
  ) => Promise<VariantFetchResult[]>;
}

async function requireSession(
  deps: ResearchRouteDeps,
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

/* ---------------- */
/* Small utilities  */
/* ---------------- */

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parsePagination(
  pageRaw: string | undefined,
  pageSizeRaw: string | undefined
): { page: number; pageSize: number } {
  const page = Math.max(1, Number(pageRaw) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || 20));
  return { page, pageSize };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Validate a target URL: non-empty, http(s), no credentials. */
function parseTargetUrl(raw: unknown): string {
  const t = asTrimmedString(raw);
  if (!t) {
    throw new ValidationError("targetUrl is required (or offerId to use the offer's destination URL)");
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ValidationError("targetUrl must be a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("targetUrl must be an http(s) URL");
  }
  if (u.username || u.password) {
    throw new ValidationError("targetUrl must not contain credentials");
  }
  return u.toString();
}

function parseVariant(raw: unknown, i: number): RequestVariant {
  if (!isRecord(raw)) {
    throw new ValidationError(`variants[${i}] must be an object`);
  }
  const name = asTrimmedString(raw.name);
  const userAgent = asTrimmedString(raw.userAgent);
  const acceptLanguage = asTrimmedString(raw.acceptLanguage);
  if (!name) throw new ValidationError(`variants[${i}].name is required`);
  if (!userAgent) throw new ValidationError(`variants[${i}].userAgent is required`);
  if (!acceptLanguage) {
    throw new ValidationError(`variants[${i}].acceptLanguage is required`);
  }
  const headers: Record<string, string> = {};
  if (isRecord(raw.headers)) {
    for (const [k, v] of Object.entries(raw.headers)) {
      if (typeof v === "string") headers[k] = v;
    }
  }
  return { name, userAgent, acceptLanguage, headers };
}

/** Validate request variants; defaults to the desktop/mobile × US/DE probe set. */
function parseVariants(raw: unknown): RequestVariant[] {
  if (raw === undefined || raw === null) return [...DEFAULT_VARIANTS];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError("variants must be a non-empty array");
  }
  if (raw.length > 6) {
    throw new ValidationError("variants supports at most 6 variants");
  }
  const out = raw.map((v, i) => parseVariant(v, i));
  const names = new Set<string>();
  for (const v of out) {
    if (names.has(v.name)) {
      throw new ValidationError(`duplicate variant name: ${v.name}`);
    }
    names.add(v.name);
  }
  return out;
}

/** Re-validate stored variants JSON at run time (defensive). */
function parseStoredVariants(raw: unknown): RequestVariant[] {
  if (!Array.isArray(raw)) return [...DEFAULT_VARIANTS];
  try {
    return parseVariants(raw);
  } catch {
    return [...DEFAULT_VARIANTS];
  }
}

/* ----- */
/* DTOs  */
/* ----- */

function iso(d: unknown): string | null {
  if (d === null || d === undefined) return null;
  return new Date(d as string | number | Date).toISOString();
}

function toTestDto(t: {
  id: string;
  tenantId: string;
  targetUrl: string;
  name: string;
  status: string;
  variants: unknown;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}): Record<string, unknown> {
  return {
    id: t.id,
    tenantId: t.tenantId,
    targetUrl: t.targetUrl,
    name: t.name,
    status: t.status,
    variants: t.variants,
    createdBy: t.createdBy,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  };
}

function toResponseDto(r: {
  id: string;
  researchTestId: string;
  variantName: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: unknown;
  headers: unknown;
  htmlHash: string | null;
  contentHash: string | null;
  textExcerpt: string | null;
  meta: unknown;
  linksCount: number | null;
  scriptsCount: number | null;
  fetchedAt: unknown;
}): Record<string, unknown> {
  return {
    id: r.id,
    researchTestId: r.researchTestId,
    variantName: r.variantName,
    httpStatus: r.httpStatus,
    finalUrl: r.finalUrl,
    redirectChain: r.redirectChain,
    headers: r.headers,
    htmlHash: r.htmlHash,
    contentHash: r.contentHash,
    textExcerpt: r.textExcerpt,
    meta: r.meta,
    linksCount: r.linksCount,
    scriptsCount: r.scriptsCount,
    fetchedAt: iso(r.fetchedAt),
  };
}

function toFindingDto(f: {
  id: string;
  researchTestId: string;
  offerId: string | null;
  differentialScore: number;
  band: string;
  classification: string;
  evidence: unknown;
  aiSummary: string | null;
  createdAt: unknown;
}): Record<string, unknown> {
  return {
    id: f.id,
    researchTestId: f.researchTestId,
    offerId: f.offerId,
    differentialScore: f.differentialScore,
    band: f.band,
    classification: f.classification,
    evidence: f.evidence,
    aiSummary: f.aiSummary,
    createdAt: iso(f.createdAt),
  };
}

/* --------------------------- */
/* Finding construction (pure) */
/* --------------------------- */

interface PairReport {
  a: string;
  b: string;
  metrics: DifferentialMetrics;
  score: number;
  band: DifferentialBand;
}

interface FailedVariant {
  variantName: string;
  error: string;
}

function toClassified(
  r: VariantFetchResult,
  variantByName: Map<string, RequestVariant>
): ClassifiedResponse {
  const cfg = variantByName.get(r.variantName);
  return {
    variantName: r.variantName,
    httpStatus: r.httpStatus,
    finalUrl: r.finalUrl,
    redirectChain: r.redirectChain,
    headers: r.headers,
    htmlHash: r.htmlHash,
    contentHash: r.contentHash,
    textExcerpt: r.textExcerpt,
    linksCount: r.linksCount,
    scriptsCount: r.scriptsCount,
    userAgent: cfg?.userAgent,
    acceptLanguage: cfg?.acceptLanguage,
  };
}

const EMPTY_AXES: { a: VariantAxes; b: VariantAxes } = {
  a: { device: "unknown", language: null, country: null },
  b: { device: "unknown", language: null, country: null },
};

function noComparisonClassification(
  failed: FailedVariant[]
): ClassificationResult {
  return {
    classification: "NORMAL_AB_TEST",
    confidence: 0,
    reasons: [
      failed.length > 0
        ? `少于两个变体成功返回(${failed.length} 个变体抓取失败)，无法进行差异比较`
        : "少于两个变体，无法进行差异比较",
      DIFFERENCE_DISCLAIMER,
    ],
    disclaimer: DIFFERENCE_DISCLAIMER,
    axes: EMPTY_AXES,
  };
}

export async function registerResearchRoutes(
  app: FastifyInstance,
  deps: ResearchRouteDeps
): Promise<void> {
  const { prisma } = deps;

  /**
   * Create a research test. targetUrl may be omitted when offerId is given —
   * the offer's destination URL is read (READ-ONLY) and used as the target.
   */
  app.post<{
    Body: {
      targetUrl?: unknown;
      name?: unknown;
      variants?: unknown;
      offerId?: unknown;
    };
  }>("/api/v1/research/tests", async (request) => {
    const info = await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      targetUrl?: unknown;
      name?: unknown;
      variants?: unknown;
      offerId?: unknown;
    };

    let targetUrl = asTrimmedString(body.targetUrl) ?? "";
    const offerId = asTrimmedString(body.offerId);
    if (!targetUrl && offerId) {
      // READ-ONLY offer lookup — the isolation iron rule allows this.
      const offer = await prisma.offer.findFirst({
        where: { id: offerId, tenantId: info.tenantId, deletedAt: null },
      });
      if (!offer) throw new NotFoundError("Offer", offerId);
      targetUrl = offer.destinationUrl;
    }
    const url = parseTargetUrl(targetUrl);
    const variants = parseVariants(body.variants);
    const name = asTrimmedString(body.name) ?? `Research — ${hostOf(url)}`;

    const test = await prisma.researchTest.create({
      data: {
        id: randomUUID(),
        tenantId: info.tenantId,
        targetUrl: url,
        name,
        status: "PENDING",
        variants: JSON.parse(JSON.stringify(variants)) as never,
        createdBy: info.id,
      },
    });
    return toTestDto(test as unknown as Parameters<typeof toTestDto>[0]);
  });

  /** List this tenant's research tests (newest first). */
  app.get<{
    Querystring: { page?: string; pageSize?: string };
  }>("/api/v1/research/tests", async (request) => {
    const info = await requireSession(deps, request);
    const { page, pageSize } = parsePagination(
      request.query.page,
      request.query.pageSize
    );
    const where = { tenantId: info.tenantId, deletedAt: null };
    const total = await prisma.researchTest.count({ where });
    const rows = await prisma.researchTest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((t) =>
        toTestDto(t as unknown as Parameters<typeof toTestDto>[0])
      ),
      total,
      page,
      pageSize,
    };
  });

  /** Test detail with its latest-run responses. */
  app.get<{ Params: { id: string } }>(
    "/api/v1/research/tests/:id",
    async (request) => {
      const info = await requireSession(deps, request);
      const test = await prisma.researchTest.findFirst({
        where: {
          id: request.params.id,
          tenantId: info.tenantId,
          deletedAt: null,
        },
      });
      if (!test) throw new NotFoundError("ResearchTest", request.params.id);
      const responses = await prisma.researchResponse.findMany({
        where: {
          researchTestId: test.id,
          tenantId: info.tenantId,
          deletedAt: null,
        },
        orderBy: { fetchedAt: "asc" },
      });
      return {
        ...toTestDto(test as unknown as Parameters<typeof toTestDto>[0]),
        responses: responses.map((r) =>
          toResponseDto(r as unknown as Parameters<typeof toResponseDto>[0])
        ),
      };
    }
  );

  /**
   * Run a test: fetch all variants (injectable for tests), persist
   * ResearchResponse rows, run the detector over every successful pair, and
   * persist the worst-pair CloakingFinding. Previous run artefacts are
   * soft-deleted so GET endpoints always show the latest run.
   */
  app.post<{
    Params: { id: string };
    Body: { offerId?: unknown };
  }>("/api/v1/research/tests/:id/run", async (request) => {
    const info = await requireSession(deps, request);
    const test = await prisma.researchTest.findFirst({
      where: {
        id: request.params.id,
        tenantId: info.tenantId,
        deletedAt: null,
      },
    });
    if (!test) throw new NotFoundError("ResearchTest", request.params.id);

    await prisma.researchTest.update({
      where: { id: test.id },
      data: { status: "RUNNING" },
    });

    try {
      const variants = parseStoredVariants(
        test.variants as unknown as unknown
      );
      const fetchImpl = deps.fetchVariantsImpl ?? fetchAllVariants;
      const results = await fetchImpl(test.targetUrl, variants);
      const now = new Date();

      // Soft-delete previous run artefacts (latest-run semantics).
      await prisma.researchResponse.updateMany({
        where: {
          researchTestId: test.id,
          tenantId: info.tenantId,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });
      await prisma.cloakingFinding.updateMany({
        where: {
          researchTestId: test.id,
          tenantId: info.tenantId,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      const responseRows: Array<Parameters<typeof toResponseDto>[0]> = [];
      for (const r of results) {
        const row = await prisma.researchResponse.create({
          data: {
            id: randomUUID(),
            tenantId: info.tenantId,
            researchTestId: test.id,
            variantName: r.variantName,
            httpStatus: r.httpStatus,
            finalUrl: r.finalUrl,
            redirectChain: JSON.parse(JSON.stringify(r.redirectChain)) as never,
            headers: JSON.parse(JSON.stringify(r.headers)) as never,
            htmlHash: r.htmlHash,
            contentHash: r.contentHash,
            textExcerpt: r.textExcerpt,
            meta: JSON.parse(JSON.stringify(r.meta)) as never,
            linksCount: r.linksCount,
            scriptsCount: r.scriptsCount,
            fetchedAt: r.fetchedAt,
          },
        });
        responseRows.push(
          row as unknown as Parameters<typeof toResponseDto>[0]
        );
      }

      // Optional offer link — READ-ONLY validation.
      let offerId: string | null = null;
      const offerIdRaw = asTrimmedString(
        ((request.body ?? {}) as { offerId?: unknown }).offerId
      );
      if (offerIdRaw) {
        const offer = await prisma.offer.findFirst({
          where: { id: offerIdRaw, tenantId: info.tenantId, deletedAt: null },
        });
        if (!offer) throw new NotFoundError("Offer", offerIdRaw);
        offerId = offer.id;
      }

      // Differential analysis over every successful pair.
      const variantByName = new Map(variants.map((v) => [v.name, v]));
      const successful = results.filter(
        (r) => r.httpStatus !== null && r.htmlHash !== null
      );
      const failed: FailedVariant[] = results
        .filter((r) => !(r.httpStatus !== null && r.htmlHash !== null))
        .map((r) => ({
          variantName: r.variantName,
          error:
            typeof r.meta.error === "string" && r.meta.error
              ? r.meta.error
              : "fetch failed",
        }));

      const pairs: PairReport[] = [];
      for (let i = 0; i < successful.length; i++) {
        for (let j = i + 1; j < successful.length; j++) {
          const ra = toClassified(successful[i]!, variantByName);
          const rb = toClassified(successful[j]!, variantByName);
          const metrics = compareResponses(ra, rb);
          const score = scoreDifferential(metrics);
          pairs.push({
            a: ra.variantName,
            b: rb.variantName,
            metrics,
            score,
            band: bandForScore(score),
          });
        }
      }

      let classification: ClassificationResult;
      let worstScore = 0;
      let worstBand: DifferentialBand = "NORMAL";
      let worstPair: { a: string; b: string } | null = null;
      if (pairs.length > 0) {
        let worst = pairs[0]!;
        for (const p of pairs) {
          if (p.score > worst.score) worst = p;
        }
        worstScore = worst.score;
        worstBand = worst.band;
        worstPair = { a: worst.a, b: worst.b };
        const ra = toClassified(
          successful.find((r) => r.variantName === worst.a)!,
          variantByName
        );
        const rb = toClassified(
          successful.find((r) => r.variantName === worst.b)!,
          variantByName
        );
        classification = classifyDifferential(ra, rb, worst.metrics);
      } else {
        classification = noComparisonClassification(failed);
      }

      if (!CLASSIFICATIONS.includes(classification.classification)) {
        // Defensive: the classifier contract guarantees one of the 8 labels.
        classification = {
          ...classification,
          classification: "SUSPICIOUS_CLOAKING" as CloakClassification,
        };
      }

      const evidence = {
        comparedAt: now.toISOString(),
        variantCount: results.length,
        successCount: successful.length,
        failedVariants: failed,
        pairs,
        worstPair,
        classification: {
          classification: classification.classification,
          confidence: classification.confidence,
          reasons: classification.reasons,
          axes: classification.axes,
        },
      };

      const finding = await prisma.cloakingFinding.create({
        data: {
          id: randomUUID(),
          tenantId: info.tenantId,
          researchTestId: test.id,
          offerId,
          differentialScore: worstScore,
          band: worstBand,
          classification: classification.classification,
          evidence: JSON.parse(JSON.stringify(evidence)) as never,
          aiSummary: null,
        },
      });

      const updated = await prisma.researchTest.update({
        where: { id: test.id },
        data: { status: "COMPLETED" },
      });

      return {
        test: toTestDto(updated as unknown as Parameters<typeof toTestDto>[0]),
        responses: responseRows.map(toResponseDto),
        finding: toFindingDto(
          finding as unknown as Parameters<typeof toFindingDto>[0]
        ),
      };
    } catch (err) {
      await prisma.researchTest
        .update({ where: { id: test.id }, data: { status: "FAILED" } })
        .catch(() => undefined);
      throw err;
    }
  });

  /** Latest finding for a test (404 when the test never ran). */
  app.get<{ Params: { id: string } }>(
    "/api/v1/research/tests/:id/finding",
    async (request) => {
      const info = await requireSession(deps, request);
      const test = await prisma.researchTest.findFirst({
        where: {
          id: request.params.id,
          tenantId: info.tenantId,
          deletedAt: null,
        },
      });
      if (!test) throw new NotFoundError("ResearchTest", request.params.id);
      const finding = await prisma.cloakingFinding.findFirst({
        where: {
          researchTestId: test.id,
          tenantId: info.tenantId,
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (!finding) throw new NotFoundError("CloakingFinding", test.id);
      return toFindingDto(
        finding as unknown as Parameters<typeof toFindingDto>[0]
      );
    }
  );

  /**
   * Self-owned simulation: run the detector + classifier over two preset
   * HTML strings. No DB writes, no network — verifies the pipeline itself.
   */
  app.post<{
    Body: {
      htmlA?: unknown;
      htmlB?: unknown;
      nameA?: unknown;
      nameB?: unknown;
      variantA?: unknown;
      variantB?: unknown;
      finalUrlA?: unknown;
      finalUrlB?: unknown;
      httpStatusA?: unknown;
      httpStatusB?: unknown;
    };
  }>("/api/v1/research/simulate", async (request) => {
    await requireSession(deps, request);
    const body = (request.body ?? {}) as {
      htmlA?: unknown;
      htmlB?: unknown;
      nameA?: unknown;
      nameB?: unknown;
      variantA?: unknown;
      variantB?: unknown;
      finalUrlA?: unknown;
      finalUrlB?: unknown;
      httpStatusA?: unknown;
      httpStatusB?: unknown;
    };
    const htmlA = typeof body.htmlA === "string" ? body.htmlA : "";
    const htmlB = typeof body.htmlB === "string" ? body.htmlB : "";
    if (!htmlA || !htmlB) {
      throw new ValidationError("htmlA and htmlB are required");
    }
    if (htmlA.length > 2_000_000 || htmlB.length > 2_000_000) {
      throw new ValidationError("htmlA/htmlB must be under 2MB each");
    }
    const variantDesc = (v: unknown): { name: string; userAgent?: string; acceptLanguage?: string } | undefined => {
      if (!isRecord(v)) return undefined;
      const name = asTrimmedString(v.name);
      if (!name) return undefined;
      return {
        name,
        userAgent: asTrimmedString(v.userAgent),
        acceptLanguage: asTrimmedString(v.acceptLanguage),
      };
    };
    const numOrUndef = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;

    const report = simulateHtmlComparison({
      htmlA,
      htmlB,
      nameA: asTrimmedString(body.nameA),
      nameB: asTrimmedString(body.nameB),
      variantA: variantDesc(body.variantA),
      variantB: variantDesc(body.variantB),
      finalUrlA: asTrimmedString(body.finalUrlA),
      finalUrlB: asTrimmedString(body.finalUrlB),
      httpStatusA: numOrUndef(body.httpStatusA),
      httpStatusB: numOrUndef(body.httpStatusB),
    });
    return {
      metrics: report.metrics,
      score: report.score,
      band: report.band,
      classification: report.classification,
    };
  });
}
