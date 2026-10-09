/**
 * SimilarWeb / DataForSEO provider 单测：无 key → null；有 key 时解析响应；
 * 失败 → null 不抛错。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@adlinklab/database";
import { encryptSecret, TEST_AI_SETTINGS_PEPPER } from "../ai/crypto.js";
import { SimilarWebProvider } from "./similarweb.js";
import { DataForSeoProvider } from "./dataforseo.js";

function makeFakePrisma(rows: Record<string, string> = {}) {
  return {
    aiSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { key: string } }) => {
          const value = rows[where.key];
          return value === undefined ? null : { key: where.key, value };
        }
      ),
    },
  } as unknown as PrismaClient;
}

function enc(plain: string): string {
  return encryptSecret(plain, TEST_AI_SETTINGS_PEPPER);
}

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SimilarWebProvider", () => {
  it("无 key → null，且不发起请求", async () => {
    const prisma = makeFakePrisma();
    const f = vi.fn();
    const p = new SimilarWebProvider(prisma, f as unknown as typeof fetch);
    await expect(p.getMonthlyVisits("anker.com")).resolves.toBe(null);
    expect(f).not.toHaveBeenCalled();
  });

  it("有 key 时解析最近一月 visits", async () => {
    const prisma = makeFakePrisma({ "traffic.similarwebKey": enc("sw-key") });
    const calls: string[] = [];
    const f = (async (url: unknown) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          visits: [
            { date: "2026-08-01", visits: 111 },
            { date: "2026-09-01", visits: 123456 },
          ],
        }),
      };
    }) as unknown as typeof fetch;
    const p = new SimilarWebProvider(prisma, f);
    await expect(p.getMonthlyVisits("anker.com")).resolves.toBe(123456);
    expect(calls[0]).toContain("api.similarweb.com/v1/website/anker.com/");
    expect(calls[0]).toContain("country=us");
    expect(calls[0]).toContain("granularity=monthly");
  });

  it("API 失败 → null", async () => {
    const prisma = makeFakePrisma({ "traffic.similarwebKey": enc("sw-key") });
    const p = new SimilarWebProvider(prisma, jsonFetch({}, false));
    await expect(p.getMonthlyVisits("anker.com")).resolves.toBe(null);
  });

  it("getKeywordVolume 恒为 null（口径由 DataForSEO 负责）", async () => {
    const p = new SimilarWebProvider(makeFakePrisma());
    await expect(p.getKeywordVolume(["a"])).resolves.toEqual([
      { keyword: "a", volume: null },
    ]);
  });
});

describe("DataForSeoProvider", () => {
  it("缺任一凭证 → 全 null，不发起请求", async () => {
    const prisma = makeFakePrisma({
      "traffic.dataforseoLogin": enc("login-only"),
    });
    const f = vi.fn();
    const p = new DataForSeoProvider(prisma, f as unknown as typeof fetch);
    await expect(p.getKeywordVolume(["a", "b"])).resolves.toEqual([
      { keyword: "a", volume: null },
      { keyword: "b", volume: null },
    ]);
    expect(f).not.toHaveBeenCalled();
  });

  it("有凭证时用 Basic auth 调 historical_search_volume 并解析", async () => {
    const prisma = makeFakePrisma({
      "traffic.dataforseoLogin": enc("login1"),
      "traffic.dataforseoPassword": enc("pass1"),
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tasks: [
            {
              result: [
                {
                  items: [
                    {
                      keyword: "wireless earbuds",
                      keyword_info: { search_volume: 90500 },
                    },
                    {
                      keyword: "bluetooth headphones",
                      keyword_info: { search_volume: null },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;
    const p = new DataForSeoProvider(prisma, f);
    const res = await p.getKeywordVolume([
      "wireless earbuds",
      "bluetooth headphones",
    ]);
    expect(res).toEqual([
      { keyword: "wireless earbuds", volume: 90500 },
      { keyword: "bluetooth headphones", volume: null },
    ]);
    expect(calls[0].url).toContain("historical_search_volume/live");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("login1:pass1").toString("base64")
    );
  });

  it("API 失败 → 全 null", async () => {
    const prisma = makeFakePrisma({
      "traffic.dataforseoLogin": enc("l"),
      "traffic.dataforseoPassword": enc("p"),
    });
    const p = new DataForSeoProvider(prisma, jsonFetch({}, false));
    await expect(p.getKeywordVolume(["a"])).resolves.toEqual([
      { keyword: "a", volume: null },
    ]);
  });

  it("getMonthlyVisits 恒为 null（口径由 SimilarWeb 负责）", async () => {
    const p = new DataForSeoProvider(makeFakePrisma());
    await expect(p.getMonthlyVisits("anker.com")).resolves.toBe(null);
  });
});
