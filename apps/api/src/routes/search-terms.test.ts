/**
* 自动化套件 2/5 — search-terms route contract tests.
* In-memory fake Prisma; session auth stubbed via onRequest hook;
* chatJson mocked (no real LLM).
*/
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { beforeEach, describe, expect, it, vi} from "vitest";
import Fastify from "fastify";
import type { PrismaClient} from "@adlinklab/database";
import { createAuthContext} from "../auth/tenant.js";
import { encryptSecret} from "../ai/crypto.js";
import type { ChatJsonArgs} from "../ai/llm.js";
import { registerSearchTermRoutes} from "./search-terms.js";

process.env.AI_SETTINGS_PEPPER = "test-pepper-for-search-term-routes";

const TENANT = "00000000-0000-4000-8000-000000000001";
const SESSION = {
id: "11111111-1111-4111-8111-111111111111",
tenantId: TENANT,
userId: "22222222-2222-4222-8222-222222222222",
email: "test@example.com",
role: "admin",
};

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
value: encryptSecret("sk-test", "test-pepper-for-search-term-routes"),
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
findMany: async ({ where, orderBy, skip = 0, take}: any) => {
let out = suggestions.filter((r) => {
if (where?.tenantId && r.tenantId!== where.tenantId) return false;
if (where?.status && r.status!== where.status) return false;
return true;
});
if (orderBy?.createdAt === "desc") out = [...out].reverse();
out = out.slice(skip, take === undefined? undefined: skip + take);
return out.map((r) => ({...r}));
},
update: async ({ where, data}: any) => {
const row = suggestions.find((r) => r.id === where.id);
if (!row) throw new Error("not found");
Object.assign(row, data);
return {...row};
},
count: async () => suggestions.length,
},
syncJob: {
findFirst: async ({ where}: any) =>
syncJobs.find((r) => {
if (where.tenantId && r.tenantId!== where.tenantId) return false;
if (where.type && r.type!== where.type) return false;
if (
where.idempotencyScope &&
r.idempotencyScope!== where.idempotencyScope
)
return false;
if (where.idempotencyKey && r.idempotencyKey!== where.idempotencyKey)
return false;
if (where.status?.in &&!where.status.in.includes(r.status))
return false;
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
return { prisma, suggestions, syncJobs};
}

const ANALYSIS_PAYLOAD = {
items: [
{
searchTerm: "warehouse jobs",
suggestedAction: "ADD_NEGATIVE_EXACT",
reason:
"命中规则：词含 'warehouse jobs'，offer 为电商返利，求职流量无购买转化可能，故精确否词。",
},
],
};

async function buildApp() {
const fx = mkFakePrisma();
const app = Fastify();
app.addHook("onRequest", async (request: any) => {
request.sessionAuth = SESSION;
});
const chatJsonImpl = vi.fn(async (_args: ChatJsonArgs) => ANALYSIS_PAYLOAD);
await registerSearchTermRoutes(
app,
{ prisma: fx.prisma as unknown as PrismaClient, chatJsonImpl: chatJsonImpl as any},
createAuthContext({ AUTH_MODE: "disabled"} as any)
);
return { app, fx, chatJsonImpl};
}

describe("search-terms routes", () => {
let app: any;
let fx: ReturnType<typeof mkFakePrisma>;
beforeEach(async () => {
const built = await buildApp();
app = built.app;
fx = built.fx;
});

it("POST /analyze validates empty text", async () => {
const res = await app.inject({
method: "POST",
url: "/api/v1/search-terms/analyze",
payload: { text: " "},
});
expect(res.statusCode).toBe(400);
});

it("POST /analyze rejects oversized text", async () => {
const res = await app.inject({
method: "POST",
url: "/api/v1/search-terms/analyze",
payload: { text: "x".repeat(20_001)},
});
expect(res.statusCode).toBe(400);
});

it("POST /analyze → GET list → POST apply → POST dismiss (happy path)", async () => {
const analyzed = await app.inject({
method: "POST",
url: "/api/v1/search-terms/analyze",
payload: { text: "warehouse jobs\n", campaignName: "US-Shoes"},
});
expect(analyzed.statusCode).toBe(200);
const body = analyzed.json();
expect(body.ok).toBe(true);
expect(body.analyzed).toBe(1);
const id = body.suggestions[0].id;
expect(body.suggestions[0].status).toBe("PENDING");

const listed = await app.inject({
method: "GET",
url: "/api/v1/search-terms?status=PENDING",
});
expect(listed.statusCode).toBe(200);
expect(listed.json().total).toBe(1);

const applied = await app.inject({
method: "POST",
url: `/api/v1/search-terms/${id}/apply`,
});
expect(applied.statusCode).toBe(200);
const appliedBody = applied.json();
expect(appliedBody.suggestion.status).toBe("APPLIED");
expect(appliedBody.negativeText).toBe("[warehouse jobs]");
expect(appliedBody.taskId).toBeTruthy();
expect(fx.syncJobs[0].status).toBe("PENDING");

const dismissed = await app.inject({
method: "POST",
url: `/api/v1/search-terms/${id}/dismiss`,
});
expect(dismissed.statusCode).toBe(200);
expect(dismissed.json().suggestion.status).toBe("DISMISSED");
});

it("POST /apply rejects non-UUID ids", async () => {
const res = await app.inject({
method: "POST",
url: "/api/v1/search-terms/not-a-uuid/apply",
});
expect(res.statusCode).toBe(400);
});

it("POST /apply 404s on unknown id", async () => {
const res = await app.inject({
method: "POST",
url: "/api/v1/search-terms/00000000-0000-4000-8000-000000000099/apply",
});
expect(res.statusCode).toBe(404);
});

it("GET /list rejects invalid status", async () => {
const res = await app.inject({
method: "GET",
url: "/api/v1/search-terms?status=BOGUS",
});
expect(res.statusCode).toBe(400);
});

it("requires session auth", async () => {
const noAuthApp = Fastify();
await registerSearchTermRoutes(
noAuthApp,
{ prisma: fx.prisma as unknown as PrismaClient},
createAuthContext({ AUTH_MODE: "disabled"} as any)
);
const res = await noAuthApp.inject({
method: "GET",
url: "/api/v1/search-terms",
});
expect(res.statusCode).toBeGreaterThanOrEqual(400);
});
});
