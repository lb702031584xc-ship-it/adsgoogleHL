/**
 * Rotation worker tests: pure strategy selection + one-group rotation
 * against a targeted fake prisma.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test fakes need loose rows */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";
import {
  processRotationJob,
  rotateGroup,
  selectNextOffer,
  type RotationCandidate,
} from "./rotation-worker.js";

function candidates(n: number, weights?: number[]): RotationCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    rotationGroupItemId: randomUUID(),
    cashbackOfferId: `offer-${i}`,
    backingOfferId: `backing-${i}`,
    weight: weights?.[i] ?? 1,
    sortOrder: i,
  }));
}

describe("selectNextOffer", () => {
  it("returns null for an empty candidate list", () => {
    expect(
      selectNextOffer({ candidates: [], strategy: "round_robin" })
    ).toBeNull();
  });

  it("round_robin starts at the first item when nothing is current", () => {
    const c = candidates(3);
    expect(selectNextOffer({ candidates: c, strategy: "round_robin" })).toBe(
      c[0]
    );
  });

  it("round_robin advances past the current offer and wraps around", () => {
    const c = candidates(3);
    expect(
      selectNextOffer({
        candidates: c,
        strategy: "round_robin",
        currentOfferId: "offer-0",
      })
    ).toBe(c[1]);
    expect(
      selectNextOffer({
        candidates: c,
        strategy: "round_robin",
        currentOfferId: "offer-2",
      })
    ).toBe(c[0]);
  });

  it("round_robin sorts by sortOrder regardless of input order", () => {
    const c = candidates(3).reverse();
    expect(
      selectNextOffer({
        candidates: c,
        strategy: "round_robin",
        currentOfferId: "offer-0",
      })?.cashbackOfferId
    ).toBe("offer-1");
  });

  it("round_robin falls back to first when current is unknown", () => {
    const c = candidates(2);
    expect(
      selectNextOffer({
        candidates: c,
        strategy: "round_robin",
        currentOfferId: "gone",
      })
    ).toBe(c[0]);
  });

  it("weighted selects proportionally to weight (deterministic rand)", () => {
    const c = candidates(3, [1, 2, 7]);
    // total = 10; roll 0.05 → item 0; roll 0.25 → item 1; roll 0.95 → item 2
    expect(
      selectNextOffer({ candidates: c, strategy: "weighted", rand: () => 0.05 })
        ?.cashbackOfferId
    ).toBe("offer-0");
    expect(
      selectNextOffer({ candidates: c, strategy: "weighted", rand: () => 0.25 })
        ?.cashbackOfferId
    ).toBe("offer-1");
    expect(
      selectNextOffer({ candidates: c, strategy: "weighted", rand: () => 0.95 })
        ?.cashbackOfferId
    ).toBe("offer-2");
  });

  it("weighted clamps non-positive weights to 1", () => {
    const c = candidates(2, [0, -5]);
    expect(
      selectNextOffer({ candidates: c, strategy: "weighted", rand: () => 0.75 })
        ?.cashbackOfferId
    ).toBe("offer-1");
  });

  it("unknown strategy falls back to round_robin", () => {
    const c = candidates(2);
    expect(
      selectNextOffer({
        candidates: c,
        strategy: "mystery",
        currentOfferId: "offer-0",
      })
    ).toBe(c[1]);
  });
});

// ---------------------------------------------------------------------------
// rotateGroup against a targeted fake prisma
// ---------------------------------------------------------------------------

interface FakeOffer {
  id: string;
  tenantId: string;
  status: string;
  deletedAt: Date | null;
  trackingLinkId: string | null;
  originalUrl: string;
}
interface FakeLink {
  id: string;
  offerId: string;
}
interface FakeItem {
  id: string;
  rotationGroupId: string;
  cashbackOfferId: string;
  weight: number;
  sortOrder: number;
}
interface FakeGroup {
  id: string;
  tenantId: string;
  name: string;
  strategy: string;
  isActive: boolean;
  updatedAt: Date;
  createdAt: Date;
}

function makeFakePrisma(groups: FakeGroup[], items: FakeItem[], offers: FakeOffer[], links: FakeLink[]) {
  const updates: Array<{ id: string; data: any }> = [];
  return {
    prisma: {
      rotationGroup: {
        findUnique: async ({ where }: any) => {
          const g = groups.find((x) => x.id === where.id) ?? null;
          if (!g) return null;
          return {
            ...g,
            items: items
              .filter((it) => it.rotationGroupId === g.id)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((it) => ({
                ...it,
                cashbackOffer: offers.find((o) => o.id === it.cashbackOfferId) ?? null,
              })),
          };
        },
        findMany: async ({ where }: any) => {
          return groups
            .filter((g) => !where || Object.entries(where).every(([k, v]) => (g as any)[k] === v))
            .map((g) => ({ id: g.id, tenantId: g.tenantId, updatedAt: g.updatedAt }));
        },
        update: async ({ where, data }: any) => {
          const g = groups.find((x) => x.id === where.id);
          if (!g) throw new Error("fake: group not found");
          Object.assign(g, data);
          return g;
        },
      },
      trackingLink: {
        findMany: async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? [];
          return links
            .filter((l) => ids.includes(l.id))
            .map((l) => ({ id: l.id, offerId: l.offerId }));
        },
        update: async ({ where, data }: any) => {
          updates.push({ id: where.id, data });
          const l = links.find((x) => x.id === where.id);
          if (l) Object.assign(l, data);
          return l;
        },
      },
    } as unknown as PrismaClient,
    updates,
    groups,
  };
}

