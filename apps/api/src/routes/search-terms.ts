/**
 * 自动化套件 2/5 — 搜索词自动否词 (search term miner) API.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 *
 * - POST /api/v1/search-terms/analyze   { text, campaignName?, offerHint? }
 * - POST /api/v1/search-terms/:id/apply
 * - POST /api/v1/search-terms/:id/dismiss
 * - GET  /api/v1/search-terms           ?status ?page ?pageSize
 *
 * Session auth only (one tenant per user); tenant via requireTenant.
 * Registered by the parent (routes/index.ts) — this file only exports
 * registerSearchTermRoutes(app, services, auth).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ValidationError } from "@adlinklab/shared";
import type { PrismaClient } from "@adlinklab/database";
import { requireTenant, type AuthContext } from "../auth/tenant.js";
import { chatJson } from "../ai/llm.js";
import {
  analyzeAndSave,
  applySuggestion,
  dismissSuggestion,
  listSuggestions,
  type SearchTermSuggestionStatusFilter,
} from "../services/search-term-service.js";

export interface SearchTermRouteDeps {
  prisma: PrismaClient;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TEXT_CHARS = 20_000;
const STATUSES: readonly SearchTermSuggestionStatusFilter[] = [
  "PENDING",
  "APPLIED",
  "DISMISSED",
];

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function asOptionalTrimmedString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return asTrimmedString(v);
}

function assertUuid(id: unknown): string {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new ValidationError("Invalid suggestion id");
  }
  return id;
}

function asPageNumber(v: unknown, def: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new ValidationError("page/pageSize must be positive numbers");
  }
  return Math.floor(n);
}

export async function registerSearchTermRoutes(
  app: FastifyInstance,
  services: SearchTermRouteDeps,
  auth: AuthContext
): Promise<void> {
  const { prisma, chatJsonImpl } = services;
  const tenantOf = (request: FastifyRequest): string =>
    requireTenant(auth, request);

  /**
   * Analyze a pasted search-term report and persist PENDING suggestions.
   * text: up to 20_000 chars (CSV with header / one-per-line / tab-separated).
   */
  app.post("/api/v1/search-terms/analyze", async (request) => {
    const tenantId = tenantOf(request);
    const body = (request.body ?? {}) as {
      text?: unknown;
      campaignName?: unknown;
      offerHint?: unknown;
    };
    const text = asTrimmedString(body.text);
    if (!text) {
      throw new ValidationError("text is required");
    }
    if (text.length > MAX_TEXT_CHARS) {
      throw new ValidationError(
        `text must be at most ${MAX_TEXT_CHARS} characters`
      );
    }
    const result = await analyzeAndSave(prisma, tenantId, text, {
      campaignName: asOptionalTrimmedString(body.campaignName),
      offerHint: asOptionalTrimmedString(body.offerHint),
      chatJsonImpl,
    });
    return { ok: true, ...result };
  });

  /**
   * Mark a suggestion APPLIED and queue a PENDING negative-keyword push task
   * (SyncJob). Returns the negative keyword text for copy/paste — the task is
   * queued, NOT pushed (honest status; a future script consumes the task).
   */
  app.post<{ Params: { id: string } }>(
    "/api/v1/search-terms/:id/apply",
    async (request) => {
      const tenantId = tenantOf(request);
      const id = assertUuid(request.params.id);
      const session = request.sessionAuth;
      const result = await applySuggestion(prisma, tenantId, id, {
        requestedBy: session?.id,
      });
      return { ok: true, ...result };
    }
  );

  /** Mark a suggestion DISMISSED (kept for audit). */
  app.post<{ Params: { id: string } }>(
    "/api/v1/search-terms/:id/dismiss",
    async (request) => {
      const tenantId = tenantOf(request);
      const id = assertUuid(request.params.id);
      const suggestion = await dismissSuggestion(prisma, tenantId, id);
      return { ok: true, suggestion };
    }
  );

  /** Paged, tenant-scoped suggestion listing (newest first). */
  app.get("/api/v1/search-terms", async (request) => {
    const tenantId = tenantOf(request);
    const query = (request.query ?? {}) as {
      status?: unknown;
      page?: unknown;
      pageSize?: unknown;
    };
    let status: SearchTermSuggestionStatusFilter | undefined;
    if (query.status !== undefined && query.status !== "") {
      if (
        typeof query.status !== "string" ||
        !STATUSES.includes(query.status as SearchTermSuggestionStatusFilter)
      ) {
        throw new ValidationError(
          `status must be one of ${STATUSES.join(" | ")}`
        );
      }
      status = query.status as SearchTermSuggestionStatusFilter;
    }
    const result = await listSuggestions(prisma, tenantId, {
      status,
      page: asPageNumber(query.page, 1),
      pageSize: Math.min(100, asPageNumber(query.pageSize, 20)),
    });
    return { ok: true, ...result };
  });
}
