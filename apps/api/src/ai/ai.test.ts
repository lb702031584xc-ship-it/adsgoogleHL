/**
 * Phase 11 — AI offer analysis: crypto, SSRF-safe fetch, prompts,
 * profitability math, and route contracts.
 * Uses an in-memory fake Prisma (no live DB) + Fastify inject.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake needs loose rows */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  SESSION_COOKIE_NAME,
  createSession,
} from "../auth/sessions.js";
import { createObservabilityErrorHandler } from "../observability/index.js";
import {
  TEST_AI_SETTINGS_PEPPER,
  assertAiSettingsPepperConfigured,
  decryptSecret,
  encryptSecret,
  resolveAiSettingsPepper,
} from "./crypto.js";
import { AiError, chatJson, chatJsonValidated } from "./llm.js";
import type { ChatJsonArgs } from "./llm.js";
import { fetchPage, isBlockedIp, stripHtml } from "./fetch-page.js";
import {
  buildAnalysisPrompt,
  validateAnalysisShape,
} from "./prompts.js";
import { computeProfitability } from "./profitability.js";
import { registerAiRoutes } from "../routes/ai.js";

// ---------------------------------------------------------------------------
// Fake Prisma
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object") return false;
    return row[k] === v;
  });
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  const aiSettings: Row[] = [];
  const aiAnalyses: Row[] = [];

  const user = {
    findFirst: async ({ where }: any) =>
      users.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data };
      users.push(row);
      return { ...row };
    },
  };
  const tenant = {
    findUnique: async ({ where }: any) =>
      tenants.find((r) => matches(r, where)) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data };
      tenants.push(row);
      return { ...row };
    },
  };
  const session = {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      sessions.push(row);
      return { ...row };
    },
    findUnique: async ({ where, include }: any) => {
      const row = sessions.find((r) => matches(r, where)) ?? null;
      if (!row) return null;
      const out = { ...row };
      if (include?.user) {
        out.user = users.find((u) => u.id === row.userId) ?? null;
      }
      return out;
    },
    delete: async ({ where }: any) => {
      const i = sessions.findIndex((r) => matches(r, where));
      if (i >= 0) sessions.splice(i, 1);
    },
    deleteMany: async ({ where }: any) => {
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (matches(sessions[i], where)) sessions.splice(i, 1);
      }
    },
  };
  const aiSetting = {
    findMany: async () => aiSettings.map((r) => ({ ...r })),
    upsert: async ({ where, create, update }: any) => {
      let row = aiSettings.find((r) => r.key === where.key);
      if (row) Object.assign(row, update);
      else {
        row = { ...create };
        aiSettings.push(row);
      }
      return { ...row };
    },
  };
  const aiAnalysis = {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      aiAnalyses.push(row);
      return { ...row };
    },
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = aiAnalyses.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc")
        rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      else if (orderBy?.createdAt === "asc")
        rows = [...rows].sort((a, b) => a.createdAt - b.createdAt);
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    },
    findFirst: async ({ where }: any) =>
      aiAnalyses.find((r) => matches(r, where)) ?? null,
  };
  return {
    user,
    tenant,
    session,
    aiSetting,
    aiAnalysis,
    _stores: { tenants, users, sessions, aiSettings, aiAnalyses },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

const GOOD_SHAPE = {
  overallRisk: 42,
  riskLevel: "medium",
  scores: { merchant: 30, policy: 50, network: 40 },
  findings: [
    { area: "policy", severity: "medium", title: "t", detail: "d" },
  ],
  suggestions: ["s1"],
  keywords: ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"],
  adAngles: ["a1", "a2", "a3"],
};

async function buildTestApp(
  fake: FakePrisma,
  opts: { chatJsonImpl?: any } = {}
) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerAiRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    chatJsonImpl: opts.chatJsonImpl,
  });
  return app;
}

