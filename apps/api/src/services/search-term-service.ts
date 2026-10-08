/**
 * 自动化套件 2/5 — 搜索词自动否词 (search term miner): application service.
 *
 * - analyzeAndSave: parse pasted search-term reports (CSV with header / plain
 *   one-per-line / tab-separated), dedupe, run the LLM analyzer, persist
 *   SearchTermSuggestion rows (status=PENDING).
 * - applySuggestion: mark APPLIED and queue a PENDING SyncJob
 *   (type SEARCH_TERM_NEGATIVE_PUSH) carrying the negative keyword payload —
 *   the same task mechanism as campaign-toggle. There is deliberately no
 *   "pushed" claim: the negative keyword text is returned so the user can
 *   copy/paste it (or a future script can consume the queued task).
 * - dismissSuggestion / listSuggestions: status transitions + paged listing.
 *
 * All operations are tenant-scoped. Injectable chatJsonImpl for tests.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "@adlinklab/shared";
import {
  analyzeSearchTerms,
  type SearchTermAnalysis,
} from "../ai/search-term-analyzer.js";
import { assertAiSettingsPepperConfigured, decryptSecret } from "../ai/crypto.js";
import { AiError, chatJson } from "../ai/llm.js";

/** Hard cap on terms per analyze request (prompt + cost safety). */
export const MAX_TERMS_PER_ANALYZE = 500;

const SETTING_BASE_URL = "llm.baseUrl";
const SETTING_MODEL = "llm.model";
const SETTING_API_KEY_ENC = "llm.apiKeyEnc";

const NEGATIVE_PUSH_TASK_TYPE = "SEARCH_TERM_NEGATIVE_PUSH";
const NEGATIVE_PUSH_IDEMPOTENCY_SCOPE = "SEARCH_TERM_NEGATIVE";
const NEGATIVE_PUSH_PROVIDER = "manual";

export type SearchTermSuggestionStatusFilter =
  | "PENDING"
  | "APPLIED"
  | "DISMISSED";

export interface ParsedSearchTermRow {
  term: string;
  matchType?: string;
}

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readLlmSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = (await prisma.aiSetting.findMany()) as Array<{
    key: string;
    value: string;
  }>;
  const out: LlmSettings = {};
  for (const r of rows) {
    if (r.key === SETTING_BASE_URL) out.baseUrl = r.value;
    else if (r.key === SETTING_MODEL) out.model = r.value;
    else if (r.key === SETTING_API_KEY_ENC) out.apiKeyEnc = r.value;
  }
  return out;
}

/**
 * Split a CSV line on commas/tabs respecting double quotes. Minimal on
 * purpose — search-term exports don't contain embedded newlines.
 */
function splitDelimited(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (ch === "," || ch === "\t")) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const TERM_HEADER_HINTS = [
  "search term",
  "searchterm",
  "search query",
  "搜索词",
  "关键词",
  "query",
];
const MATCH_TYPE_HEADER_HINTS = ["match type", "matchtype", "匹配类型"];

function headerIndex(headers: string[], hints: string[]): number {
  const lowered = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const idx = lowered.findIndex((h) => h.includes(hint));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Parse pasted search-term input. Accepts:
 * - CSV with a header row (search-term column auto-detected by header name,
 *   falls back to the first column; match-type column detected when present)
 * - tab-separated values (same rules as CSV)
 * - plain text, one term per line
 * Dedupes case-insensitively, drops empties, caps at MAX_TERMS_PER_ANALYZE.
 */
export function parseSearchTermRows(rawText: string): ParsedSearchTermRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const looksDelimited = lines.some(
    (l) => l.includes(",") || l.includes("\t")
  );
  const rows: ParsedSearchTermRow[] = [];

  if (looksDelimited && lines.length >= 2) {
    const header = splitDelimited(lines[0]);
    const termIdx = headerIndex(header, TERM_HEADER_HINTS);
    const matchIdx = headerIndex(header, MATCH_TYPE_HEADER_HINTS);
    const hasHeader = termIdx >= 0;
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const tIdx = hasHeader ? termIdx : 0;
    for (const line of dataLines) {
      const cells = splitDelimited(line);
      const term = (cells[tIdx] ?? "").trim();
      if (!term) continue;
      const matchType =
        matchIdx >= 0 ? (cells[matchIdx] ?? "").trim() || undefined : undefined;
      rows.push({ term, matchType });
    }
  } else {
    for (const line of lines) {
      // Tab-separated without header: first field is the term.
      const term = splitDelimited(line)[0]?.trim() ?? "";
      if (term) rows.push({ term });
    }
  }

  const seen = new Set<string>();
  const out: ParsedSearchTermRow[] = [];
  for (const row of rows) {
    const key = row.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= MAX_TERMS_PER_ANALYZE) break;
  }
  return out;
}

