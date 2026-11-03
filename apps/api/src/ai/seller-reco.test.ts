/**
 * 卖家工具 AI 推荐：证据口径回归测试（全部 stub，不联网、不花钱）。
 * - SERP organic 结果被解析、非 organic / 非 http 链接被丢弃；
 * - 引用 SERP 之外 URL 的候选被丢弃；0 条有效候选时抛错；
 * - SERP 0 条可用结果时返回空候选 + 警告，不调用模型；
 * - 403 + verify 文案 → DataForSeoUnverifiedError。
 */
import { describe, expect, it, vi } from "vitest";
import {
  DataForSeoUnverifiedError,
  recommendSellerProducts,
} from "./seller-reco.js";

function serpResponse(items: unknown[], statusCode = 20000) {
  return {
    ok: true,
    json: async () => ({
      tasks: [{ status_code: statusCode, result: [{ items }] }],
    }),
  };
}

function makeFetch(responses: Array<{ ok: boolean; json: () => Promise<unknown>; status?: number }>) {
  let i = 0;
  const fetchImpl = vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r as unknown as Response;
  });
  return { fetchImpl, calls: () => i };
}

const ORGANIC = [
  {
    type: "organic",
    title: "Best pet grooming brushes 2026",
    url: "https://example.com/best-pet-brushes",
    description: "Slicker brushes lead the list, from $15.99.",
  },
  {
    type: "paid",
    title: "Ad",
    url: "https://ads.example.com/x",
    description: "ignored",
  },
  { type: "organic", title: "No http", url: "ftp://example.com/x" },
];

