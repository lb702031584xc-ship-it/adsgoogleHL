/**
 * Phase 10 — user auth: password hashing, login sessions, auth routes.
 * Uses an in-memory fake Prisma (no live DB) + Fastify inject.
 */
import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { hashPassword, verifyPassword } from "./password.js";
import {
  SESSION_COOKIE_NAME,
  createSession,
  hashSessionToken,
  resolveSession,
  revokeSession,
} from "./sessions.js";
import { registerAuthRoutes } from "../routes/auth.js";
import { authenticateSessionRequest } from "./sessions.js";
import { createAuthContext, requireTenant } from "./tenant.js";
import { createObservabilityErrorHandler } from "../observability/index.js";

// ---------------------------------------------------------------------------
// Fake Prisma (in-memory, structural)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object") return false;
    return row[key] === value;
  });
}

function project(row: Row, select: Row | undefined): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, include] of Object.entries(select)) {
    if (include) out[key] = row[key];
  }
  return out;
}

function makeDelegate(store: Row[], users: Row[]) {
  return {
    create: async ({ data }: any) => {
      const row = { createdAt: new Date(), ...data };
      store.push(row);
      return { ...row };
    },
    findUnique: async ({ where, include }: any) => {
      const row = store.find((r) => matchesWhere(r, where)) ?? null;
      if (!row) return null;
      const out = { ...row };
      if (include?.user) {
        const user = users.find((u) => u.id === row.userId) ?? null;
        (out as Row).user = user ? { ...user } : null;
      }
      return out;
    },
    findFirst: async ({ where }: any) => {
      const row = store.find((r) => matchesWhere(r, where)) ?? null;
      return row ? { ...row } : null;
    },
    findMany: async ({ where, orderBy, select }: any) => {
      let rows = store.filter((r) => matchesWhere(r, where));
      if (orderBy?.createdAt === "asc") {
        rows = [...rows].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        );
      }
      return rows.map((r) => project(r, select));
    },
    update: async ({ where, data }: any) => {
      const row = store.find((r) => matchesWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return { ...row };
    },
    count: async ({ where }: any) =>
      store.filter((r) => matchesWhere(r, where)).length,
    delete: async ({ where }: any) => {
      const idx = store.findIndex((r) => matchesWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      const [row] = store.splice(idx, 1);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchesWhere(store[i], where)) {
          store.splice(i, 1);
          count++;
        }
      }
      return { count };
    },
  };
}

