/**
* 自动化套件 2/5 — search-term-service 单元测试。
* In-memory fake Prisma; chatJson mocked; real parse + negative-text logic.
*/
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { beforeEach, describe, expect, it, vi} from "vitest";
import { AppError } from "@adlinklab/shared";
import {
analyzeAndSave,
applySuggestion,
buildNegativeKeywordText,
dismissSuggestion,
listSuggestions,
parseSearchTermRows,
} from "./search-term-service.js";
import { encryptSecret} from "../ai/crypto.js";
import type { ChatJsonArgs} from "../ai/llm.js";

process.env.AI_SETTINGS_PEPPER = "test-pepper-for-search-term-service";

const TENANT = "00000000-0000-4000-8000-000000000001";

type Row = Record<string, any>;

function mkFakePrisma() {
const suggestions: Row[] = [];
const syncJobs: Row[] = [];
const auditLogs: Row[] = [];
const settings = [
{ key: "llm.baseUrl", value: "https://api.deepseek.com"},
{ key: "llm.model", value: "deepseek-chat"},
{
key: "llm.apiKeyEnc",
value: encryptSecret("sk-test", "test-pepper-for-search-term-service"),
},
];
const prisma: any = {
aiSetting: { findMany: async () => settings},
searchTermSuggestion: {
create: async ({ data}: any) => {
const row = {
...data,
reason: data.reason?? null,
campaignName: data.campaignName?? null,
matchType: data.matchType?? null,
createdAt: new Date(),
};
suggestions.push(row);
return row;
},
findFirst: async ({ where}: any) =>
suggestions.find(
(r) =>
r.id === where.id &&
(where.tenantId === undefined || r.tenantId === where.tenantId)
)?? null,
findMany: async ({ where, skip = 0, take}: any) => {
let out = suggestions.filter((r) => {
if (where?.tenantId && r.tenantId!== where.tenantId) return false;
if (where?.status && r.status!== where.status) return false;
return true;
});
out = out.slice(skip, take === undefined? undefined: skip + take);
return out.map((r) => ({...r}));
},
update: async ({ where, data}: any) => {
const row = suggestions.find((r) => r.id === where.id);
if (!row) throw new Error("not found");
Object.assign(row, data);
return {...row};
},
count: async ({ where}: any) =>
suggestions.filter((r) => {
if (where?.tenantId && r.tenantId!== where.tenantId) return false;
if (where?.status && r.status!== where.status) return false;
return true;
}).length,
},
syncJob: {
findFirst: async ({ where}: any) =>
syncJobs.find((r) => {
if (where.tenantId && r.tenantId!== where.tenantId) return false;
if (where.type && r.type!== where.type) return false;
if (where.idempotencyScope && r.idempotencyScope!== where.idempotencyScope)
return false;
if (where.idempotencyKey && r.idempotencyKey!== where.idempotencyKey)
return false;
if (where.status?.in &&!where.status.in.includes(r.status)) return false;
return true;
})?? null,
create: async ({ data}: any) => {
syncJobs.push({...data});
return data;
},
},
auditLog: {
create: async ({ data}: any) => {
auditLogs.push({...data});
return data;
},
},
};
return { prisma, suggestions, syncJobs, auditLogs};
}

const ANALYSIS_PAYLOAD = {
items: [
{
searchTerm: "warehouse jobs",
suggestedAction: "ADD_NEGATIVE_EXACT",
reason:
"命中规则：词含 'warehouse jobs'，offer 为电商返利，求职流量无购买转化可能，故精确否词。",
},
{
searchTerm: "cheap shoes free download",
suggestedAction: "ADD_NEGATIVE_PHRASE",
reason:
"命中规则：词中 'free download' 子串意图为免费获取，与付费电商 offer 无关，词组否词拦截同类变体。",
},
{
searchTerm: "best running shoes",
suggestedAction: "IGNORE",
reason:
"命中规则：'best' + 品类词为典型比价意图，与运动鞋 offer 高度相关，应保留。",
},
],
};

function chatJsonImplFor(payload: unknown) {
return vi.fn(async (_args: ChatJsonArgs) => payload);
}

describe("parseSearchTermRows", () => {
it("parses plain one-per-line text, dedupes case-insensitively", () => {
const rows = parseSearchTermRows(" Free Shoes \n\nfree shoes\nNike\n");
expect(rows.map((r) => r.term)).toEqual(["Free Shoes", "Nike"]);
});

it("parses CSV with a search-term header and match-type column", () => {
const csv =
"Search Term,Clicks,Match Type\nwarehouse jobs,12,Exact\nbest shoes,3,Phrase\n";
const rows = parseSearchTermRows(csv);
expect(rows).toEqual([
{ term: "warehouse jobs", matchType: "Exact"},
{ term: "best shoes", matchType: "Phrase"},
]);
});

it("falls back to the first column when no header matches (first row kept as data)", () => {
const csv = "a,b\nfoo,1\nbar,2\n";
const rows = parseSearchTermRows(csv);
expect(rows.map((r) => r.term)).toEqual(["a", "foo", "bar"]);
});

it("parses tab-separated lines", () => {
const rows = parseSearchTermRows("warehouse jobs\t12\nbest shoes\t3\n");
expect(rows.map((r) => r.term)).toEqual(["warehouse jobs", "best shoes"]);
});

it("respects quoted commas inside CSV cells", () => {
const rows = parseSearchTermRows('"Search Term"\n"shoes, cheap"\n');
expect(rows.map((r) => r.term)).toEqual(["shoes, cheap"]);
});

it("returns [] for blank input", () => {
expect(parseSearchTermRows(" \n ")).toEqual([]);
});
});

