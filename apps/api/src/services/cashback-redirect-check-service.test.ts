/**
 * Feature 4 — 跳转链检测（redirect-check）service tests.
 * In-memory fake Prisma; fetch and DNS are injected (no network).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fakes need loose rows */
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  checkAllRedirectChains,
  checkRedirectChain,
  followRedirectChain,
  getRedirectCheckHistory,
  REDIRECT_CHECK_ALERT_METRIC,
  type FollowRedirectChainOpts,
  type RedirectChainResult,
} from "./cashback-redirect-check-service.js";

type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    const rv = row[k];
    if (
      v !== null &&
      typeof v === "object" &&
      !(v instanceof Date) &&
      !Array.isArray(v)
    ) {
      return Object.entries(v).every(([op, ov]) => {
        if (op === "in") return (ov as any[]).includes(rv);
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

function makeDelegate(initial: Row[] = []) {
  const rows = initial;
  return {
    _rows: rows,
    create: async (args: any) => {
      // Mimic the DB default: createdAt defaults to now when not provided.
      const row = { createdAt: new Date(), ...args.data };
      rows.push(row);
      return row;
    },
    count: async (args: any) =>
      rows.filter((r) => matchesWhere(r, args.where)).length,
    findMany: async (args: any) => {
      const filtered = sortBy(
        rows.filter((r) => matchesWhere(r, args.where)),
        args.orderBy
      );
      return filtered.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? 100));
    },
  };
}

const TENANT = "00000000-0000-4000-8000-000000000001";

function makeLink(overrides: Partial<Row> = {}): Row {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    publicId: "link-1",
    status: "ACTIVE",
    deletedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    offer: { name: "offer-a", destinationUrl: "https://merchant.example/a" },
    landingPage: null,
    ...overrides,
  };
}

