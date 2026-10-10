/**
 * Keepa 截图 AI 看图判断单测：
 * - prompt 构造（图 kind 标注、ASIN、单图提示）
 * - JSON 形状校验（合法通过、非法重试、两次非法抛错）
 * - vision 不支持错误识别
 */
import { describe, expect, it, vi } from "vitest";
import { AiError, type ChatJsonVisionArgs } from "../ai/llm.js";
import {
  isVisionUnsupportedError,
  judgeKeepaScreenshots,
  validateVisionShape,
} from "./vision.js";

const LLM = { baseUrl: "https://api.example.com/v1", model: "vision-model", apiKey: "k" };
const IMG = (kind: "price" | "rank"): { kind: "price" | "rank"; dataUrl: string } => ({
  kind,
  dataUrl: "data:image/png;base64,AAA",
});

describe("validateVisionShape", () => {
  it("合法形状直接通过", () => {
    const out = validateVisionShape({
      verdict: "kill",
      reasons: ["近30天跌幅约30%"],
      metrics: { priceDrop30dPct: 30, rankStable: false, confidence: "high" },
    });
    expect(out.verdict).toBe("kill");
    expect(out.metrics.confidence).toBe("high");
  });

  it("null 指标合法（信息不足不断言）", () => {
    const out = validateVisionShape({
      verdict: "unknown",
      reasons: ["图片模糊"],
      metrics: { priceDrop30dPct: null, rankStable: null, confidence: "low" },
    });
    expect(out.verdict).toBe("unknown");
  });

  it("非法 verdict 抛错", () => {
    expect(() =>
      validateVisionShape({
        verdict: "maybe",
        reasons: [],
        metrics: { priceDrop30dPct: null, rankStable: null, confidence: "low" },
      })
    ).toThrow();
  });

  it("reasons 非字符串数组抛错", () => {
    expect(() =>
      validateVisionShape({
        verdict: "pass",
        reasons: [42],
        metrics: { priceDrop30dPct: null, rankStable: true, confidence: "medium" },
      })
    ).toThrow();
  });

  it("confidence 非法抛错", () => {
    expect(() =>
      validateVisionShape({
        verdict: "pass",
        reasons: [],
        metrics: { priceDrop30dPct: null, rankStable: true, confidence: "sure" },
      })
    ).toThrow();
  });
});

describe("judgeKeepaScreenshots prompt 构造", () => {
  it("两张图按 kind 标注 + 带 ASIN", async () => {
    const impl = vi.fn(async (_args: ChatJsonVisionArgs) => ({
      verdict: "pass",
      reasons: ["价格平稳"],
      metrics: { priceDrop30dPct: 2, rankStable: true, confidence: "high" },
    }));
    const out = await judgeKeepaScreenshots([IMG("price"), IMG("rank")], LLM, {
      asin: "B012345678",
      impl: impl as (args: ChatJsonVisionArgs) => Promise<unknown>,
    });
    expect(out.verdict).toBe("pass");
    const args = impl.mock.calls[0][0] as ChatJsonVisionArgs;
    expect(args.user).toContain("B012345678");
    expect(args.user).toContain("图1：Keepa 价格历史截图");
    expect(args.user).toContain("图2：Keepa Sales Rank");
    expect(args.images).toHaveLength(2);
    expect(args.system).toContain("绝不硬判");
  });

  it("只有一张图时提示信息可能不足", async () => {
    const impl = vi.fn(async (_args: ChatJsonVisionArgs) => ({
      verdict: "unknown",
      reasons: ["只有价格图"],
      metrics: { priceDrop30dPct: null, rankStable: null, confidence: "low" },
    }));
    await judgeKeepaScreenshots([IMG("price")], LLM, {
      impl: impl as (args: ChatJsonVisionArgs) => Promise<unknown>,
    });
    const args = impl.mock.calls[0][0] as ChatJsonVisionArgs;
    expect(args.user).toContain("只有一张截图");
  });

  it("无图直接抛错（不调 LLM）", async () => {
    const impl = vi.fn();
    await expect(judgeKeepaScreenshots([], LLM, { impl: impl as never })).rejects.toThrow();
    expect(impl).not.toHaveBeenCalled();
  });

  it("形状非法时重试一次，第二次合法则返回", async () => {
    const impl = vi
      .fn()
      .mockResolvedValueOnce({ verdict: "nope" })
      .mockResolvedValueOnce({
        verdict: "pass",
        reasons: ["ok"],
        metrics: { priceDrop30dPct: 1, rankStable: true, confidence: "medium" },
      });
    const out = await judgeKeepaScreenshots([IMG("rank")], LLM, {
      impl: impl as unknown as (args: ChatJsonVisionArgs) => Promise<unknown>,
    });
    expect(out.verdict).toBe("pass");
    expect(impl).toHaveBeenCalledTimes(2);
  });
});

describe("isVisionUnsupportedError", () => {
  it("识别典型不支持文案", () => {
    expect(
      isVisionUnsupportedError(
        new AiError("LLM request failed (status 400): image input is not supported for this model")
      )
    ).toBe(true);
    expect(
      isVisionUnsupportedError(new AiError("LLM request failed (status 422): vision not available"))
    ).toBe(true);
    expect(
      isVisionUnsupportedError(
        new AiError("LLM request failed: Invalid content: image_url is not allowed")
      )
    ).toBe(true);
  });

  it("普通报错不误判", () => {
    expect(isVisionUnsupportedError(new AiError("LLM request failed: network error"))).toBe(false);
    expect(isVisionUnsupportedError(new AiError("LLM request failed (status 429)"))).toBe(false);
    expect(isVisionUnsupportedError(new Error("boom"))).toBe(false);
  });
});