export function buildNegativeKeywordText(
  analysis: Pick<SearchTermAnalysis, "searchTerm" | "suggestedAction">
): string | null {
  if (analysis.suggestedAction === "ADD_NEGATIVE_EXACT") {
    return `[${analysis.searchTerm}]`;
  }
  if (analysis.suggestedAction === "ADD_NEGATIVE_PHRASE") {
    return `"${analysis.searchTerm}"`;
  }
  return null;
}

export interface AnalyzeAndSaveOptions {
  campaignName?: string;
  offerHint?: string;
  chatJsonImpl?: typeof chatJson;
}

export interface AnalyzeAndSaveResult {
  analyzed: number;
  suggestions: Array<{
    id: string;
    searchTerm: string;
    campaignName: string | null;
    suggestedAction: string;
    reason: string | null;
    status: string;
  }>;
}

/** Analyze pasted search terms and persist PENDING suggestions. */
export async function analyzeAndSave(
  prisma: PrismaClient,
  tenantId: string,
  rawText: string,
  opts: AnalyzeAndSaveOptions = {}
): Promise<AnalyzeAndSaveResult> {
  const rows = parseSearchTermRows(rawText);
  if (rows.length === 0) {
    throw new ValidationError(
      "No search terms found — paste a search term report (CSV or one term per line)"
    );
  }

  const settings = await readLlmSettings(prisma);
  if (!settings.baseUrl || !settings.model || !settings.apiKeyEnc) {
    throw new AppError("AI is not configured", {
      code: "AI_NOT_CONFIGURED",
      statusCode: 400,
    });
  }
  const pepper = assertAiSettingsPepperConfigured();
  const apiKey = decryptSecret(settings.apiKeyEnc, pepper);

  let analyses: SearchTermAnalysis[];
  try {
    analyses = await analyzeSearchTerms(
      rows.map((r) => r.term),
      {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey,
        system: "",
        user: "",
      },
      {
        campaignName: opts.campaignName,
        offerHint: opts.offerHint,
        chatJsonImpl: opts.chatJsonImpl,
      }
    );
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("LLM request failed");
  }

  const matchByTerm = new Map(rows.map((r) => [r.term.toLowerCase(), r]));
  const created: AnalyzeAndSaveResult["suggestions"] = [];
  for (const a of analyses) {
    const row = matchByTerm.get(a.searchTerm.toLowerCase());
    const saved = (await prisma.searchTermSuggestion.create({
      data: {
        id: randomUUID(),
        tenantId,
        searchTerm: a.searchTerm,
        campaignName: opts.campaignName ?? null,
        matchType: row?.matchType ?? null,
        suggestedAction: a.suggestedAction,
        reason: a.reason,
        status: "PENDING",
      },
    })) as AnalyzeAndSaveResult["suggestions"][number];
    created.push({
      id: saved.id,
      searchTerm: saved.searchTerm,
      campaignName: saved.campaignName,
      suggestedAction: saved.suggestedAction,
      reason: saved.reason,
      status: saved.status,
    });
  }
  return { analyzed: analyses.length, suggestions: created };
}

export interface ApplySuggestionResult {
  suggestion: {
    id: string;
    searchTerm: string;
    campaignName: string | null;
    suggestedAction: string;
    reason: string | null;
    status: string;
  };
  /** Google Ads negative keyword text (`[term]` / `"term"`), or null when IGNORE. */
  negativeText: string | null;
  /** Queued SyncJob id (PENDING) — never claim "pushed" before a script runs. */
  taskId: string | null;
  deduped: boolean;
}

/**
 * Mark a suggestion APPLIED and queue a PENDING negative-keyword push task
 * (SyncJob), idempotent per suggestion. Returns the negative keyword text for
 * manual copy/paste. IGNORE suggestions only flip status (no task, no text).
 */
