/**
 * Google Trends 热度单测：XSSI 前缀剥离、token 流程、averages/timelineData、
 * malformed JSON、429、Redis 缓存 24h。
 */
import { describe, expect, it, vi } from "vitest";
import { getKeywordInterest, type TrendsCache } from "./trends.js";

type MockRes = { ok: boolean; status: number; text: string };

function mockFetch(handler: (url: string) => MockRes): typeof fetch {
  return (async (url: unknown) => {
    const r = handler(String(url));
    return {
      ok: r.ok,
      status: r.status,
      text: async () => r.text,
    };
  }) as unknown as typeof fetch;
}

const EXPLORE_OK: MockRes = {
  ok: true,
  status: 200,
  text: `)]}',\n{"widgets":[{"id":"SEARCH","token":"s"},{"id":"TIMESERIES","token":"tok123"}]}`,
};
const WIDGET_AVERAGES: MockRes = {
  ok: true,
  status: 200,
  text: `)]}',\n{"default":{"averages":[42,58]}}`,
};
const WIDGET_TIMELINE: MockRes = {
  ok: true,
  status: 200,
  text: `{"default":{"timelineData":[{"time":"1","value":[10,20]},{"time":"2","value":[30,40]}]}}`,
};

function trendsFetch(second: MockRes, first: MockRes = EXPLORE_OK): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch = mockFetch((url) => {
    calls.push(url);
    if (url.includes("/trends/api/explore")) return first;
    if (url.includes("/trends/api/widgetdata/multiline")) return second;
    return { ok: false, status: 404, text: "" };
  });
  return { fetch, calls };
}

describe("getKeywordInterest", () => {
  it("剥离 )]}', 前缀并取 averages 平均（多词）", async () => {
    const { fetch, calls } = trendsFetch(WIDGET_AVERAGES);
    const v = await getKeywordInterest(["wireless earbuds", "bluetooth headphones"], "US", fetch);
    expect(v).toBe(50);
    expect(calls[0]).toContain("/trends/api/explore");
    expect(calls[1]).toContain("/trends/api/widgetdata/multiline");
    expect(calls[1]).toContain(encodeURIComponent("tok123"));
    // explore req 含 comparisonItem（today 12-m）
    expect(calls[0]).toContain(encodeURIComponent("today 12-m"));
  });

  it("无 averages 时退回 timelineData 按词取平均", async () => {
    const { fetch } = trendsFetch(WIDGET_TIMELINE);
    const v = await getKeywordInterest(["a", "b"], "US", fetch);
    // 词1: (10+30)/2=20；词2: (20+40)/2=30；平均 25
    expect(v).toBe(25);
  });

  it("429 → null", async () => {
    const { fetch } = trendsFetch(WIDGET_AVERAGES, {
      ok: false,
      status: 429,
      text: "Too Many Requests",
    });
    await expect(getKeywordInterest(["a"], "US", fetch)).resolves.toBe(null);
  });

  it("widgetdata 429 → null", async () => {
    const { fetch } = trendsFetch({ ok: false, status: 429, text: "" });
    await expect(getKeywordInterest(["a"], "US", fetch)).resolves.toBe(null);
  });

  it("malformed JSON → null（不抛错）", async () => {
    const { fetch } = trendsFetch({
      ok: true,
      status: 200,
      text: `)]}',\nnot-json{{{`,
    });
    await expect(getKeywordInterest(["a"], "US", fetch)).resolves.toBe(null);
  });

  it("无 TIMESERIES token → null", async () => {
    const { fetch } = trendsFetch(WIDGET_AVERAGES, {
      ok: true,
      status: 200,
      text: `)]}',\n{"widgets":[{"id":"SEARCH","token":"s"}]}`,
    });
    await expect(getKeywordInterest(["a"], "US", fetch)).resolves.toBe(null);
  });

  it("网络异常 → null（不抛错）", async () => {
    const throwing = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(getKeywordInterest(["a"], "US", throwing)).resolves.toBe(null);
  });

  it("空关键词 → null，不发起请求", async () => {
    const f = vi.fn();
    await expect(
      getKeywordInterest(["  ", ""], "US", f as unknown as typeof fetch)
    ).resolves.toBe(null);
    expect(f).not.toHaveBeenCalled();
  });

  it("Redis 命中时直接返回缓存，不请求网络", async () => {
    const { fetch } = trendsFetch(WIDGET_AVERAGES);
    const fetchSpy = vi.fn(fetch);
    const redis: TrendsCache = {
      get: vi.fn().mockResolvedValue("77"),
      setex: vi.fn(),
    };
    const v = await getKeywordInterest(["a"], "US", fetchSpy, redis);
    expect(v).toBe(77);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledWith("traffic:trends:US:a");
  });

  it("缓存未命中时写入 24h 缓存", async () => {
    const { fetch } = trendsFetch(WIDGET_AVERAGES);
    const redis: TrendsCache = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue("OK"),
    };
    const v = await getKeywordInterest(["a", "b"], "US", fetch, redis);
    expect(v).toBe(50);
    expect(redis.setex).toHaveBeenCalledWith(
      "traffic:trends:US:a,b",
      86400,
      "50"
    );
  });

  it("Redis 异常时跳过缓存，不抛错", async () => {
    const { fetch } = trendsFetch(WIDGET_AVERAGES);
    const redis: TrendsCache = {
      get: vi.fn().mockRejectedValue(new Error("redis down")),
      setex: vi.fn().mockRejectedValue(new Error("redis down")),
    };
    const v = await getKeywordInterest(["a", "b"], "US", fetch, redis);
    expect(v).toBe(50);
  });
});