async function seedAuth(fake: FakePrisma, role: "admin" | "member") {
  const tenantId = randomUUID();
  await (fake as any).tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}`, status: "ACTIVE" },
  });
  const user = await (fake as any).user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(
    fake as unknown as PrismaClient,
    user.id
  );
  return { tenantId, user, token: session.token };
}

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

// ---------------------------------------------------------------------------
// crypto.ts
// ---------------------------------------------------------------------------

describe("ai crypto (AES-256-GCM)", () => {
  it("1. encrypt/decrypt roundtrip", () => {
    const enc = encryptSecret("sk-deepseek-abc123", TEST_AI_SETTINGS_PEPPER);
    expect(enc.startsWith("aienc$v1$")).toBe(true);
    expect(decryptSecret(enc, TEST_AI_SETTINGS_PEPPER)).toBe(
      "sk-deepseek-abc123"
    );
  });

  it("2. ciphertexts are randomized (fresh IV)", () => {
    const a = encryptSecret("same", TEST_AI_SETTINGS_PEPPER);
    const b = encryptSecret("same", TEST_AI_SETTINGS_PEPPER);
    expect(a).not.toBe(b);
  });

  it("3. wrong pepper fails closed", () => {
    const enc = encryptSecret("secret", TEST_AI_SETTINGS_PEPPER);
    expect(() => decryptSecret(enc, "wrong-pepper")).toThrow();
  });

  it("4. tampered ciphertext fails closed", () => {
    const enc = encryptSecret("secret", TEST_AI_SETTINGS_PEPPER);
    const tampered = enc.slice(0, -2) + (enc.endsWith("00") ? "ff" : "00");
    expect(() => decryptSecret(tampered, TEST_AI_SETTINGS_PEPPER)).toThrow();
  });

  it("5. pepper resolution prefers AI_SETTINGS_PEPPER", () => {
    expect(
      resolveAiSettingsPepper({
        AI_SETTINGS_PEPPER: "a",
        INTEGRATION_TOKEN_PEPPER: "b",
      } as NodeJS.ProcessEnv)
    ).toBe("a");
    expect(
      resolveAiSettingsPepper({
        INTEGRATION_TOKEN_PEPPER: "b",
      } as NodeJS.ProcessEnv)
    ).toBe("b");
    expect(resolveAiSettingsPepper()).toBe(TEST_AI_SETTINGS_PEPPER);
    expect(() => assertAiSettingsPepperConfigured()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// fetch-page.ts — SSRF guards + HTML stripping (no network needed)
// ---------------------------------------------------------------------------

describe("SSRF guards", () => {
  it("6. blocks private/loopback/link-local IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("7. blocks IPv6 loopback/link-local/unique-local + mapped v4", () => {
    for (const ip of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd00::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("8. allows public IPs", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("9. fetchPage rejects loopback/private targets without network", async () => {
    await expect(fetchPage("http://127.0.0.1/")).rejects.toThrow(
      "URL target is not allowed"
    );
    await expect(fetchPage("http://10.1.2.3:8080/x")).rejects.toThrow(
      "URL target is not allowed"
    );
    await expect(fetchPage("http://[::1]/")).rejects.toThrow(
      "URL target is not allowed"
    );
  });

  it("10. fetchPage rejects non-http(s) schemes", async () => {
    await expect(fetchPage("ftp://example.com/x")).rejects.toThrow(
      "Only http(s) URLs are allowed"
    );
    await expect(fetchPage("file:///etc/passwd")).rejects.toThrow(
      "Only http(s) URLs are allowed"
    );
  });

  it("11. fetchPage rejects malformed URLs", async () => {
    await expect(fetchPage("not a url")).rejects.toThrow("Invalid URL");
  });
});

describe("stripHtml", () => {
  it("12. removes scripts/styles/comments/tags and collapses whitespace", () => {
    const html = `<html><head><style>.x{color:red}</style><script>alert(1)</script></head>
      <body><!-- c --><h1>Hello</h1><p>world &amp; <b>friends</b></p></body></html>`;
    expect(stripHtml(html)).toBe("Hello world & friends");
  });
});

// ---------------------------------------------------------------------------
// profitability.ts
// ---------------------------------------------------------------------------

describe("profitability math (code, not LLM)", () => {
  it("13. break-even CVR = cpc/payout*100 rounded to 2dp", () => {
    expect(computeProfitability(20, "USD", 0.5)).toEqual({
      payout: 20,
      payoutCurrency: "USD",
      estimatedCpc: 0.5,
      breakEvenCvrPct: 2.5,
    });
    expect(
      computeProfitability(30, "USD", 1).breakEvenCvrPct
    ).toBe(3.33);
  });

  it("14. nulls when inputs missing or non-positive", () => {
    expect(computeProfitability(undefined, undefined, 0.5)).toEqual({
      payout: null,
      payoutCurrency: null,
      estimatedCpc: 0.5,
      breakEvenCvrPct: null,
    });
    expect(computeProfitability(0, "USD", 0.5).breakEvenCvrPct).toBe(null);
    expect(computeProfitability(20, "USD", 0).breakEvenCvrPct).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// prompts.ts
// ---------------------------------------------------------------------------

describe("analysis prompt", () => {
  it("15. output language follows the language param", () => {
    const zh = buildAnalysisPrompt({
      pageText: "x",
      language: "zh",
    });
    const en = buildAnalysisPrompt({
      pageText: "x",
      language: "en",
    });
    expect(zh.system).toContain("Simplified Chinese");
    expect(en.system).toContain("English");
    expect(zh.system).toContain("STRICT JSON");
  });

  it("16. validateAnalysisShape accepts a good shape", () => {
    const v = validateAnalysisShape(GOOD_SHAPE);
    expect(v.overallRisk).toBe(42);
    expect(v.riskLevel).toBe("medium");
    expect(v.keywords).toHaveLength(8);
  });

  it("17. validateAnalysisShape rejects bad shapes", () => {
    expect(() => validateAnalysisShape(null)).toThrow(AiError);
    expect(() =>
      validateAnalysisShape({ ...GOOD_SHAPE, overallRisk: 101 })
    ).toThrow(AiError);
    expect(() =>
      validateAnalysisShape({ ...GOOD_SHAPE, riskLevel: "extreme" })
    ).toThrow(AiError);
    expect(() =>
      validateAnalysisShape({ ...GOOD_SHAPE, keywords: [] })
    ).toThrow(AiError);
    expect(() =>
      validateAnalysisShape({
        ...GOOD_SHAPE,
        findings: [{ area: "bogus", severity: "low", title: "t", detail: "d" }],
      })
    ).toThrow(AiError);
  });

  it("17b. validateAnalysisShape is lenient on casing and numeric strings", () => {
    const v = validateAnalysisShape({
      ...GOOD_SHAPE,
      riskLevel: "Medium",
      overallRisk: "42",
      scores: { merchant: "10", policy: "20", network: "30" },
      findings: [
        { area: "MERCHANT", severity: "High", title: "t", detail: "d" },
      ],
    });
    expect(v.riskLevel).toBe("medium");
    expect(v.overallRisk).toBe(42);
    expect(v.scores.merchant).toBe(10);
    expect(v.findings[0].area).toBe("merchant");
    expect(v.findings[0].severity).toBe("high");
  });

  it("17c. shape errors name the offending field", () => {
    expect(() =>
      validateAnalysisShape({ ...GOOD_SHAPE, riskLevel: "extreme" })
    ).toThrow(/riskLevel/);
    expect(() =>
      validateAnalysisShape({ ...GOOD_SHAPE, keywords: [] })
    ).toThrow(/keywords/);
  });

  it("17d. chatJsonValidated retries once with field feedback", async () => {
    const systems: string[] = [];
    const impl = async (args: ChatJsonArgs): Promise<unknown> => {
      systems.push(args.system);
      return systems.length === 1 ? { overallRisk: "not-a-number" } : GOOD_SHAPE;
    };
    const v = await chatJsonValidated(
      { baseUrl: "x", model: "m", apiKey: "k", system: "base", user: "u" },
      validateAnalysisShape,
      impl,
    );
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain("overallRisk");
    expect(v.overallRisk).toBe(42);
  });

  it("17e. chatJsonValidated throws the field error when retry also fails", async () => {
    const impl = async (): Promise<unknown> => ({ overallRisk: "bad" });
    await expect(
      chatJsonValidated(
        { baseUrl: "x", model: "m", apiKey: "k", system: "s", user: "u" },
        validateAnalysisShape,
        impl,
      )
    ).rejects.toThrow(/overallRisk/);
  });

  it("17f. chatJson unwraps the OpenAI choices envelope", async () => {
    const origFetch = globalThis.fetch;
    const envelope = {
      id: "chatcmpl-1",
      choices: [{ index: 0, message: { role: "assistant", content: '{"a":1}' } }],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as any;
    try {
      const out = await chatJson({
        baseUrl: "https://x",
        model: "m",
        apiKey: "k",
        system: "s",
        user: "u",
      });
      expect(out).toEqual({ a: 1 });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("17g. chatJson strips fences inside envelope content", async () => {
    const origFetch = globalThis.fetch;
    const envelope = {
      choices: [{ message: { content: '```json\n{"a":2}\n```' } }],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(envelope), { status: 200 })) as any;
    try {
      const out = await chatJson({
        baseUrl: "https://x",
        model: "m",
        apiKey: "k",
        system: "s",
        user: "u",
      });
      expect(out).toEqual({ a: 2 });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("17h. chatJson rejects an envelope without message content", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 })) as any;
    try {
      await expect(
        chatJson({ baseUrl: "x", model: "m", apiKey: "k", system: "s", user: "u" })
      ).rejects.toThrow(/envelope/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// routes/ai.ts
// ---------------------------------------------------------------------------

describe("ai routes", () => {
  let fake: FakePrisma;
  let adminToken: string;
  let memberToken: string;
  let adminTenant: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    const admin = await seedAuth(fake, "admin");
    const member = await seedAuth(fake, "member");
    adminToken = admin.token;
    memberToken = member.token;
    adminTenant = admin.tenantId;
  });

  it("18. settings endpoints are admin-only", async () => {
    const app = await buildTestApp(fake);
    const getRes = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
      headers: cookie(memberToken),
    });
    expect(getRes.statusCode).toBe(403);
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(memberToken),
      payload: { baseUrl: "https://x", model: "m", apiKey: "k" },
    });
    expect(putRes.statusCode).toBe(403);
    const anon = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
    });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });

  it("19. admin can configure settings; key is encrypted at rest", async () => {
    const app = await buildTestApp(fake);
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {
        baseUrl: "https://api.deepseek.com/",
        model: "deepseek-chat",
        apiKey: "sk-test-key-123",
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
        ok: true,
        configured: true,
        hasTrafficSimilarweb: false,
        hasTrafficDataforseo: false,
        hasKeepa: false,
      });

    const get = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
    });
    const body = get.json();
    expect(body.configured).toBe(true);
    expect(body.provider).toBe("openai-compatible");
    expect(body.baseUrl).toBe("https://api.deepseek.com"); // trailing slash trimmed
    expect(body.model).toBe("deepseek-chat");
    expect(body.hasKey).toBe(true);
    // Key material never leaks through the API.
    expect(JSON.stringify(body)).not.toContain("sk-test-key-123");

    // Stored value is ciphertext, not plaintext.
    const stored = (fake as any)._stores.aiSettings.find(
      (r: Row) => r.key === "llm.apiKeyEnc"
    );
    expect(stored.value).not.toContain("sk-test-key-123");
    expect(stored.value.startsWith("aienc$v1$")).toBe(true);
    await app.close();
  });

  it("20. settings validation: bad baseUrl, empty body", async () => {
    const app = await buildTestApp(fake);
    const bad = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: { baseUrl: "notaurl" },
    });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    await app.close();
  });

  it("21. empty apiKey keeps the existing key", async () => {
    const app = await buildTestApp(fake);
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-test-key-123",
      },
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: { model: "deepseek-reasoner" },
    });
    expect(put.json()).toEqual({
        ok: true,
        configured: true,
        hasTrafficSimilarweb: false,
        hasTrafficDataforseo: false,
        hasKeepa: false,
      });
    const get = await app.inject({
      method: "GET",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
    });
    expect(get.json().model).toBe("deepseek-reasoner");
    expect(get.json().hasKey).toBe(true);
    await app.close();
  });

  it("22. analyze requires url or text", async () => {
    const app = await buildTestApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      headers: cookie(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("23. analyze returns 400 AI_NOT_CONFIGURED when no settings", async () => {
    const app = await buildTestApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      headers: cookie(adminToken),
      payload: { text: "some offer" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("AI_NOT_CONFIGURED");
    await app.close();
  });

  it("24. analyze rejects unauthenticated callers", async () => {
    const app = await buildTestApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      payload: { text: "x" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("25. analyze rejects SSRF targets through the route", async () => {
    const app = await buildTestApp(fake);
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-test-key-123",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      headers: cookie(adminToken),
      payload: { url: "http://127.0.0.1:9000/evil" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("26. analyze happy path (mocked LLM): decrypts key, validates shape, persists", async () => {
    let captured: any = null;
    const app = await buildTestApp(fake, {
      chatJsonImpl: (async (args: any) => {
        captured = args;
        return GOOD_SHAPE;
      }) as any,
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-test-key-123",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      headers: cookie(adminToken),
      payload: {
        text: "Amazing weight-loss tea! Guaranteed results in 7 days.",
        merchant: "TeaCo",
        network: "SomeNetwork",
        payout: 20,
        payoutCurrency: "USD",
        estimatedCpc: 0.5,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.merchant).toBe("TeaCo");
    expect(body.language).toBe("zh");
    expect(body.profitability).toEqual({
      payout: 20,
      payoutCurrency: "USD",
      estimatedCpc: 0.5,
      breakEvenCvrPct: 2.5,
    });
    expect(body.analysis.overallRisk).toBe(42);
    expect(body.analyzedAt).toBeTruthy();
    // The stored key was decrypted for the LLM call…
    expect(captured.apiKey).toBe("sk-test-key-123");
    expect(captured.model).toBe("deepseek-chat");
    // …and the default output language is zh.
    expect(captured.system).toContain("Simplified Chinese");
    // Never leaks the key in the response.
    expect(JSON.stringify(body)).not.toContain("sk-test-key-123");

    // History lists it, tenant-scoped.
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/ai/analyses",
      headers: cookie(adminToken),
    });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].overallRisk).toBe(42);
    expect(list.json().items[0].riskLevel).toBe("medium");

    const one = await app.inject({
      method: "GET",
      url: `/api/v1/ai/analyses/${body.id}`,
      headers: cookie(adminToken),
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().result.keywords).toHaveLength(8);
    await app.close();
  });

  it("27. analyses are tenant-isolated", async () => {
    const seen: string[] = [];
    const app = await buildTestApp(fake, {
      chatJsonImpl: (async () => GOOD_SHAPE) as any,
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {
        baseUrl: "https://api.deepseek.com",
        model: "m",
        apiKey: "k",
      },
    });
    for (const token of [adminToken, memberToken]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/ai/analyze",
        headers: cookie(token),
        payload: { text: "offer" },
      });
      seen.push(r.json().id);
    }
    const listA = await app.inject({
      method: "GET",
      url: "/api/v1/ai/analyses",
      headers: cookie(adminToken),
    });
    expect(listA.json().items).toHaveLength(1);

    // Member's analysis is invisible to the admin's tenant.
    const other = await app.inject({
      method: "GET",
      url: `/api/v1/ai/analyses/${seen[1]}`,
      headers: cookie(adminToken),
    });
    expect(other.statusCode).toBe(404);
    expect(adminTenant).toBeTruthy();
    await app.close();
  });

  it("28. invalid LLM shape surfaces as AI error", async () => {
    const app = await buildTestApp(fake, {
      chatJsonImpl: (async () => ({ bogus: true })) as any,
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/ai/settings",
      headers: cookie(adminToken),
      payload: {
        baseUrl: "https://api.deepseek.com",
        model: "m",
        apiKey: "k",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/analyze",
      headers: cookie(adminToken),
      payload: { text: "offer" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("AI_ERROR");
    await app.close();
  });
});