export async function applySuggestion(
  prisma: PrismaClient,
  tenantId: string,
  id: string,
  opts: { requestedBy?: string } = {}
): Promise<ApplySuggestionResult> {
  const existing = (await prisma.searchTermSuggestion.findFirst({
    where: { id, tenantId },
  })) as ApplySuggestionResult["suggestion"] | null;
  if (!existing) {
    throw new NotFoundError("SearchTermSuggestion", id);
  }

  const negativeText = buildNegativeKeywordText(
    existing as Pick<SearchTermAnalysis, "searchTerm" | "suggestedAction">
  );

  if (existing.status === "APPLIED") {
    // Idempotent: return current state (and the already-queued task, if any).
    const prior = (await prisma.syncJob.findFirst({
      where: {
        tenantId,
        type: NEGATIVE_PUSH_TASK_TYPE,
        idempotencyScope: NEGATIVE_PUSH_IDEMPOTENCY_SCOPE,
        idempotencyKey: `suggestion:${id}`,
        status: { in: ["PENDING", "RUNNING"] },
      },
    })) as { id: string } | null;
    return {
      suggestion: existing,
      negativeText,
      taskId: prior?.id ?? null,
      deduped: true,
    };
  }

  const updated = (await prisma.searchTermSuggestion.update({
    where: { id },
    data: { status: "APPLIED" },
  })) as ApplySuggestionResult["suggestion"];

  let taskId: string | null = null;
  let deduped = false;
  if (negativeText) {
    const idempotencyKey = `suggestion:${id}`;
    const queued = (await prisma.syncJob.findFirst({
      where: {
        tenantId,
        type: NEGATIVE_PUSH_TASK_TYPE,
        idempotencyScope: NEGATIVE_PUSH_IDEMPOTENCY_SCOPE,
        idempotencyKey,
        status: { in: ["PENDING", "RUNNING"] },
      },
    })) as { id: string } | null;
    if (queued) {
      taskId = queued.id;
      deduped = true;
    } else {
      taskId = randomUUID();
      const payload = {
        taskId,
        type: NEGATIVE_PUSH_TASK_TYPE,
        tenantId,
        suggestionId: id,
        searchTerm: updated.searchTerm,
        campaignName: updated.campaignName,
        suggestedAction: updated.suggestedAction,
        negativeText,
        queuedAt: new Date().toISOString(),
        note: "Queued for manual copy/paste or a future Google Ads script — NOT yet pushed to Google Ads.",
      };
      await prisma.syncJob.create({
        data: {
          id: taskId,
          tenantId,
          type: NEGATIVE_PUSH_TASK_TYPE,
          status: "PENDING",
          provider: NEGATIVE_PUSH_PROVIDER,
          idempotencyScope: NEGATIVE_PUSH_IDEMPOTENCY_SCOPE,
          idempotencyKey,
          attempts: 0,
        },
      });
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          actorId: opts.requestedBy ?? null,
          action: "SEARCH_TERM_NEGATIVE_QUEUED",
          entityType: "SyncJob",
          entityId: taskId,
          after: JSON.parse(JSON.stringify(payload)) as never,
          reason: `negative keyword queued for "${updated.searchTerm}"`,
        },
      });
    }
  }

  return { suggestion: updated, negativeText, taskId, deduped };
}

/** Mark a suggestion DISMISSED (kept for audit, never deleted). */
export async function dismissSuggestion(
  prisma: PrismaClient,
  tenantId: string,
  id: string
): Promise<ApplySuggestionResult["suggestion"]> {
  const existing = await prisma.searchTermSuggestion.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    throw new NotFoundError("SearchTermSuggestion", id);
  }
  return (await prisma.searchTermSuggestion.update({
    where: { id },
    data: { status: "DISMISSED" },
  })) as ApplySuggestionResult["suggestion"];
}

export interface ListSuggestionsOptions {
  status?: SearchTermSuggestionStatusFilter;
  page?: number;
  pageSize?: number;
}

export interface ListSuggestionsResult {
  items: ApplySuggestionResult["suggestion"][];
  total: number;
  page: number;
  pageSize: number;
}

/** Paged, tenant-scoped suggestion listing (newest first). */
export async function listSuggestions(
  prisma: PrismaClient,
  tenantId: string,
  opts: ListSuggestionsOptions = {}
): Promise<ListSuggestionsResult> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  const where: Record<string, unknown> = { tenantId };
  if (opts.status) where.status = opts.status;
  const [items, total] = await Promise.all([
    prisma.searchTermSuggestion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.searchTermSuggestion.count({ where }),
  ]);
  return {
    items: items as ListSuggestionsResult["items"],
    total,
    page,
    pageSize,
  };
}