function makeFakePrisma() {
  const tenants: Row[] = [];
  const users: Row[] = [];
  const sessions: Row[] = [];
  return {
    tenant: makeDelegate(tenants, users),
    user: makeDelegate(users, users),
    session: makeDelegate(sessions, users),
    _stores: { tenants, users, sessions },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function buildTestApp(fake: FakePrisma) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  await registerAuthRoutes(app, {
    prisma: fake as unknown as PrismaClient,
  });
  // Test-only: exercise session-aware tenantOf() incl. admin x-view-tenant.
  app.get("/test/whoami-tenant", async (request) => {
    await authenticateSessionRequest(fake as unknown as PrismaClient, request);
    const ctx = createAuthContext({ AUTH_MODE: "disabled" });
    const tenantId = requireTenant(ctx, request);
    const auth = request.auth as { role?: string } | undefined;
    return { tenantId, role: auth?.role };
  });
  return app;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

// ---------------------------------------------------------------------------
// password.ts
// ---------------------------------------------------------------------------

describe("password hashing (scrypt)", () => {
  it("1. hashes and verifies", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("2. rejects wrong password and malformed stored values", () => {
    const hash = hashPassword("s3cret!!!");
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifyPassword("s3cret!!!", "bogus")).toBe(false);
    expect(verifyPassword("s3cret!!!", "scrypt$zz$zz")).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
    expect(verifyPassword("s3cret!!!", "")).toBe(false);
  });

  it("3. salts differ between hashes", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("4. hashPassword rejects empty", () => {
    expect(() => hashPassword("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// auth routes
// ---------------------------------------------------------------------------

describe("auth routes (session auth)", () => {
  let fake: FakePrisma;

  beforeEach(() => {
    fake = makeFakePrisma();
  });

  async function register(
    email: string,
    password = "password123",
    name = "Test User"
  ) {
    const app = await buildTestApp(fake);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, name, password },
    });
    return { app, res };
  }

  it("5. register → 201 with user, token, cookie; first user is admin", async () => {
    const { app, res } = await register("admin@example.com");
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      user: Record<string, unknown>;
      token: string;
      expiresAt: string;
    };
    expect(body.user).toMatchObject({
      email: "admin@example.com",
      name: "Test User",
      role: "admin",
    });
    expect(typeof body.user.tenantId).toBe("string");
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
    expect(body.user).not.toHaveProperty("passwordHash");
    const setCookie = res.headers["set-cookie"] as string;
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${body.token}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
    await app.close();
  });

  it("6. second registered user is member", async () => {
    const first = await register("first@example.com");
    expect(first.res.json().user.role).toBe("admin");
    await first.app.close();
    const second = await register("second@example.com");
    expect(second.res.json().user.role).toBe("member");
    await second.app.close();
  });

  it("7. duplicate email → 409", async () => {
    const first = await register("dupe@example.com");
    await first.app.close();
    const { app, res } = await register("dupe@example.com");
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("8. register validation → 400", async () => {
    const app = await buildTestApp(fake);
    for (const payload of [
      { email: "not-an-email", name: "X", password: "password123" },
      { email: "ok@example.com", name: "", password: "password123" },
      { email: "ok@example.com", name: "X", password: "short" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it("9. login ok; wrong password and unknown email share the 401 message", async () => {
    const reg = await register("login@example.com", "mysecretpw");
    await reg.app.close();

    const app = await buildTestApp(fake);
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "login@example.com", password: "mysecretpw" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe("login@example.com");
    expect(ok.headers["set-cookie"]).toContain(SESSION_COOKIE_NAME);

    const wrongPw = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "login@example.com", password: "nope-nope-nope" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "nobody@example.com", password: "whatever123" },
    });
    expect(wrongPw.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrongPw.json().message).toBe("Invalid email or password");
    expect(unknown.json().message).toBe(wrongPw.json().message);
    await app.close();
  });

  it("10. me requires session; works via cookie and bearer", async () => {
    const reg = await register("me@example.com");
    const token = reg.res.json().token as string;
    await reg.app.close();

    const app = await buildTestApp(fake);
    const anon = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(anon.statusCode).toBe(401);

    const viaCookie = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: cookie(token),
    });
    expect(viaCookie.statusCode).toBe(200);
    expect(viaCookie.json().user.email).toBe("me@example.com");

    const viaBearer = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(token),
    });
    expect(viaBearer.statusCode).toBe(200);
    await app.close();
  });

  it("11. logout revokes the session", async () => {
    const reg = await register("bye@example.com");
    const token = reg.res.json().token as string;
    await reg.app.close();

    const app = await buildTestApp(fake);
    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: cookie(token),
    });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ ok: true });

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(token),
    });
    expect(me.statusCode).toBe(401);
    await app.close();
  });

  it("12. admin/users: member → 403, admin → 200 ordered list without hashes", async () => {
    const adminReg = await register("boss@example.com");
    const adminToken = adminReg.res.json().token as string;
    await adminReg.app.close();
    const memberReg = await register("worker@example.com");
    const memberToken = memberReg.res.json().token as string;
    await memberReg.app.close();

    const app = await buildTestApp(fake);
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/auth/admin/users",
      headers: bearer(memberToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const anon = await app.inject({
      method: "GET",
      url: "/api/v1/auth/admin/users",
    });
    expect(anon.statusCode).toBe(401);

    const ok = await app.inject({
      method: "GET",
      url: "/api/v1/auth/admin/users",
      headers: bearer(adminToken),
    });
    expect(ok.statusCode).toBe(200);
    const users = (ok.json() as { users: Array<Record<string, unknown>> })
      .users;
    expect(users.map((u) => u.email)).toEqual([
      "boss@example.com",
      "worker@example.com",
    ]);
    for (const u of users) {
      expect(u).not.toHaveProperty("passwordHash");
      expect(u).toHaveProperty("tenantId");
    }
    await app.close();
  });

  it("13. x-view-tenant: admin override works, member is ignored (isolation)", async () => {
    const adminReg = await register("viewadmin@example.com");
    const admin = adminReg.res.json() as { token: string; user: { tenantId: string } };
    await adminReg.app.close();
    const memberReg = await register("viewmember@example.com");
    const member = memberReg.res.json() as { token: string; user: { tenantId: string } };
    await memberReg.app.close();

    // A second tenant the admin may view as.
    const otherTenant = "00000000-0000-4000-8000-000000000099";
    await fake.tenant.create({
      data: { id: otherTenant, name: "other", slug: "u-other", status: "ACTIVE" },
    });

    const app = await buildTestApp(fake);

    const adminView = await app.inject({
      method: "GET",
      url: "/test/whoami-tenant",
      headers: { ...bearer(admin.token), "x-view-tenant": otherTenant },
    });
    expect(adminView.json()).toMatchObject({
      tenantId: otherTenant,
      role: "admin",
    });

    const memberView = await app.inject({
      method: "GET",
      url: "/test/whoami-tenant",
      headers: { ...bearer(member.token), "x-view-tenant": otherTenant },
    });
    expect(memberView.json()).toMatchObject({
      tenantId: member.user.tenantId,
      role: "member",
    });

    // Admin without the header sees their own tenant.
    const adminOwn = await app.inject({
      method: "GET",
      url: "/test/whoami-tenant",
      headers: bearer(admin.token),
    });
    expect(adminOwn.json()).toMatchObject({ tenantId: admin.user.tenantId });

    // Invalid UUID / unknown tenant → ignored.
    for (const bad of ["not-a-uuid", "00000000-0000-4000-8000-000000000098"]) {
      const res = await app.inject({
        method: "GET",
        url: "/test/whoami-tenant",
        headers: { ...bearer(admin.token), "x-view-tenant": bad },
      });
      expect(res.json()).toMatchObject({ tenantId: admin.user.tenantId });
    }
    await app.close();
  });

  it("14. expired sessions and non-active users are rejected", async () => {
    const reg = await register("exp@example.com");
    const userId = (reg.res.json().user as { id: string }).id;
    await reg.app.close();
    const prisma = fake as unknown as PrismaClient;

    const expired = await createSession(prisma, userId);
    await fake.session.deleteMany({});
    // Re-create with a past expiry directly in the store.
    fake._stores.sessions.push({
      id: "expired-id",
      tokenHash: hashSessionToken(expired.token),
      userId,
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });

    const app = await buildTestApp(fake);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(expired.token),
    });
    expect(res.statusCode).toBe(401);

    // Non-active user.
    const paused = await createSession(prisma, userId);
    await fake.user.update({
      where: { id: userId },
      data: { status: "PAUSED" },
    });
    const res2 = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(paused.token),
    });
    expect(res2.statusCode).toBe(401);
    expect(await resolveSession(prisma, "definitely-not-a-token")).toBeNull();
    await revokeSession(prisma, "definitely-not-a-token");
    await app.close();
  });
});