function makePrisma(links: Row[] = []) {
  const redirectChainCheck = makeDelegate();
  const alerts = makeDelegate();
  const linkDelegate = makeDelegate(links);
  const trackingLink = {
    findMany: async (args: any) => {
      let rows = linkDelegate._rows.filter((r) =>
        matchesWhere(r, args.where)
      );
      rows = sortBy(rows, args.orderBy);
      // Fake the nested select: rows already carry offer/landingPage objects.
      return rows;
    },
  };
  return {
    redirectChainCheck,
    alert: alerts,
    trackingLink,
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Mock fetch chains
// ---------------------------------------------------------------------------

type ChainStep =
  | { status: number; location?: string }
  | { fail: "timeout" | "network" };

function mockFetch(chain: Record<string, ChainStep>) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const step = chain[url];
    if (!step) {
      return new Response(null, { status: 404 });
    }
    if ("fail" in step) {
      if (step.fail === "timeout") {
        // Simulate a hanging request: only rejects when the abort signal fires.
        await new Promise<never>((_, reject) => {
          const signal = init.signal as AbortSignal | null | undefined;
          if (signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        });
      }
      throw new Error("socket hang up");
    }
    const headers =
      step.location != null ? { location: step.location } : undefined;
    return new Response(null, { status: step.status, headers });
  };
}

/** DNS stub: every hostname resolves to a public IP (SSRF passes). */
const publicResolveHost = async (_hostname: string) => ["93.184.216.34"];

function followOpts(
  chain: Record<string, ChainStep>,
  extra: Partial<FollowRedirectChainOpts> = {}
): FollowRedirectChainOpts {
  return {
    fetchImpl: mockFetch(chain),
    resolveHost: publicResolveHost,
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe("followRedirectChain", () => {
  it("正常链：两跳重定向后 200，无 issue", async () => {
    const chain = {
      "https://go.example/1": { status: 301, location: "https://go.example/2" },
      "https://go.example/2": {
        status: 302,
        location: "https://merchant.example/a",
      },
      "https://merchant.example/a": { status: 200 },
    };
    const r = await followRedirectChain(
      "https://go.example/1",
      followOpts(chain)
    );
    expect(r.hops).toHaveLength(3);
    expect(r.hops.map((h) => h.statusCode)).toEqual([301, 302, 200]);
    expect(r.hops.map((h) => h.domain)).toEqual([
      "go.example",
      "go.example",
      "merchant.example",
    ]);
    expect(r.issues).toEqual([]);
    expect(r.finalUrl).toBe("https://merchant.example/a");
  });

  it("超长链：7 跳被标记 too_many_hops", async () => {
    const chain: Record<string, ChainStep> = {};
    for (let i = 1; i <= 7; i++) {
      chain[`https://go.example/${i}`] =
        i < 7
          ? { status: 302, location: `https://go.example/${i + 1}` }
          : { status: 200 };
    }
    const r = await followRedirectChain(
      "https://go.example/1",
      followOpts(chain)
    );
    expect(r.hops).toHaveLength(7);
    expect(r.issues).toContain("too_many_hops");
  });

  it("循环链：A→B→A 被标记 redirect_loop", async () => {
    const chain = {
      "https://go.example/a": { status: 302, location: "https://go.example/b" },
      "https://go.example/b": { status: 302, location: "https://go.example/a" },
    };
    const r = await followRedirectChain(
      "https://go.example/a",
      followOpts(chain)
    );
    expect(r.issues).toContain("redirect_loop");
    expect(r.finalUrl).toBeNull();
  });

  it("中途 500 被标记 hop_failed，并记录状态码", async () => {
    const chain = {
      "https://go.example/1": { status: 301, location: "https://go.example/2" },
      "https://go.example/2": { status: 500 },
    };
    const r = await followRedirectChain(
      "https://go.example/1",
      followOpts(chain)
    );
    expect(r.issues).toContain("hop_failed");
    expect(r.hops[1]?.statusCode).toBe(500);
    expect(r.finalUrl).toBeNull();
  });

  it("SSRF 拦截：解析到内网 IP 时标记 target_blocked 且不发请求", async () => {
    let fetchCalls = 0;
    const r = await followRedirectChain("https://go.example/1", {
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
      resolveHost: async () => ["169.254.169.254"],
    });
    expect(r.issues).toContain("target_blocked");
    expect(fetchCalls).toBe(0);
  });

  it("相对 Location 被正确解析", async () => {
    const chain = {
      "https://go.example/start": { status: 301, location: "/next" },
      "https://go.example/next": { status: 200 },
    };
    const r = await followRedirectChain(
      "https://go.example/start",
      followOpts(chain)
    );
    expect(r.hops).toHaveLength(2);
    expect(r.finalUrl).toBe("https://go.example/next");
  });
});

describe("checkRedirectChain", () => {
  it("终链域名一致 → status ok", async () => {
    const chain = {
      "https://go.example/1": {
        status: 302,
        location: "https://merchant.example/a",
      },
      "https://merchant.example/a": { status: 200 },
    };
    const r = await checkRedirectChain("https://go.example/1", {
      ...followOpts(chain),
      expectedDomain: "merchant.example",
    });
    expect(r.issues).toEqual([]);
    expect(r.status).toBe("ok");
  });

  it("终链域名不一致 → final_domain_mismatch + warning", async () => {
    const chain = {
      "https://go.example/1": {
        status: 302,
        location: "https://evil.example/x",
      },
      "https://evil.example/x": { status: 200 },
    };
    const r = await checkRedirectChain("https://go.example/1", {
      ...followOpts(chain),
      expectedDomain: "merchant.example",
    });
    expect(r.issues).toContain("final_domain_mismatch");
    expect(r.status).toBe("warning");
  });

  it("首跳超时 → status error + hop_failed", async () => {
    const chain = { "https://go.example/1": { fail: "timeout" as const } };
    const r = await checkRedirectChain("https://go.example/1", {
      ...followOpts(chain, { timeoutMs: 50 }),
      expectedDomain: "go.example",
    });
    expect(r.issues).toContain("hop_failed");
    expect(r.status).toBe("error");
    expect(r.hops[0]?.statusCode).toBeNull();
  });
});

describe("checkAllRedirectChains", () => {
  it("为每条 ACTIVE 链接写入检查行；有 issue 的写入 warning 告警", async () => {
    const link = makeLink();
    const prisma = makePrisma([link]);
    const chain = {
      "https://merchant.example/a": {
        status: 302,
        location: "https://phish.example/x",
      },
      "https://phish.example/x": { status: 200 },
    };
    const summary = await checkAllRedirectChains(prisma, TENANT, {
      ...followOpts(chain),
    });

    expect(summary.checked).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.clean).toBe(0);

    const rows = (prisma as any).redirectChainCheck._rows as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0].trackingLinkId).toBe(link.id);
    expect(rows[0].hopCount).toBe(2);
    expect(rows[0].issues).toContain("final_domain_mismatch");
    expect(rows[0].status).toBe("warning");

    const alerts = (prisma as any).alert._rows as Row[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric).toBe(REDIRECT_CHECK_ALERT_METRIC);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].trackingLinkId).toBe(link.id);
  });

  it("无 issue 的链接不写告警", async () => {
    const link = makeLink();
    const prisma = makePrisma([link]);
    const summary = await checkAllRedirectChains(prisma, TENANT, {
      ...followOpts({ "https://merchant.example/a": { status: 200 } }),
    });
    expect(summary.clean).toBe(1);
    expect((prisma as any).alert._rows).toHaveLength(0);
  });

  it("24h 内重复检查不重复告警", async () => {
    const link = makeLink();
    const prisma = makePrisma([link]);
    const chain = {
      "https://merchant.example/a": {
        status: 302,
        location: "https://phish.example/x",
      },
      "https://phish.example/x": { status: 200 },
    };
    const chainResult: RedirectChainResult = {
      hops: [
        {
          url: "https://merchant.example/a",
          domain: "merchant.example",
          statusCode: 302,
        },
        { url: "https://phish.example/x", domain: "phish.example", statusCode: 200 },
      ],
      issues: ["final_domain_mismatch"],
      status: "warning",
      finalUrl: "https://phish.example/x",
    };
    const opts = {
      checkImpl: async () => chainResult,
    };
    const first = await checkAllRedirectChains(prisma, TENANT, opts);
    const second = await checkAllRedirectChains(prisma, TENANT, opts);
    expect(first.alertsCreated).toBe(1);
    expect(second.alertsCreated).toBe(0);
    expect((prisma as any).alert._rows).toHaveLength(1);
    // 检查行照写（每跑一次一条）
    expect((prisma as any).redirectChainCheck._rows).toHaveLength(2);
  });

  it("没有目标 URL 的链接被跳过", async () => {
    const link = makeLink({ offer: null, landingPage: null });
    const prisma = makePrisma([link]);
    const summary = await checkAllRedirectChains(prisma, TENANT);
    expect(summary.checked).toBe(0);
    expect(summary.skippedNoUrl).toBe(1);
  });

  it("单个链接失败不会中断整轮扫描", async () => {
    const good = makeLink({ publicId: "good" });
    const bad = makeLink({
      publicId: "bad",
      offer: { name: "bad", destinationUrl: "http://[::1]/x" },
    });
    const prisma = makePrisma([good, bad]);
    const summary = await checkAllRedirectChains(prisma, TENANT, {
      checkImpl: async (url) => {
        if (url.includes("::1")) throw new Error("boom");
        return checkRedirectChain(url, {
          ...followOpts({ "https://merchant.example/a": { status: 200 } }),
          expectedDomain: "merchant.example",
        });
      },
    });
    expect(summary.checked).toBe(1);
    expect(summary.clean).toBe(1);
  });
});

