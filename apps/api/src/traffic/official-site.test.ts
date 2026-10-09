/**
 * 官网检测单测：uddg 解码、平台过滤、品牌匹配 high/medium/low、首页验证降级。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../ai/fetch-page.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../ai/fetch-page.js")>();
  return { ...orig, fetchPageHtml: vi.fn() };
});

import { fetchPageHtml } from "../ai/fetch-page.js";
import {
  detectOfficialSite,
  extractDdgTargetDomain,
} from "./official-site.js";

const mockFetchPageHtml = vi.mocked(fetchPageHtml);

function ddgFetch(html: string, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    text: async () => html,
  })) as unknown as typeof fetch;
}

const link = (uddg: string, text: string): string =>
  `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${uddg}&amp;rut=abc">${text}</a>`;
const enc = (u: string): string => encodeURIComponent(u);

const ANKER_HTML = [
  link(enc("https://www.anker.com/"), "Anker Official Site"),
  link(enc("https://www.amazon.com/s?brand=anker"), "Anker on Amazon"),
  link(enc("https://www.facebook.com/anker"), "Anker Facebook"),
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractDdgTargetDomain", () => {
  it("解码 uddg 跳转（含 &amp; 转义）", () => {
    expect(
      extractDdgTargetDomain(
        `//duckduckgo.com/l/?uddg=${enc("https://www.anker.com/")}&amp;rut=abc`
      )
    ).toBe("anker.com");
  });

  it("处理双重编码的 uddg", () => {
    const double = encodeURIComponent(enc("https://example.com/"));
    expect(
      extractDdgTargetDomain(`//duckduckgo.com/l/?uddg=${double}&rut=abc`)
    ).toBe("example.com");
  });

  it("直链直接解析", () => {
    expect(extractDdgTargetDomain("https://blog.example.com/post")).toBe(
      "example.com"
    );
  });

  it("非法 href 返回 null", () => {
    expect(extractDdgTargetDomain("//duckduckgo.com/l/?rut=abc")).toBe(null);
    expect(extractDdgTargetDomain("not a url")).toBe(null);
    expect(extractDdgTargetDomain("")).toBe(null);
  });
});

describe("detectOfficialSite", () => {
  it("品牌匹配 high：过滤平台域名并经首页验证确认", async () => {
    mockFetchPageHtml.mockResolvedValue({
      finalUrl: "https://www.anker.com/",
      html: "<html></html>",
      text: "Anker Official Website - Charge Faster",
      statusCode: 200,
      redirectChain: [],
      fetchMs: 10,
    });
    const info = await detectOfficialSite("Anker", ddgFetch(ANKER_HTML));
    expect(info).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "high",
    });
    // amazon.com / facebook.com 应被过滤，首个候选即 anker.com
    expect(mockFetchPageHtml).toHaveBeenCalledWith("https://anker.com");
  });

  it("无品牌匹配时取首个非平台结果为 medium", async () => {
    mockFetchPageHtml.mockResolvedValue({
      finalUrl: "https://someblog.com/",
      html: "",
      text: "Anker review blog, anker mentioned here",
      statusCode: 200,
      redirectChain: [],
      fetchMs: 10,
    });
    const html = link(enc("https://someblog.com/anker-review"), "review");
    const info = await detectOfficialSite("Anker", ddgFetch(html));
    expect(info.found).toBe(true);
    expect(info.domain).toBe("someblog.com");
    expect(info.confidence).toBe("medium");
  });

  it("high 匹配但首页无品牌词 → 降级为 medium，found 仍 true", async () => {
    mockFetchPageHtml.mockResolvedValue({
      finalUrl: "https://www.anker.com/",
      html: "",
      text: "Welcome to our store", // JS 渲染站可能抓不到文本
      statusCode: 200,
      redirectChain: [],
      fetchMs: 10,
    });
    const info = await detectOfficialSite("Anker", ddgFetch(ANKER_HTML));
    expect(info).toEqual({
      found: true,
      domain: "anker.com",
      confidence: "medium",
    });
  });

  it("medium 匹配但首页无品牌词 → 保守判定 found=false", async () => {
    mockFetchPageHtml.mockResolvedValue({
      finalUrl: "https://someblog.com/",
      html: "",
      text: "unrelated content",
      statusCode: 200,
      redirectChain: [],
      fetchMs: 10,
    });
    const html = link(enc("https://someblog.com/anker-review"), "review");
    const info = await detectOfficialSite("Anker", ddgFetch(html));
    expect(info.found).toBe(false);
    expect(info.confidence).toBe("low");
    expect(info.domain).toBe("someblog.com"); // 保留候选供排查
  });

  it("结果全是平台/社媒域名 → low", async () => {
    const html = [
      link(enc("https://www.amazon.com/dp/xyz"), "Amazon"),
      link(enc("https://www.youtube.com/watch?v=1"), "YouTube"),
    ].join("\n");
    const info = await detectOfficialSite("Anker", ddgFetch(html));
    expect(info).toEqual({ found: false, domain: null, confidence: "low" });
    expect(mockFetchPageHtml).not.toHaveBeenCalled();
  });

  it("品牌为空 → low，不发起请求", async () => {
    const f = ddgFetch(ANKER_HTML);
    expect(await detectOfficialSite("", f)).toEqual({
      found: false,
      domain: null,
      confidence: "low",
    });
    expect(await detectOfficialSite("   ", f)).toEqual({
      found: false,
      domain: null,
      confidence: "low",
    });
  });

  it("搜索失败/异常 → low，绝不抛错", async () => {
    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(detectOfficialSite("Anker", throwing)).resolves.toEqual({
      found: false,
      domain: null,
      confidence: "low",
    });
    await expect(
      detectOfficialSite("Anker", ddgFetch("", false))
    ).resolves.toEqual({ found: false, domain: null, confidence: "low" });
    // 首页抓取抛错 → 降级路径同样不抛错
    mockFetchPageHtml.mockRejectedValue(new Error("dns fail"));
    const info = await detectOfficialSite("Anker", ddgFetch(ANKER_HTML));
    expect(info.found).toBe(true); // high 降级 medium
    expect(info.confidence).toBe("medium");
  });
});
