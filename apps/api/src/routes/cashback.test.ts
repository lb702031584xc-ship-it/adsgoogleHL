/**
 * Feature 3 — cashback routes contract tests.
 * In-memory fake Prisma + Fastify inject, fake AdsPower client,
 * fake TrackingLink service (the real one is injected by default).
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
import { AdsPowerClient } from "../integrations/adspower.js";
import { registerCashbackRoutes } from "./cashback.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      const rv = row[k];
      if ("gte" in v && !(rv >= (v as any).gte)) return false;
      if ("gt" in v && !(rv > (v as any).gt)) return false;
      if ("lt" in v && !(rv < (v as any).lt)) return false;
      if ("lte" in v && !(rv <= (v as any).lte)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const [key, dir] = Object.entries(orderBy)[0] as [string, string];
  const out = [...rows];
  out.sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    return dir === "desc" ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
  });
  return out;
}

function applySelect(row: Row, select: any): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) {
    if (select[k] && k in row) out[k] = row[k];
  }
  return out;
}

function mkStore(rows: Row[]) {
  return {
    findFirst: async ({ where, select }: any) => {
      const row = rows.find((r) => matches(r, where)) ?? null;
      return row ? applySelect(row, select) : null;
    },
    findUnique: async ({ where, select }: any) => {
      const row = rows.find((r) => matches(r, where)) ?? null;
      return row ? applySelect(row, select) : null;
    },
    findMany: async ({ where, orderBy, skip, take, select }: any) => {
      let out = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      if (skip) out = out.slice(skip);
      if (take !== undefined) out = out.slice(0, take);
      return out.map((r) => applySelect(r, select));
    },
    create: async ({ data }: any) => {
      const row = {
        id: data.id ?? randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("fake: row not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("fake: row not found");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) {
          rows.splice(i, 1);
          n++;
        }
      }
      return { count: n };
    },
    count: async ({ where }: any) => rows.filter((r) => matches(r, where)).length,
    _rows: rows,
  };
}

interface Fake {
  tenant: ReturnType<typeof mkStore>;
  user: ReturnType<typeof mkStore>;
  session: ReturnType<typeof mkStore>;
  cashbackOffer: ReturnType<typeof mkStore>;
  rotationGroup: ReturnType<typeof mkStore>;
  rotationGroupItem: ReturnType<typeof mkStore>;
  trackingLink: ReturnType<typeof mkStore>;
  offer: ReturnType<typeof mkStore>;
}

function makeFakePrisma(): Fake {
  const cashbackOffers = mkStore([]);
  const rotationGroups = mkStore([]);
  const rotationGroupItems = mkStore([]);
  const trackingLinks = mkStore([]);
  const offers = mkStore([]);
  const tenants = mkStore([]);
  const users = mkStore([]);
  const sessions = mkStore([]);

  function attachGroup(row: Row): Row {
    const items = (rotationGroupItems._rows as Row[])
      .filter((it) => it.rotationGroupId === row.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((it) => ({
        ...it,
        cashbackOffer: (cashbackOffers._rows as Row[]).find(
          (o) => o.id === it.cashbackOfferId
        )
          ? {
              id: it.cashbackOfferId,
              cashbackNetwork: (cashbackOffers._rows as Row[]).find(
                (o) => o.id === it.cashbackOfferId
              )!.cashbackNetwork,
              originalUrl: (cashbackOffers._rows as Row[]).find(
                (o) => o.id === it.cashbackOfferId
              )!.originalUrl,
              status: (cashbackOffers._rows as Row[]).find(
                (o) => o.id === it.cashbackOfferId
              )!.status,
              adspowerProfileId: (cashbackOffers._rows as Row[]).find(
                (o) => o.id === it.cashbackOfferId
              )!.adspowerProfileId,
              trackingLinkId: (cashbackOffers._rows as Row[]).find(
                (o) => o.id === it.cashbackOfferId
              )!.trackingLinkId,
            }
          : null,
      }));
    return { ...row, items };
  }

  function attachOffer(row: Row): Row {
    const link = (trackingLinks._rows as Row[]).find(
      (l) => l.id === row.trackingLinkId
    );
    return {
      ...row,
      trackingLink: link
        ? { id: link.id, publicId: link.publicId, status: link.status }
        : null,
    };
  }

  // Wrap cashbackOffer reads with trackingLink include support.
  const baseCashbackFindFirst = cashbackOffers.findFirst;
  const baseCashbackFindMany = cashbackOffers.findMany;
  (cashbackOffers as any).findFirst = async (args: any) => {
    const row = await baseCashbackFindFirst(args);
    return row && args?.include?.trackingLink ? attachOffer(row) : row;
  };
  (cashbackOffers as any).findMany = async (args: any) => {
    const rows = await baseCashbackFindMany(args);
    return args?.include?.trackingLink ? rows.map(attachOffer) : rows;
  };

  // rotationGroup with nested items create + items include.
  const baseGroupCreate = rotationGroups.create;
  const baseGroupFindMany = rotationGroups.findMany;
  const baseGroupFindFirst = rotationGroups.findFirst;
  const baseGroupUpdate = rotationGroups.update;
  (rotationGroups as any).create = async (args: any) => {
    const { items, ...rest } = args.data ?? {};
    const row = await baseGroupCreate({ data: rest });
    for (const it of items?.create ?? []) {
      await rotationGroupItems.create({
        data: { ...it, rotationGroupId: row.id },
      });
    }
    return attachGroup(row);
  };
  (rotationGroups as any).findMany = async (args: any) => {
    const rows = await baseGroupFindMany(args);
    return args?.include?.items ? rows.map(attachGroup) : rows;
  };
  (rotationGroups as any).findFirst = async (args: any) => {
    const row = await baseGroupFindFirst(args);
    if (!row) return null;
    return args?.include?.items ? attachGroup(row) : row;
  };
  (rotationGroups as any).findUnique = async (args: any) => {
    const row = await baseGroupFindFirst(args);
    if (!row) return null;
    return args?.include?.items ? attachGroup(row) : row;
  };
  (rotationGroups as any).update = async (args: any) => {
    const { items, ...rest } = args.data ?? {};
    const row = await baseGroupUpdate({ where: args.where, data: rest });
    for (const it of items?.create ?? []) {
      await rotationGroupItems.create({
        data: { ...it, rotationGroupId: row.id },
      });
    }
    return args?.include?.items ? attachGroup(row) : row;
  };

  // Session findUnique with include.user (for auth).
  const baseSessionFindUnique = sessions.findUnique;
  (sessions as any).findUnique = async (args: any) => {
    const row = await baseSessionFindUnique(args);
    if (!row) return null;
    if (args?.include?.user) {
      return {
        ...row,
        user: (users._rows as Row[]).find((u) => u.id === row.userId) ?? null,
      };
    }
    return row;
  };

  return {
    tenant: tenants,
    user: users,
    session: sessions,
    cashbackOffer: cashbackOffers,
    rotationGroup: rotationGroups,
    rotationGroupItem: rotationGroupItems,
    trackingLink: trackingLinks,
    offer: offers,
  };
}

function cookie(token: string) {
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function seedAuth(fake: Fake, role: "admin" | "member" = "member") {
  const tenantId = randomUUID();
  await fake.tenant.create({
    data: { id: tenantId, name: `${role}@t`, slug: `u-${role}`, status: "ACTIVE" },
  });
  const user = await fake.user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: `${role}@example.com`,
      name: role,
      role,
      status: "ACTIVE",
    },
  });
  const session = await createSession(fake as unknown as PrismaClient, user.id);
  return { tenantId, user, token: session.token };
}

function makeFakeAdsPower() {
  return {
    baseUrl: "http://fake-adspower:50325",
    profiles: [
      { userId: "prof-1", name: "rakuten-01" },
      { userId: "prof-2", name: "55haitao-01" },
    ],
    opened: [] as string[],
    closed: [] as string[],
    async listProfiles() {
      return this.profiles;
    },
    async openBrowser(profileId: string) {
      this.opened.push(profileId);
      return { userId: profileId, debugPort: 9222 };
    },
    async closeBrowser(profileId: string) {
      this.closed.push(profileId);
    },
  };
}

function makeFakeTrackingLinkService(fake: Fake) {
  return {
    async create(data: any) {
      const row = {
        id: data.id ?? randomUUID(),
        tenantId: data.tenantId,
        publicId: data.publicId,
        offerId: data.offerId,
        status: data.status ?? "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (fake.trackingLink as any)._rows.push(row);
      return { ...row };
    },
    async update(_tenantId: string, id: string, data: any) {
      const row = (fake.trackingLink as any)._rows.find((r: Row) => r.id === id);
      if (!row) throw new Error("fake: tracking link not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    async getById(tenantId: string, id: string) {
      return (
        (fake.trackingLink as any)._rows.find(
          (r: Row) => r.id === id && r.tenantId === tenantId
        ) ?? null
      );
    },
  };
}

async function buildApp(fake: Fake) {
  const app = Fastify({ logger: false });
  app.setErrorHandler(createObservabilityErrorHandler());
  const adspower = makeFakeAdsPower();
  const trackingLinkService = makeFakeTrackingLinkService(fake);
  await registerCashbackRoutes(app, {
    prisma: fake as unknown as PrismaClient,
    adspowerImpl: adspower as unknown as AdsPowerClient,
    trackingLinkService: trackingLinkService as any,
  });
  return { app, adspower, trackingLinkService };
}

async function createCashbackOffer(
  app: any,
  token: string,
  extra: Record<string, unknown> = {}
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/cashback-offers",
    headers: cookie(token),
    payload: {
      cashbackNetwork: "rakuten",
      originalUrl: "https://www.merchant.example/item/123",
      ...extra,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

// ---------------------------------------------------------------------------

describe("cashback routes", () => {
  let fake: Fake;
  let app: any;
  let token: string;
  let tenantId: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ app } = await buildApp(fake));
    ({ token, tenantId } = await seedAuth(fake));
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/cashback-offers",
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a cashback offer with a backing offer + tracking link", async () => {
    const body = await createCashbackOffer(app, token);
    const { cashbackOffer, trackingLink } = body;
    expect(cashbackOffer.id).toBeTruthy();
    expect(cashbackOffer.cashbackNetwork).toBe("rakuten");
    expect(cashbackOffer.status).toBe("active");
    expect(cashbackOffer.trackingLinkId).toBe(trackingLink.id);
    expect(trackingLink.publicId).toMatch(/^cb_/);

    // Backing offer row exists with the original URL as destination.
    const offers = (fake.offer as any)._rows as Row[];
    expect(offers).toHaveLength(1);
    expect(offers[0].destinationUrl).toBe(
      "https://www.merchant.example/item/123"
    );
    expect(offers[0].network).toBe("rakuten");

    // Tracking link was created through the injected creation service.
    const links = (fake.trackingLink as any)._rows as Row[];
    expect(links).toHaveLength(1);
    expect(links[0].offerId).toBe(offers[0].id);
  });

  it("accepts arbitrary cashback network names (no whitelist)", async () => {
    for (const network of ["nope", "MyCustomNetwork 返利", "  padded  "]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/cashback-offers",
        headers: cookie(token),
        payload: {
          cashbackNetwork: network,
          originalUrl: "https://x.example/",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().cashbackOffer.cashbackNetwork).toBe(network.trim());
    }
  });

  it("rejects empty / too-long network and invalid url", async () => {
    for (const network of ["", "   ", "x".repeat(65)]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/cashback-offers",
        headers: cookie(token),
        payload: {
          cashbackNetwork: network,
          originalUrl: "https://x.example/",
        },
      });
      expect(res.statusCode).toBe(400);
    }

    const badUrl = await app.inject({
      method: "POST",
      url: "/api/v1/cashback-offers",
      headers: cookie(token),
      payload: { cashbackNetwork: "rakuten", originalUrl: "not-a-url" },
    });
    expect(badUrl.statusCode).toBe(400);
  });

  it("lists / gets / updates / soft-deletes a cashback offer", async () => {
    const { cashbackOffer } = await createCashbackOffer(app, token);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/cashback-offers",
      headers: cookie(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().items[0].trackingLink.publicId).toMatch(/^cb_/);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/cashback-offers/${cashbackOffer.id}`,
      headers: cookie(token),
    });
    expect(get.statusCode).toBe(200);

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/cashback-offers/${cashbackOffer.id}`,
      headers: cookie(token),
      payload: { status: "paused", adspowerProfileId: "prof-1" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().cashbackOffer.status).toBe("paused");
    expect(put.json().cashbackOffer.adspowerProfileId).toBe("prof-1");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/cashback-offers/${cashbackOffer.id}`,
      headers: cookie(token),
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/cashback-offers",
      headers: cookie(token),
    });
    expect(after.json().total).toBe(0);
    // Bound tracking link got paused.
    const links = (fake.trackingLink as any)._rows as Row[];
    expect(links[0].status).toBe("PAUSED");
  });

  it("updating originalUrl syncs the backing offer destination", async () => {
    const { cashbackOffer } = await createCashbackOffer(app, token);
    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/cashback-offers/${cashbackOffer.id}`,
      headers: cookie(token),
      payload: { originalUrl: "https://www.merchant.example/item/999" },
    });
    expect(put.statusCode).toBe(200);
    const offers = (fake.offer as any)._rows as Row[];
    expect(offers[0].destinationUrl).toBe("https://www.merchant.example/item/999");
  });

  it("isolates tenants", async () => {
    await createCashbackOffer(app, token);
    const other = await seedAuth(fake, "member");
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/cashback-offers",
      headers: cookie(other.token),
    });
    expect(list.json().total).toBe(0);
    void tenantId;
  });
});

describe("adspower routes", () => {
  let fake: Fake;
  let app: any;
  let adspower: ReturnType<typeof makeFakeAdsPower>;
  let token: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ app, adspower } = await buildApp(fake));
    ({ token } = await seedAuth(fake));
  });

  it("lists profiles", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/integrations/adspower/profiles",
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profiles).toHaveLength(2);
    expect(res.json().baseUrl).toBe("http://fake-adspower:50325");
  });

  it("opens and closes a browser", async () => {
    const open = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/adspower/open",
      headers: cookie(token),
      payload: { profileId: "prof-1" },
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().session.userId).toBe("prof-1");
    expect(adspower.opened).toEqual(["prof-1"]);

    const close = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/adspower/close",
      headers: cookie(token),
      payload: { profileId: "prof-1" },
    });
    expect(close.statusCode).toBe(200);
    expect(adspower.closed).toEqual(["prof-1"]);
  });

  it("requires profileId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/integrations/adspower/open",
      headers: cookie(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("rotation groups", () => {
  let fake: Fake;
  let app: any;
  let token: string;

  beforeEach(async () => {
    fake = makeFakePrisma();
    ({ app } = await buildApp(fake));
    ({ token } = await seedAuth(fake));
  });

  async function seedOffer(network = "rakuten", n = 1) {
    return createCashbackOffer(app, token, {
      cashbackNetwork: network,
      originalUrl: `https://www.merchant.example/item/${n}`,
    });
  }

  async function createGroup(offerIds: string[], strategy = "round_robin") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/rotation-groups",
      headers: cookie(token),
      payload: {
        name: "g1",
        strategy,
        items: offerIds.map((id, i) => ({
          cashbackOfferId: id,
          weight: i + 1,
        })),
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json().rotationGroup;
  }

  it("creates a group with weighted items, lists it, updates it", async () => {
    const a = await seedOffer("rakuten", 1);
    const b = await seedOffer("55haitao", 2);
    const group = await createGroup(
      [a.cashbackOffer.id, b.cashbackOffer.id],
      "weighted"
    );
    expect(group.strategy).toBe("weighted");
    expect(group.items).toHaveLength(2);
    expect(group.items[0].weight).toBe(1);
    expect(group.items[1].weight).toBe(2);
    expect(group.items[0].cashbackOffer.cashbackNetwork).toBe("rakuten");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/rotation-groups",
      headers: cookie(token),
    });
    expect(list.json().total).toBe(1);

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/rotation-groups/${group.id}`,
      headers: cookie(token),
      payload: { isActive: false, strategy: "round_robin" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().rotationGroup.isActive).toBe(false);
    expect(put.json().rotationGroup.strategy).toBe("round_robin");
  });

  it("rejects bad items", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/rotation-groups",
      headers: cookie(token),
      payload: { name: "g", items: [] },
    });
    expect(res.statusCode).toBe(400);

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/rotation-groups",
      headers: cookie(token),
      payload: {
        name: "g",
        items: [
          { cashbackOfferId: randomUUID() },
          { cashbackOfferId: randomUUID() },
        ],
      },
    });
    // unknown offer ids → 404 (items validated against the tenant's offers)
    expect([400, 404]).toContain(dup.statusCode);
  });

  it("rotate-now re-points member links at the next offer", async () => {
    const a = await seedOffer("rakuten", 1);
    const b = await seedOffer("55haitao", 2);
    const group = await createGroup([a.cashbackOffer.id, b.cashbackOffer.id]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/rotation-groups/${group.id}/rotate-now`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.rotated).toBe(true);
    // round_robin from offer a → offer b
    expect(result.selectedOfferId).toBe(b.cashbackOffer.id);
    expect(result.updatedTrackingLinkIds).toHaveLength(2);

    // Both links now resolve to b's backing offer.
    const bLinkId = b.cashbackOffer.trackingLinkId;
    const bLink = (fake.trackingLink as any)._rows.find(
      (r: Row) => r.id === bLinkId
    );
    for (const id of result.updatedTrackingLinkIds) {
      const link = (fake.trackingLink as any)._rows.find(
        (r: Row) => r.id === id
      );
      expect(link.offerId).toBe(bLink.offerId);
    }
  });

  it("deletes a group without deleting offers", async () => {
    const a = await seedOffer("rakuten", 1);
    const group = await createGroup([a.cashbackOffer.id]);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/rotation-groups/${group.id}`,
      headers: cookie(token),
    });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/cashback-offers",
      headers: cookie(token),
    });
    expect(list.json().total).toBe(1);
  });

  it("returns 404 for unknown group ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/rotation-groups/${randomUUID()}/rotate-now`,
      headers: cookie(token),
    });
    expect(res.statusCode).toBe(404);
  });
});