describe("seller-reco", () => {
  it("解析 organic 来源，丢弃引用站外 URL 的候选", async () => {
    const { fetchImpl } = makeFetch([serpResponse(ORGANIC) as never]);
    const chatJsonImpl = vi.fn(async () => ({
      candidates: [
        {
          name: "宠物除毛梳",
          category: "宠物用品",
          why: "榜单首位提及除毛梳。",
          priceHint: 15.99,
          sources: ["https://example.com/best-pet-brushes"],
        },
        {
          name: "编造商品",
          category: "宠物用品",
          why: "模型编的。",
          priceHint: null,
          sources: ["https://made-up.example.com/fake"],
        },
      ],
    }));
    const result = await recommendSellerProducts(
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        chatJsonImpl,
        dataforseoCreds: { login: "l", password: "p" },
        llm: { baseUrl: "https://x", model: "m", apiKey: "k" },
      },
      { direction: "宠物用品", limit: 5 }
    );
    expect(result.sources).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe("宠物除毛梳");
    expect(result.candidates[0].priceHint).toBe(15.99);
    // 3 次方向查询 + 1 次货源查询（1 条候选）。
    expect(result.serpCalls).toBe(4);
    expect(result.serpCostEstimateUsd).toBeCloseTo(0.008);
    // 货源 stub 与方向 stub 相同：只有 1 条非批发 organic 链接。
    expect(result.candidates[0].sourcing).toEqual([
      {
        title: "Best pet grooming brushes 2026",
        url: "https://example.com/best-pet-brushes",
        kind: "other",
      },
    ]);
  });

  it("货源排序：批发平台在前、去重、截断到 3 条", async () => {
    const sourcingItems = [
      { type: "organic", title: "Amazon listing", url: "https://www.amazon.com/dp/EXAMPLE", description: "" },
      { type: "organic", title: "Alibaba supplier", url: "https://www.alibaba.com/product-detail/x.html", description: "" },
      { type: "organic", title: "Alibaba dup", url: "https://www.alibaba.com/product-detail/x.html", description: "" },
      { type: "organic", title: "Blog", url: "https://example.com/blog", description: "" },
      { type: "organic", title: "Faire brand", url: "https://www.faire.com/product/y", description: "" },
      { type: "organic", title: "DHgate", url: "https://www.dhgate.com/product/z.html", description: "" },
    ];
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return serpResponse(n <= 3 ? ORGANIC : sourcingItems) as never;
    });
    const chatJsonImpl = vi.fn(async () => ({
      candidates: [
        {
          name: "宠物除毛梳",
          category: "宠物用品",
          why: "榜单首位提及除毛梳。",
          priceHint: 15.99,
          sources: ["https://example.com/best-pet-brushes"],
        },
      ],
    }));
    const result = await recommendSellerProducts(
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        chatJsonImpl,
        dataforseoCreds: { login: "l", password: "p" },
        llm: { baseUrl: "https://x", model: "m", apiKey: "k" },
      },
      { direction: "宠物用品", limit: 5 }
    );
    expect(result.serpCalls).toBe(4);
    expect(result.candidates[0].sourcing.map((l) => l.url)).toEqual([
      "https://www.alibaba.com/product-detail/x.html",
      "https://www.faire.com/product/y",
      "https://www.dhgate.com/product/z.html",
    ]);
    expect(result.candidates[0].sourcing.every((l) => l.kind === "wholesale")).toBe(true);
  });

  it("货源搜索失败不影响候选，只记警告", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n <= 3) return serpResponse(ORGANIC) as never;
      throw new Error("网络异常");
    });
    const chatJsonImpl = vi.fn(async () => ({
      candidates: [
        {
          name: "宠物除毛梳",
          category: "宠物用品",
          why: "榜单首位提及除毛梳。",
          priceHint: 15.99,
          sources: ["https://example.com/best-pet-brushes"],
        },
      ],
    }));
    const result = await recommendSellerProducts(
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        chatJsonImpl,
        dataforseoCreds: { login: "l", password: "p" },
        llm: { baseUrl: "https://x", model: "m", apiKey: "k" },
      },
      { direction: "宠物用品", limit: 5 }
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourcing).toEqual([]);
    expect(result.serpCalls).toBe(3);
    expect(result.warnings.join("")).toContain("货源搜索失败");
  });

  it("SERP 无可用结果时返回空候选且不调用模型", async () => {
    const { fetchImpl } = makeFetch([serpResponse([]) as never]);
    const chatJsonImpl = vi.fn(async () => ({ candidates: [] }));
    const result = await recommendSellerProducts(
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        chatJsonImpl,
        dataforseoCreds: { login: "l", password: "p" },
        llm: { baseUrl: "https://x", model: "m", apiKey: "k" },
      },
      { direction: "宠物用品", limit: 5 }
    );
    expect(result.candidates).toEqual([]);
    expect(chatJsonImpl).not.toHaveBeenCalled();
    expect(result.warnings.join("")).toContain("未用模型知识编造");
  });

  it("DataForSEO 403 verify → DataForSeoUnverifiedError", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        tasks: [{ status_message: "Please verify your account before using the API" }],
      }),
    }));
    await expect(
      recommendSellerProducts(
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          chatJsonImpl: vi.fn(async () => ({})),
          dataforseoCreds: { login: "l", password: "p" },
          llm: { baseUrl: "https://x", model: "m", apiKey: "k" },
        },
        { direction: "宠物用品", limit: 5 }
      )
    ).rejects.toBeInstanceOf(DataForSeoUnverifiedError);
  });

  it("模型只返回无效候选时抛错，不静默给空清单", async () => {
    const { fetchImpl } = makeFetch([serpResponse(ORGANIC) as never]);
    const chatJsonImpl = vi.fn(async () => ({
      candidates: [
        {
          name: "编造商品",
          category: "宠物用品",
          why: "无来源。",
          priceHint: null,
          sources: ["https://made-up.example.com/fake"],
        },
      ],
    }));
    await expect(
      recommendSellerProducts(
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
          chatJsonImpl,
          dataforseoCreds: { login: "l", password: "p" },
          llm: { baseUrl: "https://x", model: "m", apiKey: "k" },
        },
        { direction: "宠物用品", limit: 5 }
      )
    ).rejects.toThrow("带有效来源");
  });
});
