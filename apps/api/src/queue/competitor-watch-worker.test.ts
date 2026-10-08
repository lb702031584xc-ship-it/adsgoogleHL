/**
 * Lander Intel ② — competitor-watch worker tests.
 * In-memory fake Prisma; fetch is injected (no network).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import type { FetchedHtmlPage } from "../ai/fetch-page.js";
import {
  extractCompetitorFields,
  hashCompetitorSnapshot,
} from "../ai/competitor-extract.js";
import {
  checkCompetitorWatch,
  isFetchAllowedByRobots,
  isRobotsPathAllowed,
  parseRobotsDisallows,
  processCompetitorWatchJob,
} from "./competitor-watch-worker.js";

type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const rv = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      return Object.entries(v).every(([op, ov]) => {
        const a = rv instanceof Date ? rv.getTime() : rv;
        const b = (ov as any) instanceof Date ? (ov as any).getTime() : ov;
        switch (op) {
          case "gt":
            return a > b;
          case "gte":
            return a >= b;
          case "lt":
            return a < b;
          case "lte":
            return a <= b;
          default:
            return true;
        }
      });
    }
    if (v === null) return rv === null || rv === undefined;
    return rv === v;
  });
}

function sortBy(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0] as [string, string];
  const out = [...rows];
  out.sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    return dir === "desc" ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function mkStore(rows: Row[]) {
  return {
    findFirst: async ({ where, orderBy }: any) =>
      sortBy(rows.filter((r) => matchesWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy }: any) =>
      sortBy(rows.filter((r) => matchesWhere(r, where)), orderBy).map((r) => ({
        ...r,
      })),
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    count: async ({ where }: any) =>
      rows.filter((r) => matchesWhere(r, where)).length,
  };
}

function makeFakePrisma() {
  return {
    competitorWatch: mkStore([]),
    competitorChange: mkStore([]),
    alert: mkStore([]),
  } as unknown as PrismaClient;
}

/** Fake fetch: serves robots.txt per domain and page HTML per URL. */
function makeFakeFetch(opts: {
  htmlByUrl?: (url: string) => string;
  robotsByDomain?: (domain: string) => string | null;
  failUrls?: string[];
}): (url: string) => Promise<FetchedHtmlPage> {
  return async (url: string) => {
    if (opts.failUrls?.some((f) => url.startsWith(f))) {
      throw new Error("network error");
    }
    const u = new URL(url);
    if (u.pathname === "/robots.txt") {
      const text = opts.robotsByDomain?.(u.hostname) ?? null;
      if (text == null) throw new Error("robots fetch failed (status 404)");
      return {
        finalUrl: url,
        html: text,
        text,
        statusCode: 200,
        redirectChain: [],
        fetchMs: 5,
      };
    }
    const html =
      opts.htmlByUrl?.(url) ??
      "<html><head><title>X</title></head><body></body></html>";
    return {
      finalUrl: url,
      html,
      text: "t",
      statusCode: 200,
      redirectChain: [],
      fetchMs: 5,
    };
  };
}

const HTML_V1 = `<html><head><title>Shoes Sale</title></head><body>
<h1>Buy shoes</h1><p>Price $99.99</p><button>Buy Now</button></body></html>`;
const HTML_V2 = `<html><head><title>Shoes Sale - New</title></head><body>
<h1>Buy shoes</h1><h2>New arrivals</h2><p>Price $79.99</p><button>Buy Now</button></body></html>`;
const HTML_V3 = `<html><head><title>Shoes Sale - Clearance</title></head><body>
<h1>Buy shoes</h1><h2>New arrivals</h2><p>Price $69.99</p><button>Buy Now</button></body></html>`;

const hashOf = (html: string) =>
  hashCompetitorSnapshot(extractCompetitorFields(html));

const silentLog = {
  info: () => undefined,
  error: () => undefined,
};