describe("getRedirectCheckHistory", () => {
  it("分页 + trackingLinkId 过滤 + 链接名水合", async () => {
    const linkA = makeLink({ publicId: "link-a" });
    const linkB = makeLink({ publicId: "link-b" });
    const prisma = makePrisma([linkA, linkB]) as any;
    const delegate = prisma.redirectChainCheck;
    await delegate.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        trackingLinkId: linkA.id,
        hopCount: 2,
        hops: [],
        issues: ["too_many_hops"],
        checkedAt: new Date("2026-10-07T10:00:00Z"),
        status: "warning",
      },
    });
    await delegate.create({
      data: {
        id: randomUUID(),
        tenantId: TENANT,
        trackingLinkId: linkB.id,
        hopCount: 1,
        hops: [],
        issues: [],
        checkedAt: new Date("2026-10-07T11:00:00Z"),
        status: "ok",
      },
    });

    const all = await getRedirectCheckHistory(prisma, TENANT, {});
    expect(all.total).toBe(2);
    // 最新在前
    expect(all.rows[0]?.trackingLinkId).toBe(linkB.id);
    expect(all.rows[0]?.linkPublicId).toBe("link-b");

    const filtered = await getRedirectCheckHistory(prisma, TENANT, {
      trackingLinkId: linkA.id,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0]?.issues).toEqual(["too_many_hops"]);
  });
});

describe("fake sanity", () => {
  beforeEach(() => {
    // 保证测试文件结构正确；无网络断言在此。
  });
  it("redirect chain check metric constant", () => {
    expect(REDIRECT_CHECK_ALERT_METRIC).toBe("redirect_chain_issue");
  });
});