describe("buildNegativeKeywordText", () => {
it("wraps exact in [] and phrase in quotes", () => {
expect(
buildNegativeKeywordText({
searchTerm: "warehouse jobs",
suggestedAction: "ADD_NEGATIVE_EXACT",
})
).toBe("[warehouse jobs]");
expect(
buildNegativeKeywordText({
searchTerm: "free download",
suggestedAction: "ADD_NEGATIVE_PHRASE",
})
).toBe('"free download"');
expect(
buildNegativeKeywordText({
searchTerm: "best shoes",
suggestedAction: "IGNORE",
})
).toBeNull();
});
});

describe("analyzeAndSave", () => {
let fx: ReturnType<typeof mkFakePrisma>;
beforeEach(() => {
fx = mkFakePrisma();
});

it("saves PENDING suggestions from a pasted report", async () => {
const res = await analyzeAndSave(
fx.prisma,
TENANT,
"warehouse jobs\ncheap shoes free download\nbest running shoes\n",
{ campaignName: "US-Shoes", chatJsonImpl: chatJsonImplFor(ANALYSIS_PAYLOAD)}
);
expect(res.analyzed).toBe(3);
expect(fx.suggestions).toHaveLength(3);
expect(fx.suggestions[0]).toMatchObject({
tenantId: TENANT,
searchTerm: "warehouse jobs",
campaignName: "US-Shoes",
suggestedAction: "ADD_NEGATIVE_EXACT",
status: "PENDING",
});
expect(fx.suggestions[0].reason.length).toBeGreaterThan(10);
});

it("rejects empty input", async () => {
await expect(
analyzeAndSave(fx.prisma, TENANT, " \n ", {
chatJsonImpl: chatJsonImplFor(ANALYSIS_PAYLOAD),
})
).rejects.toThrow(/No search terms/);
});

it("rejects when AI is not configured", async () => {
fx.prisma.aiSetting.findMany = async () => [];
const err = await analyzeAndSave(fx.prisma, TENANT, "warehouse jobs", {
chatJsonImpl: chatJsonImplFor(ANALYSIS_PAYLOAD),
}).catch((e) => e);
expect(err).toBeInstanceOf(AppError);
expect((err as AppError).code).toBe("AI_NOT_CONFIGURED");
});
});

describe("applySuggestion / dismissSuggestion / listSuggestions", () => {
let fx: ReturnType<typeof mkFakePrisma>;
beforeEach(async () => {
fx = mkFakePrisma();
await analyzeAndSave(fx.prisma, TENANT, "warehouse jobs\nbest running shoes\n", {
chatJsonImpl: chatJsonImplFor(ANALYSIS_PAYLOAD),
});
});

it("applies an exact-negative suggestion, queues a PENDING SyncJob, returns [term]", async () => {
const id = fx.suggestions[0].id;
const res = await applySuggestion(fx.prisma, TENANT, id, {
requestedBy: "user-1",
});
expect(res.suggestion.status).toBe("APPLIED");
expect(res.negativeText).toBe("[warehouse jobs]");
expect(res.taskId).toBeTruthy();
expect(res.deduped).toBe(false);
const job = fx.syncJobs.find((j) => j.id === res.taskId);
expect(job).toMatchObject({
tenantId: TENANT,
type: "SEARCH_TERM_NEGATIVE_PUSH",
status: "PENDING",
});
expect(fx.auditLogs).toHaveLength(1);
expect(fx.auditLogs[0].action).toBe("SEARCH_TERM_NEGATIVE_QUEUED");
});

it("apply is idempotent — second call dedupes, no duplicate task", async () => {
const id = fx.suggestions[0].id;
const first = await applySuggestion(fx.prisma, TENANT, id);
const second = await applySuggestion(fx.prisma, TENANT, id);
expect(second.deduped).toBe(true);
expect(second.taskId).toBe(first.taskId);
expect(fx.syncJobs).toHaveLength(1);
});

it("applying an IGNORE suggestion flips status without queueing a task", async () => {
const id = fx.suggestions.find(
(s) => s.suggestedAction === "IGNORE"
)!.id;
const res = await applySuggestion(fx.prisma, TENANT, id);
expect(res.suggestion.status).toBe("APPLIED");
expect(res.negativeText).toBeNull();
expect(res.taskId).toBeNull();
expect(fx.syncJobs).toHaveLength(0);
});

it("apply enforces tenant isolation", async () => {
const id = fx.suggestions[0].id;
await expect(
applySuggestion(fx.prisma, "00000000-0000-4000-8000-000000000002", id)
).rejects.toThrow(/SearchTermSuggestion/);
});

it("dismiss flips status to DISMISSED", async () => {
const id = fx.suggestions[1].id;
const out = await dismissSuggestion(fx.prisma, TENANT, id);
expect(out.status).toBe("DISMISSED");
});

it("lists with status filter + pagination", async () => {
await dismissSuggestion(fx.prisma, TENANT, fx.suggestions[1].id);
const pending = await listSuggestions(fx.prisma, TENANT, {
status: "PENDING",
});
expect(pending.total).toBe(1);
const page2 = await listSuggestions(fx.prisma, TENANT, {
page: 2,
pageSize: 1,
});
expect(page2.total).toBe(2);
expect(page2.items).toHaveLength(1);
expect(page2.page).toBe(2);
});
});