async function seedWatch(
  prisma: PrismaClient,
  overrides: Partial<Row> = {}
): Promise<Row> {
  return (prisma as any).competitorWatch.create({
    data: {
      id: randomUUID(),
      tenantId: "tenant-a",
      name: "Competitor A",
      url: "https://competitor.example/landing",
      checkInterval: 3600,
      lastHash: null,
      lastCheckedAt: null,
      isActive: true,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

describe("robots.txt parsing", () => {
  it("parses Disallow lines for User-agent: * and prefix-matches paths", () => {
    const text = [
      "# comment line",
      "User-agent: *",
      "Disallow: /private",
      "Disallow: /tmp/",
      "",
      "User-agent: Googlebot",
      "Disallow: /nogoogle",
    ].join("\n");
    expect(parseRobotsDisallows(text)).toEqual(["/private", "/tmp/"]);
    expect(isRobotsPathAllowed(text, "/private/page")).toBe(false);
    expect(isRobotsPathAllowed(text, "/tmp/x")).toBe(false);
    expect(isRobotsPathAllowed(text, "/public")).toBe(true);
    expect(isRobotsPathAllowed(text, "/nogoogle")).toBe(true);
  });

  it("treats empty Disallow as allow-all and is case-insensitive", () => {
    const text = "USER-AGENT: *\nDISALLOW:\n";
    expect(parseRobotsDisallows(text)).toEqual([]);
    expect(isRobotsPathAllowed(text, "/anything")).toBe(true);
  });

  it("a new User-agent group after rules resets the group", () => {
    const text = [
      "User-agent: *",
      "Disallow: /a",
      "User-agent: BadBot",
      "Disallow: /b",
    ].join("\n");
    expect(parseRobotsDisallows(text)).toEqual(["/a"]);
  });
});

describe("isFetchAllowedByRobots", () => {
  it("allows when robots.txt is missing (fetch fails)", async () => {
    const fetch = makeFakeFetch({ robotsByDomain: () => null });
    await expect(
      isFetchAllowedByRobots("https://example.com/page", fetch as any)
    ).resolves.toBe(true);
  });

  it("denies paths covered by Disallow", async () => {
    const fetch = makeFakeFetch({
      robotsByDomain: () => "User-agent: *\nDisallow: /blocked",
    });
    await expect(
      isFetchAllowedByRobots("https://example.com/blocked/x", fetch as any)
    ).resolves.toBe(false);
    await expect(
      isFetchAllowedByRobots("https://example.com/open", fetch as any)
    ).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkCompetitorWatch
// ---------------------------------------------------------------------------

describe("checkCompetitorWatch", () => {
  let prisma: PrismaClient;
  beforeEach(() => {
    prisma = makeFakePrisma();
  });

  it("establishes a baseline on the first check (no change, no alert)", async () => {
    const watch = await seedWatch(prisma);
    const fetch = makeFakeFetch({ htmlByUrl: () => HTML_V1 });
    const result = await checkCompetitorWatch(
      prisma,
      watch as any,
      { fetchPageHtmlImpl: fetch as any, log: silentLog }
    );
    expect(result.changed).toBe(false);
    expect(result.baseline).toBe(true);
    const updated = await (prisma as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(updated.lastHash).toBe(hashOf(HTML_V1));
    expect(updated.lastCheckedAt).toBeInstanceOf(Date);
    expect(
      await (prisma as any).competitorChange.count({})
    ).toBe(0);
    expect(await (prisma as any).alert.count({})).toBe(0);
  });

  it("hash change → writes CompetitorChange + Alert and refreshes the hash", async () => {
    const watch = await seedWatch(prisma, {
      lastHash: hashOf(HTML_V1),
      lastCheckedAt: new Date(Date.now() - 2 * 3600 * 1000),
    });
    const fetch = makeFakeFetch({ htmlByUrl: () => HTML_V2 });
    const result = await checkCompetitorWatch(
      prisma,
      watch as any,
      { fetchPageHtmlImpl: fetch as any, log: silentLog }
    );
    expect(result.changed).toBe(true);
    expect(result.changeId).toBeTruthy();
    expect(result.alertCreated).toBe(true);
    // First detected change: before is null (no baseline snapshot stored).
    expect(result.diff?.title).toEqual({
      before: null,
      after: "Shoes Sale - New",
    });
    expect(result.diff?.price).toEqual({
      before: null,
      after: ["$79.99"],
    });

    const changes = await (prisma as any).competitorChange.findMany({});
    expect(changes).toHaveLength(1);
    expect(changes[0].watchId).toBe(watch.id);
    expect(changes[0].tenantId).toBe("tenant-a");
    expect(changes[0].diffSummary.title.after).toBe("Shoes Sale - New");

    const alerts = await (prisma as any).alert.findMany({});
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric).toBe("competitor_change");
    expect(alerts[0].ruleId).toBeNull();
    expect(alerts[0].severity).toBe("medium");
    expect(alerts[0].status).toBe("open");
    expect(alerts[0].message).toContain("Competitor A");
    expect(alerts[0].data).toEqual({
      watchId: watch.id,
      changeId: changes[0].id,
    });

    const updated = await (prisma as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(updated.lastHash).toBe(hashOf(HTML_V2));
  });

  it("chains before/after across consecutive changes", async () => {
    const watch = await seedWatch(prisma);
    let current = HTML_V1;
    const fetch = makeFakeFetch({ htmlByUrl: () => current });
    const run = () =>
      checkCompetitorWatch(prisma, watch as any, {
        fetchPageHtmlImpl: fetch as any,
        log: silentLog,
      }).then(async (r) => {
        // Re-read the watch so lastHash is fresh for the next scan.
        const fresh = await (prisma as any).competitorWatch.findFirst({
          where: { id: watch.id },
        });
        Object.assign(watch, fresh);
        return r;
      });

    await run(); // baseline
    current = HTML_V2;
    const r2 = await run(); // change 1: before=null
    expect(r2.changed).toBe(true);
    expect(r2.diff?.title?.before).toBeNull();

    current = HTML_V3;
    const r3 = await run(); // change 2: before = change 1's after
    expect(r3.changed).toBe(true);
    expect(r3.diff?.title).toEqual({
      before: "Shoes Sale - New",
      after: "Shoes Sale - Clearance",
    });
    expect(r3.diff?.price).toEqual({
      before: ["$79.99"],
      after: ["$69.99"],
    });
  });

  it("dedupes alerts within 24h per watch (changes still recorded)", async () => {
    const watch = await seedWatch(prisma);
    let current = HTML_V1;
    const fetch = makeFakeFetch({ htmlByUrl: () => current });
    const run = () =>
      checkCompetitorWatch(prisma, watch as any, {
        fetchPageHtmlImpl: fetch as any,
        log: silentLog,
      }).then(async (r) => {
        const fresh = await (prisma as any).competitorWatch.findFirst({
          where: { id: watch.id },
        });
        Object.assign(watch, fresh);
        return r;
      });

    await run();
    current = HTML_V2;
    const r2 = await run();
    expect(r2.alertCreated).toBe(true);
    current = HTML_V3;
    const r3 = await run();
    expect(r3.changed).toBe(true);
    expect(r3.alertCreated).toBe(false);
    expect(await (prisma as any).competitorChange.count({})).toBe(2);
    expect(await (prisma as any).alert.count({})).toBe(1);
  });

  it("no change → only touches lastCheckedAt", async () => {
    const before = new Date(Date.now() - 2 * 3600 * 1000);
    const watch = await seedWatch(prisma, {
      lastHash: hashOf(HTML_V1),
      lastCheckedAt: before,
    });
    const fetch = makeFakeFetch({ htmlByUrl: () => HTML_V1 });
    const result = await checkCompetitorWatch(
      prisma,
      watch as any,
      { fetchPageHtmlImpl: fetch as any, log: silentLog }
    );
    expect(result.changed).toBe(false);
    expect(await (prisma as any).competitorChange.count({})).toBe(0);
    expect(await (prisma as any).alert.count({})).toBe(0);
    const updated = await (prisma as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(updated.lastCheckedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(updated.lastHash).toBe(hashOf(HTML_V1));
  });

  it("fetch failure → does not throw, touches lastCheckedAt, no change row", async () => {
    const watch = await seedWatch(prisma, {
      lastHash: hashOf(HTML_V1),
      lastCheckedAt: new Date(Date.now() - 2 * 3600 * 1000),
    });
    const fetch = makeFakeFetch({
      htmlByUrl: () => HTML_V2,
      failUrls: ["https://competitor.example/landing"],
    });
    const result = await checkCompetitorWatch(
      prisma,
      watch as any,
      { fetchPageHtmlImpl: fetch as any, log: silentLog }
    );
    expect(result.fetchFailed).toBe(true);
    expect(result.changed).toBe(false);
    expect(await (prisma as any).competitorChange.count({})).toBe(0);
    const updated = await (prisma as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(updated.lastCheckedAt).toBeInstanceOf(Date);
    // Hash untouched on failure.
    expect(updated.lastHash).toBe(hashOf(HTML_V1));
  });

  it("robots.txt disallow → skipped, no change row, lastCheckedAt touched", async () => {
    const watch = await seedWatch(prisma, {
      url: "https://competitor.example/blocked/page",
      lastHash: hashOf(HTML_V1),
      lastCheckedAt: new Date(Date.now() - 2 * 3600 * 1000),
    });
    const fetch = makeFakeFetch({
      htmlByUrl: () => HTML_V2,
      robotsByDomain: () => "User-agent: *\nDisallow: /blocked",
    });
    const result = await checkCompetitorWatch(
      prisma,
      watch as any,
      { fetchPageHtmlImpl: fetch as any, log: silentLog }
    );
    expect(result.skippedByRobots).toBe(true);
    expect(result.changed).toBe(false);
    expect(await (prisma as any).competitorChange.count({})).toBe(0);
    const updated = await (prisma as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(updated.lastCheckedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// processCompetitorWatchJob
// ---------------------------------------------------------------------------

describe("processCompetitorWatchJob", () => {
  let prisma: PrismaClient;
  beforeEach(() => {
    prisma = makeFakePrisma();
  });

  it("scans only due, active, non-deleted watches", async () => {
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    const recent = new Date(Date.now() - 10 * 60 * 1000);
    const due1 = await seedWatch(prisma, { lastCheckedAt: null });
    const due2 = await seedWatch(prisma, {
      name: "due2",
      url: "https://other.example/x",
      lastCheckedAt: old,
    });
    const notDue = await seedWatch(prisma, {
      name: "notDue",
      url: "https://other.example/y",
      lastCheckedAt: recent,
    });
    const inactive = await seedWatch(prisma, {
      name: "inactive",
      url: "https://other.example/z",
      isActive: false,
    });
    const deleted = await seedWatch(prisma, {
      name: "deleted",
      url: "https://other.example/w",
      deletedAt: new Date(),
    });

    const fetch = makeFakeFetch({ htmlByUrl: () => HTML_V1 });
    const summary = await processCompetitorWatchJob({
      prisma,
      triggeredBy: "schedule",
      fetchPageHtmlImpl: fetch as any,
      log: silentLog,
    });
    expect(summary.checked).toBe(2);

    for (const w of [due1, due2]) {
      const row = await (prisma as any).competitorWatch.findFirst({
        where: { id: w.id },
      });
      expect(row.lastHash).toBe(hashOf(HTML_V1));
    }
    for (const w of [notDue, inactive, deleted]) {
      const row = await (prisma as any).competitorWatch.findFirst({
        where: { id: w.id },
      });
      expect(row.lastHash).toBeNull();
    }
  });

  it("respects the tenant filter", async () => {
    await seedWatch(prisma, { tenantId: "tenant-a" });
    await seedWatch(prisma, {
      tenantId: "tenant-b",
      url: "https://other.example/x",
    });
    const fetch = makeFakeFetch({ htmlByUrl: () => HTML_V1 });
    const summary = await processCompetitorWatchJob({
      prisma,
      triggeredBy: "manual",
      tenantId: "tenant-b",
      fetchPageHtmlImpl: fetch as any,
      log: silentLog,
    });
    expect(summary.checked).toBe(1);
  });

  it("clamps checkInterval below 1h in code (never scans more often)", async () => {
    const watch = await seedWatch(prisma, {
      checkInterval: 60, // stale/legacy value — worker clamps to 3600
      lastCheckedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const fetch = makeFakeFetch({ htmlByUrl: () => HTML_V1 });
    const summary = await processCompetitorWatchJob({
      prisma,
      triggeredBy: "schedule",
      fetchPageHtmlImpl: fetch as any,
      log: silentLog,
    });
    expect(summary.checked).toBe(0);
    const row = await (prisma as any).competitorWatch.findFirst({
      where: { id: watch.id },
    });
    expect(row.lastHash).toBeNull();
  });

  it("never throws when a single watch scan fails", async () => {
    await seedWatch(prisma, { lastCheckedAt: null });
    const fetch = makeFakeFetch({
      htmlByUrl: () => {
        throw new Error("boom");
      },
    });
    // robots fetch also throws → allowed → page fetch throws → handled.
    const summary = await processCompetitorWatchJob({
      prisma,
      triggeredBy: "schedule",
      fetchPageHtmlImpl: fetch as any,
      log: silentLog,
    });
    expect(summary.checked).toBe(1);
    expect(summary.fetchFailed).toBe(1);
  });
});
