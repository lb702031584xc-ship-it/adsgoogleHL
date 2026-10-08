/**
 * Agent 5 (researchAnalyst) unit tests — Phase 4 cloaking-research findings.
 * In-memory fake Prisma (no live DB): covers finding present / absent /
 * store error / missing context.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import {
  researchAnalyst,
  runWithResearchContext,
  type ResearchAnalystResult,
} from "./pipeline.js";

interface FakeFinding {
  id: string;
  differentialScore: number | null;
  band: string | null;
  classification: string | null;
  aiSummary: string | null;
}

function fakePrisma(opts: {
  finding?: FakeFinding | null;
  throwOnFind?: boolean;
  capture?: { where?: unknown };
}) {
  return {
    cloakingFinding: {
      findFirst: async (args: {
        where: { tenantId: string; offerId: string };
        orderBy: { createdAt: "desc" };
        select: Record<string, boolean>;
      }) => {
        if (opts.capture) opts.capture.where = args.where;
        if (opts.throwOnFind) throw new Error("db down");
        return opts.finding ?? null;
      },
    },
  } as unknown as PrismaClient;
}

const TENANT = "tenant-1";
const OFFER = "offer-1";

async function run(
  prisma: PrismaClient,
  offerId = OFFER
): Promise<ResearchAnalystResult> {
  return runWithResearchContext(prisma, TENANT, () => researchAnalyst(offerId));
}

describe("researchAnalyst (Agent 5)", () => {
  it("1. returns OK with the latest finding mapped to the contract", async () => {
    const capture: { where?: unknown } = {};
    const prisma = fakePrisma({
      capture,
      finding: {
        id: "finding-1",
        differentialScore: 72,
        band: "SUSPICIOUS",
        classification: "BOT_DIVERGENCE",
        aiSummary: "机器人与真人抓取内容差异显著。",
      },
    });
    const r = await run(prisma);
    expect(r.status).toBe("OK");
    expect(r.score).toBe(72);
    expect(r.band).toBe("SUSPICIOUS");
    expect(r.classification).toBe("BOT_DIVERGENCE");
    expect(r.summary).toBe("机器人与真人抓取内容差异显著。");
    expect(r.findingId).toBe("finding-1");
    // tenant-scoped lookup by offerId (findings are produced via ResearchTest)
    expect(capture.where).toEqual({
      tenantId: TENANT,
      offerId: OFFER,
    });
  });

  it("2. returns NO_DATA with 暂无研究数据 when no finding exists", async () => {
    const r = await run(fakePrisma({ finding: null }));
    expect(r).toEqual({
      status: "NO_DATA",
      score: null,
      band: null,
      classification: null,
      summary: "暂无研究数据",
    });
    expect(r.findingId).toBeUndefined();
  });

  it("3. returns NO_DATA (never throws) when the research store errors", async () => {
    const r = await run(fakePrisma({ throwOnFind: true }));
    expect(r.status).toBe("NO_DATA");
    expect(r.summary).toBe("暂无研究数据");
  });

  it("4. throws when called without a research context", async () => {
    await expect(researchAnalyst(OFFER)).rejects.toThrow(
      "researchAnalyst called without a research context"
    );
  });

  it("5. synthesizes a Chinese summary and normalizes band/score", async () => {
    const r = await run(
      fakePrisma({
        finding: {
          id: "finding-2",
          differentialScore: 150, // out of range -> clamped
          band: "high_risk", // case-insensitive
          classification: "  ",
          aiSummary: "   ",
        },
      })
    );
    expect(r.status).toBe("OK");
    expect(r.score).toBe(100);
    expect(r.band).toBe("HIGH_RISK");
    expect(r.classification).toBeNull();
    expect(r.summary).toContain("HIGH_RISK");
  });

  it("6. maps unknown band values to null instead of throwing", async () => {
    const r = await run(
      fakePrisma({
        finding: {
          id: "finding-3",
          differentialScore: 10,
          band: "WHATEVER",
          classification: null,
          aiSummary: "ok",
        },
      })
    );
    expect(r.status).toBe("OK");
    expect(r.band).toBeNull();
    expect(r.summary).toBe("ok");
  });
});