function seedGroup(strategy = "round_robin"): ReturnType<typeof makeFakePrisma> {
  const tenantId = randomUUID();
  const offerIds = [randomUUID(), randomUUID(), randomUUID()];
  const linkIds = [randomUUID(), randomUUID(), randomUUID()];
  const backingIds = [randomUUID(), randomUUID(), randomUUID()];
  const offers: FakeOffer[] = offerIds.map((id, i) => ({
    id,
    tenantId,
    status: "active",
    deletedAt: null,
    trackingLinkId: linkIds[i],
    originalUrl: `https://cashback.example/${i}`,
  }));
  const links: FakeLink[] = linkIds.map((id, i) => ({ id, offerId: backingIds[i] }));
  const groupId = randomUUID();
  const groups: FakeGroup[] = [
    {
      id: groupId,
      tenantId,
      name: "g",
      strategy,
      isActive: true,
      updatedAt: new Date(Date.now() - 2 * 3600_000),
      createdAt: new Date(Date.now() - 2 * 3600_000),
    },
  ];
  const items: FakeItem[] = offerIds.map((id, i) => ({
    id: randomUUID(),
    rotationGroupId: groupId,
    cashbackOfferId: id,
    weight: 1,
    sortOrder: i,
  }));
  const fake = makeFakePrisma(groups, items, offers, links);
  return { ...fake, offerIds, linkIds, backingIds, groupId, tenantId, items, offers };
}

describe("rotateGroup", () => {
  it("round_robin re-points every member link at the next offer's backing offer", async () => {
    const f = seedGroup("round_robin");
    // All links currently point at backing-0 (offer-0 is current), so the
    // next round_robin pick must be offer-1.
    const result = await rotateGroup({
      prisma: f.prisma,
      trackingLinks: {
        update: async (id: string, data: { offerId: string }) =>
          (f.prisma.trackingLink as any).update({ where: { id }, data }),
      },
      groupId: f.groupId,
    });
    expect(result.rotated).toBe(true);
    expect(result.selectedOfferId).toBe(f.offerIds[1]);
    expect(result.updatedTrackingLinkIds).toHaveLength(3);
    // Every member link now resolves to offer-1's backing offer.
    for (const u of f.updates) {
      expect(u.data.offerId).toBe(f.backingIds[1]);
    }
  });

  it("returns rotated=false when the group has no active offers", async () => {
    const f = seedGroup();
    for (const o of f.offers) o.status = "paused";
    const result = await rotateGroup({
      prisma: f.prisma,
      trackingLinks: { update: async () => undefined },
      groupId: f.groupId,
    });
    expect(result.rotated).toBe(false);
    expect(result.skipped).toBeTruthy();
  });

  it("returns skipped when the group does not exist", async () => {
    const f = seedGroup();
    const result = await rotateGroup({
      prisma: f.prisma,
      trackingLinks: { update: async () => undefined },
      groupId: randomUUID(),
    });
    expect(result.skipped).toBe("group not found");
  });
});

describe("processRotationJob", () => {
  it("rotates due groups and skips recently-rotated ones", async () => {
    const f = seedGroup();
    // Make a second, recently-rotated group → should be skipped.
    const recentId = randomUUID();
    f.groups.push({
      id: recentId,
      tenantId: f.tenantId,
      name: "recent",
      strategy: "round_robin",
      isActive: true,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    const summary = await processRotationJob({
      prisma: f.prisma,
      trackingLinks: {
        update: async (id: string, data: { offerId: string }) =>
          (f.prisma.trackingLink as any).update({ where: { id }, data }),
      },
      triggeredBy: "manual",
    });
    expect(summary.groupsRotated).toBe(1);
    expect(summary.groupsSkipped).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("counts errors without throwing when a group fails", async () => {
    const f = seedGroup();
    const summary = await processRotationJob({
      prisma: f.prisma,
      trackingLinks: {
        update: async () => {
          throw new Error("boom");
        },
      },
      triggeredBy: "schedule",
    });
    expect(summary.errors).toBe(1);
    expect(summary.groupsRotated).toBe(0);
  });
});
