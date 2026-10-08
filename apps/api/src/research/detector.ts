/**
 * Phase 4 Research Lab — differential detector (§21).
 *
 * Pure functions: compare two fetched variant responses, score the
 * differential 0-100 (weighted), and map the score to a five-level band.
 * Heuristic only — a high score is a research signal, not proof of cloaking.
 */

export interface RedirectHop {
  url: string;
  status: number;
}

/** Minimal response snapshot consumed by the detector. */
export interface ResponseSnapshot {
  variantName: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: RedirectHop[];
  headers: Record<string, string>;
  htmlHash: string | null;
  contentHash: string | null;
  textExcerpt: string | null;
  linksCount: number | null;
  scriptsCount: number | null;
}

export interface DifferentialMetrics {
  statusDiff: boolean;
  finalUrlDiff: boolean;
  redirectChainDiff: boolean;
  headerDiffCount: number;
  /** Which captured header names differed (evidence for the classifier). */
  headerDiffKeys: string[];
  htmlHashEqual: boolean;
  /** Jaccard word-token similarity of the text excerpts, 0-1. */
  textSimilarity: number;
  /** 100 * (1 - textSimilarity), 0-100. */
  contentDiffPct: number;
}

export type DifferentialBand =
  | "NORMAL"
  | "MINOR"
  | "SUSPICIOUS"
  | "HIGH_RISK"
  | "STRONG";

/** §21 score bands: 0-20 / 21-40 / 41-60 / 61-80 / 81-100. */
export function bandForScore(score: number): DifferentialBand {
  const s = Math.max(0, Math.min(100, score));
  if (s <= 20) return "NORMAL";
  if (s <= 40) return "MINOR";
  if (s <= 60) return "SUSPICIOUS";
  if (s <= 80) return "HIGH_RISK";
  return "STRONG";
}

/** Normalize a URL for comparison: lowercase host, drop trailing slash. */
export function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ""}${path}${u.search}`;
  } catch {
    return raw.trim();
  }
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9\u00e0-\u00ff\u0100-\u017f]+/i)) {
    if (w.length > 2) out.add(w);
  }
  return out;
}

/**
 * Jaccard similarity over lowercase word tokens (>2 chars).
 * 1 = identical token sets, 0 = disjoint. Empty/empty → 1.
 * Exported for unit tests.
 */
export function textSimilarity(a: string | null, b: string | null): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const sa = tokens(a);
  const sb = tokens(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

function chainSignature(chain: RedirectHop[]): string {
  return chain
    .map((h) => `${h.status}>${normalizeUrl(h.url) ?? h.url}`)
    .join("|");
}

function headerDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diff: string[] = [];
  for (const k of [...keys].sort()) {
    if ((a[k] ?? null) !== (b[k] ?? null)) diff.push(k);
  }
  return diff;
}

/** Pairwise comparison of two variant responses. */
export function compareResponses(
  a: ResponseSnapshot,
  b: ResponseSnapshot
): DifferentialMetrics {
  const statusDiff = a.httpStatus !== b.httpStatus;
  const finalUrlDiff = normalizeUrl(a.finalUrl) !== normalizeUrl(b.finalUrl);
  const redirectChainDiff =
    chainSignature(a.redirectChain) !== chainSignature(b.redirectChain);
  const headerDiffKeys = headerDiff(a.headers, b.headers);
  const htmlHashEqual =
    a.htmlHash !== null && b.htmlHash !== null && a.htmlHash === b.htmlHash;
  const sim = textSimilarity(a.textExcerpt, b.textExcerpt);
  return {
    statusDiff,
    finalUrlDiff,
    redirectChainDiff,
    headerDiffCount: headerDiffKeys.length,
    headerDiffKeys,
    htmlHashEqual,
    textSimilarity: sim,
    contentDiffPct: Math.round((1 - sim) * 1000) / 10,
  };
}

/**
 * Weighted differential score, 0-100:
 * - status differs: 20
 * - final URL differs: 20
 * - redirect chain differs: 10
 * - header diffs: 3 each, capped at 15
 * - HTML bytes differ: 15
 * - content difference: contentDiffPct * 0.2 (max 20)
 */
export function scoreDifferential(m: DifferentialMetrics): number {
  let s = 0;
  if (m.statusDiff) s += 20;
  if (m.finalUrlDiff) s += 20;
  if (m.redirectChainDiff) s += 10;
  s += Math.min(m.headerDiffCount, 5) * 3;
  if (!m.htmlHashEqual) s += 15;
  s += m.contentDiffPct * 0.2;
  return Math.min(100, Math.round(s * 10) / 10);
}
