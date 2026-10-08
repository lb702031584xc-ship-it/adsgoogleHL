/**
 * Phase 4 Research Lab — multi-variant page fetcher for cloaking research.
 *
 * RESEARCH ONLY — this fetcher is never used in production traffic routing.
 * It exists solely to let researchers compare how a target URL responds to
 * different request variants (user-agent / accept-language / geo flavour).
 *
 * SSRF protection is REUSED from apps/api/src/ai/fetch-page.ts (the module
 * where compliance.ts's SSRF guards live): every resolved address (v4/v6,
 * all dns.lookup results, IPv4-mapped IPv6) is checked with isBlockedIp,
 * redirects are followed manually with re-validation per hop, requests are
 * capped at FETCH_TIMEOUT_MS with an MAX_BODY_BYTES body cap, and only
 * http(s) URLs without credentials are allowed.
 *
 * A variant that fails to fetch records its error in `meta.error` and never
 * throws — a failed variant is data, not an exception.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  FETCH_TIMEOUT_MS,
  MAX_BODY_BYTES,
  isBlockedIp,
  stripHtml,
} from "../ai/fetch-page.js";

/** One request flavour used to probe the target URL. */
export interface RequestVariant {
  /** Stable label, e.g. "desktop-us". Unique within a test. */
  name: string;
  userAgent: string;
  acceptLanguage: string;
  /** Extra headers merged over the defaults (never Host/Cookie). */
  headers?: Record<string, string>;
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Default probe set: desktop/mobile × US/DE. */
export const DEFAULT_VARIANTS: readonly RequestVariant[] = [
  {
    name: "desktop-us",
    userAgent: DESKTOP_UA,
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    name: "mobile-us",
    userAgent: MOBILE_UA,
    acceptLanguage: "en-US,en;q=0.9",
  },
  {
    name: "desktop-de",
    userAgent: DESKTOP_UA,
    acceptLanguage: "de-DE,de;q=0.9",
  },
];

const MAX_REDIRECTS = 5;
const TEXT_EXCERPT_CHARS = 500;

/** Curated response headers persisted per variant (volatile ones excluded). */
const CAPTURED_HEADERS = [
  "content-type",
  "content-length",
  "content-encoding",
  "server",
  "x-powered-by",
  "cache-control",
] as const;

export interface RedirectHop {
  url: string;
  status: number;
}

export interface VariantFetchResult {
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
  /** { error?: string, setCookieCount?: number, ... } */
  meta: Record<string, unknown>;
  fetchedAt: Date;
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** SSRF guard (reused logic shape from ai/fetch-page.ts): every resolved
 * address must be public. Throws on unresolvable or blocked hosts. */
async function assertPublicHostname(rawHostname: string): Promise<void> {
  const hostname = stripBrackets(rawHostname);
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new Error("URL target is not allowed (SSRF guard)");
    }
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) throw new Error("Empty response body");
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Page too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function countTag(html: string, tag: string): number {
  const re = new RegExp(`<${tag}[\\s>]`, "gi");
  let n = 0;
  let m: RegExpExecArray | null;
  // Guard against pathological inputs: stop counting past 100k matches.
  while ((m = re.exec(html)) !== null && n < 100_000) {
    n += 1;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return n;
}

function failureResult(
  variantName: string,
  error: unknown
): VariantFetchResult {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  return {
    variantName,
    httpStatus: null,
    finalUrl: null,
    redirectChain: [],
    headers: {},
    htmlHash: null,
    contentHash: null,
    textExcerpt: null,
    linksCount: null,
    scriptsCount: null,
    meta: { error: message.slice(0, 500) },
    fetchedAt: new Date(),
  };
}

/**
 * Fetch one variant. Never throws: every failure is recorded in
 * `meta.error` with the remaining fields null/empty.
 */
export async function fetchVariant(
  rawUrl: string,
  variant: RequestVariant
): Promise<VariantFetchResult> {
  const done = (r: VariantFetchResult): VariantFetchResult => r;
  try {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("Invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http(s) URLs are allowed");
    }
    if (parsed.username || parsed.password) {
      throw new Error("URLs with credentials are not allowed");
    }

    const headers: Record<string, string> = {
      "User-Agent": variant.userAgent,
      "Accept-Language": variant.acceptLanguage,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    for (const [k, v] of Object.entries(variant.headers ?? {})) {
      const lk = k.toLowerCase();
      if (lk === "host" || lk === "cookie" || lk === "content-length") continue;
      headers[k] = v;
    }

    const redirectChain: RedirectHop[] = [];
    let current = parsed.toString();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(current);
      await assertPublicHostname(u.hostname);

      let res: Response;
      try {
        res = await fetch(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers,
        });
      } catch (err) {
        throw new Error(
          `Page fetch failed: ${err instanceof Error ? err.message : "network error"}`
        );
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) throw new Error("Redirect without location");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new Error("Invalid redirect target");
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new Error("Only http(s) URLs are allowed");
        }
        redirectChain.push({ url: current, status: res.status });
        current = next.toString();
        continue;
      }

      const buf = await readCapped(res);
      const html = buf.toString("utf8");
      const text = stripHtml(html);
      const captured: Record<string, string> = {};
      for (const name of CAPTURED_HEADERS) {
        const v = res.headers.get(name);
        if (v !== null) captured[name] = v.slice(0, 300);
      }
      const setCookies = res.headers.getSetCookie?.() ?? [];
      const meta: Record<string, unknown> = {};
      if (setCookies.length > 0) meta.setCookieCount = setCookies.length;

      return done({
        variantName: variant.name,
        httpStatus: res.status,
        finalUrl: current,
        redirectChain,
        headers: captured,
        htmlHash: sha256Hex(buf),
        contentHash: sha256Hex(text),
        textExcerpt: text.slice(0, TEXT_EXCERPT_CHARS) || null,
        linksCount: countTag(html, "a"),
        scriptsCount: countTag(html, "script"),
        meta,
        fetchedAt: new Date(),
      });
    }
    throw new Error("Too many redirects");
  } catch (err) {
    return done(failureResult(variant.name, err));
  }
}

/**
 * Fetch all variants sequentially (polite: one request at a time).
 * Never throws — per-variant failures are recorded in the results.
 */
export async function fetchAllVariants(
  rawUrl: string,
  variants: readonly RequestVariant[]
): Promise<VariantFetchResult[]> {
  const out: VariantFetchResult[] = [];
  for (const v of variants) {
    out.push(await fetchVariant(rawUrl, v));
  }
  return out;
}
