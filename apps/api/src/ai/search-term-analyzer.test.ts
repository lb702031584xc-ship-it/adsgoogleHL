/**
* 自动化套件 2/5 — search-term-analyzer 单元测试（mock chatJsonValidated 的底层 chatJson）。
*/
import { describe, expect, it, vi} from "vitest";
import {
MAX_SEARCH_TERMS_PER_CALL,
analyzeSearchTerms,
buildSearchTermPrompt,
validateSearchTermShape,
} from "./search-term-analyzer.js";
import { AiError, type ChatJsonArgs} from "./llm.js";

const LLM_ARGS: ChatJsonArgs = {
baseUrl: "https://api.deepseek.com",
model: "deepseek-chat",
apiKey: "test-key",
system: "",
user: "",
};

function mockImpl(payload: unknown, calls: ChatJsonArgs[] = []) {
return vi.fn(async (args: ChatJsonArgs) => {
calls.push(args);
return payload;
});
}

const VALID_PAYLOAD = {
items: [
{
searchTerm: "warehouse jobs near me",
suggestedAction: "ADD_NEGATIVE_EXACT",
reason:
"命中规则：词含 'warehouse jobs'，offer 为电商返利，求职流量无购买转化可能，故精确否词。",
},
{
searchTerm: "best running shoes 2026",
suggestedAction: "IGNORE",
reason:
"命中规则：'best' + 年份 + 品类词是典型比价购买意图，与运动鞋 offer 高度相关，应保留。",
},
],
};

describe("buildSearchTermPrompt", () => {
it("embeds the no-empty-talk rule and every term", () => {
const { system, user} = buildSearchTermPrompt(["free iphone"], {
campaignName: "US-Shoes",
});
expect(system).toContain("STRICT JSON");
expect(system).toContain("禁止输出");
expect(system).toContain("该词不相关");
expect(user).toContain("1. free iphone");
expect(user).toContain("US-Shoes");
});
});

describe("validateSearchTermShape", () => {
it("accepts a valid payload", () => {
const items = validateSearchTermShape(VALID_PAYLOAD);
expect(items).toHaveLength(2);
expect(items[0].suggestedAction).toBe("ADD_NEGATIVE_EXACT");
});

it("rejects an unknown action", () => {
expect(() =>
validateSearchTermShape({
items: [{...VALID_PAYLOAD.items[0], suggestedAction: "DELETE"}],
})
).toThrow(AiError);
});

it("rejects empty-talk reasons", () => {
expect(() =>
validateSearchTermShape({
items: [{...VALID_PAYLOAD.items[0], reason: "该词不相关"}],
})
).toThrow(/reason/);
});

it("rejects an empty items array", () => {
expect(() => validateSearchTermShape({ items: []})).toThrow(AiError);
});
});

describe("analyzeSearchTerms", () => {
it("analyzes a batch and maps results back to input terms", async () => {
const calls: ChatJsonArgs[] = [];
const impl = mockImpl(VALID_PAYLOAD, calls);
const out = await analyzeSearchTerms(
["warehouse jobs near me", "best running shoes 2026"],
LLM_ARGS,
{ chatJsonImpl: impl, campaignName: "US-Shoes"}
);
expect(impl).toHaveBeenCalledTimes(1);
expect(out).toHaveLength(2);
expect(out[0]).toMatchObject({
searchTerm: "warehouse jobs near me",
suggestedAction: "ADD_NEGATIVE_EXACT",
});
expect(out[0].reason.length).toBeGreaterThan(10);
expect(calls[0].system).toContain("STRICT JSON");
});

it("chunks more than MAX_SEARCH_TERMS_PER_CALL terms", async () => {
const calls: ChatJsonArgs[] = [];
const terms = Array.from(
{ length: MAX_SEARCH_TERMS_PER_CALL + 5},
(_, i) => `term ${i}`
);
const impl = mockImpl({ items: []}, calls);
// Empty items payload is invalid → chatJsonValidated retries once, then
// throws. We only care about the chunking: first chunk call happened.
await expect(
analyzeSearchTerms(terms, LLM_ARGS, { chatJsonImpl: impl})
).rejects.toThrow(AiError);
// First chunk (50 terms) triggered the LLM call; retry doubles it.
expect(calls.length).toBeGreaterThanOrEqual(1);
expect(calls[0].user).toContain(`共 ${MAX_SEARCH_TERMS_PER_CALL} 个`);
});

it("keeps terms the model dropped (conservative IGNORE)", async () => {
const impl = mockImpl({
items: [VALID_PAYLOAD.items[0]], // only first term returned
});
const out = await analyzeSearchTerms(
["warehouse jobs near me", "best running shoes 2026"],
LLM_ARGS,
{ chatJsonImpl: impl}
);
expect(out).toHaveLength(2);
expect(out[1].suggestedAction).toBe("IGNORE");
expect(out[1].reason).toContain("默认保留");
});

it("propagates LLM failures", async () => {
const impl = vi.fn(async () => {
throw new AiError("boom");
});
await expect(
analyzeSearchTerms(["x"], LLM_ARGS, { chatJsonImpl: impl})
).rejects.toThrow("boom");
});
});
