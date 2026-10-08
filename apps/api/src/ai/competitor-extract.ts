/**
 * Lander Intel ② — competitor landing-page change detector (deterministic part).
 *
 * Pure functions over raw HTML: no I/O, no LLM, fully unit-testable.
 * `extractCompetitorFields` pulls { title, price, cta, sections }; snapshots
 * are SHA-256 hashed (`hashCompetitorSnapshot`) and diffed field-by-field
 * (`diffCompetitorSnapshots`) against the previous snapshot (reconstructed
 * from the latest CompetitorChange row's `after` values; null when the watch
 * has no baseline yet).
 */
import { createHash } from "node:crypto";

/** Key fields extracted from a competitor landing page. */
export interface CompetitorSnapshot {
  /** `<title>` text. */
  title: string;
  /** Up to 3 price strings, first-match order. */
  price: string[];
  /** Up to 5 CTA texts, deduped, document order. */
  cta: string[];
  /** All h1/h2 texts, document order. */
  sections: string[];
}

/** Field-level diff written to CompetitorChange.diffSummary. */
export interface CompetitorDiff {
  title?: { before: string | null; after: string };
  price?: { before: string[] | null; after: string[] };
  cta?: { before: string[] | null; after: string[] };
  sectionsAdded?: string[];
  sectionsRemoved?: string[];
}

/** First-match price pattern: $ / ¥ / € followed by a number. */
const PRICE_RE = /[$¥€]\s?[\d,]+(\.\d{2})?/g;
const MAX_PRICES = 3;

/** CTA keyword list (zh + en), matched case-insensitively against link/button text. */
const CTA_KEYWORDS = [
  "购买",
  "立即",
  "免费试用",
  "了解更多",
  "抢购",
  "领取",
  "buy now",
  "sign up",
  "free trial",
  "claim",
  "get started",
  "shop now",
];
const MAX_CTAS = 5;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Inner texts of every <tag …>…</tag> occurrence, document order. */
function innerTexts(html: string, tag: string): string[] {
  const out: string[] = [];
  const rx = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null && out.length < 5000) {
    const text = cleanText(m[0]);
    if (text) out.push(text);
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return out;
}

/** Inner texts of <a> and <button> elements, document order. */
function linkButtonTexts(html: string): string[] {
  const out: string[] = [];
  const rx = /<(a|button)[\s>][\s\S]*?<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null && out.length < 5000) {
    const text = cleanText(m[0]);
    if (text) out.push(text);
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return out;
}

function dedupeKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Extract the competitor key fields from raw HTML.
 * Never throws on malformed HTML — returns best-effort fields.
 */
export function extractCompetitorFields(html: string): CompetitorSnapshot {
  const safe = typeof html === "string" ? html : "";

  // title
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(safe);
  const title = titleMatch ? cleanText(titleMatch[1] ?? "") : "";

  // price: first MAX_PRICES matches
  const price: string[] = [];
  const priceRx = new RegExp(PRICE_RE.source, PRICE_RE.flags);
  let pm: RegExpExecArray | null;
  while ((pm = priceRx.exec(safe)) !== null && price.length < MAX_PRICES) {
    price.push(pm[0].replace(/\s+/g, " ").trim());
    if (pm[0].length === 0) priceRx.lastIndex += 1;
  }

  // cta: <a>/<button> texts containing a CTA keyword, deduped (doc order)
  const linkTexts = linkButtonTexts(safe);
  const ctaHits = linkTexts.filter((t) => {
    const lower = t.toLowerCase();
    return CTA_KEYWORDS.some((kw) => lower.includes(kw));
  });
  const cta = dedupeKeepOrder(ctaHits).slice(0, MAX_CTAS);

  // sections: h1/h2 texts
  const sections = dedupeKeepOrder([
    ...innerTexts(safe, "h1"),
    ...innerTexts(safe, "h2"),
  ]);

  return { title, price, cta, sections };
}

/** Stable SHA-256 over the canonical JSON of a snapshot. */
export function hashCompetitorSnapshot(snapshot: CompetitorSnapshot): string {
  const canonical = JSON.stringify({
    title: snapshot.title,
    price: snapshot.price,
    cta: snapshot.cta,
    sections: snapshot.sections,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Field-level diff. `before` is null when the watch has no previous
 * snapshot (first detected change): `after` values are still recorded,
 * sections added/removed are left undefined.
 */
export function diffCompetitorSnapshots(
  before: CompetitorSnapshot | null,
  after: CompetitorSnapshot
): CompetitorDiff {
  const diff: CompetitorDiff = {};
  if (!before) {
    diff.title = { before: null, after: after.title };
    diff.price = { before: null, after: after.price };
    diff.cta = { before: null, after: after.cta };
    return diff;
  }
  if (before.title !== after.title) {
    diff.title = { before: before.title, after: after.title };
  }
  if (!arraysEqual(before.price, after.price)) {
    diff.price = { before: before.price, after: after.price };
  }
  if (!arraysEqual(before.cta, after.cta)) {
    diff.cta = { before: before.cta, after: after.cta };
  }
  const beforeSet = new Set(before.sections);
  const afterSet = new Set(after.sections);
  const added = after.sections.filter((s) => !beforeSet.has(s));
  const removed = before.sections.filter((s) => !afterSet.has(s));
  if (added.length > 0) diff.sectionsAdded = added;
  if (removed.length > 0) diff.sectionsRemoved = removed;
  return diff;
}

/** True when the diff actually records a field-level change. */
export function diffIsEmpty(diff: CompetitorDiff): boolean {
  return (
    diff.title === undefined &&
    diff.price === undefined &&
    diff.cta === undefined &&
    diff.sectionsAdded === undefined &&
    diff.sectionsRemoved === undefined
  );
}
