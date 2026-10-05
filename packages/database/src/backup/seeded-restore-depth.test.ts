/**
 * Phase 12.2-A — Unit tests for seeded restore depth module (no live Postgres required).
 * Phase 13.4 Track B — D12–D21 assertions.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_SI_TOKEN_A, TenantA, TenantB } from "../fixtures/ids.js";
import { BackupError } from "./types.js";
import {
  assertSeededRestoreDepth,
  buildPassingSeededRestoreDepthSnapshot,
  compareSeededRestoreDepthExtendedSnapshots,
  compareSeededRestoreDepthSnapshots,
  evaluateSeededRestoreDepth,
  evaluateSeededRestoreDepthWithSourceCompare,
  EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
  EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A,
  SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
  snapshotSeededRestoreDepth,
  type SeededRestoreDepthSnapshot,
} from "./seeded-restore-depth.js";

describe("Phase 12.2-A seeded restore depth", () => {
  it("1. complete Phase 1.3 fixture snapshot passes", () => {
    const snap = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(snap);
    expect(result.status).toBe("passed");
    expect(result.fixtureVersion).toBe(SEEDED_RESTORE_DEPTH_FIXTURE_VERSION);
    expect(result.failedCount).toBe(0);
  });

  it("2. all D1–D10 and D12–D20 pass on complete snapshot", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot()
    );
    const ids = result.assertions.map((a) => a.id);
    expect(ids).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "D7",
      "D8",
      "D9",
      "D10",
      "D12",
      "D13",
      "D14",
      "D15",
      "D16",
      "D17",
      "D18",
      "D19",
      "D20",
    ]);
    expect(result.assertions.every((a) => a.status === "passed")).toBe(true);
  });

  it("3. Tenant A missing → D2 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        tenantIds: [TenantB.id],
        tenantCount: 1,
      })
    );
    expect(result.assertions.find((a) => a.id === "D2")?.status).toBe("failed");
  });

  it("4. Tenant B missing → D2 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        tenantIds: [TenantA.id],
        tenantCount: 1,
      })
    );
    expect(result.assertions.find((a) => a.id === "D2")?.status).toBe("failed");
  });

  it("5. tenant count incorrect → D1 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ tenantCount: 3 })
    );
    expect(result.assertions.find((a) => a.id === "D1")?.status).toBe("failed");
  });

  it("6. Tenant A campaign count incorrect → D3 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ campaignCountTenantA: 1 })
    );
    expect(result.assertions.find((a) => a.id === "D3")?.status).toBe("failed");
  });

  it("7. tracking publicId missing → D4 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        trackingPublicIdsTenantA: ["trk_demo_001", "trk_demo_002"],
      })
    );
    expect(result.assertions.find((a) => a.id === "D4")?.status).toBe("failed");
  });

  it("8. ORDER-001 missing → D5 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        order001: null,
        order001TenantId: null,
        order001TrackingPublicId: null,
      })
    );
    expect(result.assertions.find((a) => a.id === "D5")?.status).toBe("failed");
  });

  it("9. ORDER-001 wrong tenant → D6 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        order001: {
          orderId: "ORDER-001",
          tenantId: TenantB.id,
          clickId: TenantA.click1,
          trackingPublicId: "trk_demo_001",
        },
        order001TenantId: TenantB.id,
        order001TrackingPublicId: "trk_demo_001",
      })
    );
    expect(result.assertions.find((a) => a.id === "D6")?.status).toBe("failed");
  });

  it("10. wrong tracking publicId → D7 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        order001: {
          orderId: "ORDER-001",
          tenantId: TenantA.id,
          clickId: TenantA.click1,
          trackingPublicId: "trk_demo_002",
        },
        order001TenantId: TenantA.id,
        order001TrackingPublicId: "trk_demo_002",
      })
    );
    expect(result.assertions.find((a) => a.id === "D7")?.status).toBe("failed");
    expect(result.assertions.find((a) => a.id === "D7")?.expected).toBe(
      "trk_demo_001"
    );
  });

  it("11. Tenant B has no click → D8 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ tenantBClickCount: 0 })
    );
    expect(result.assertions.find((a) => a.id === "D8")?.status).toBe("failed");
  });

  it("12. ACTIVE UrlVersion uniqueness violation → D9 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        activeUrlVersionUniquenessViolations: 1,
      })
    );
    expect(result.assertions.find((a) => a.id === "D9")?.status).toBe("failed");
  });

  it("13. ACTIVE UrlVersion count not equal to 3 → D10 fail", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ activeUrlVersionCount: 1 })
    );
    const d10 = result.assertions.find((a) => a.id === "D10");
    expect(d10?.status).toBe("failed");
    expect(d10?.expected).toBe(EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3);
  });

  it("14. fixture IDs absent → D2 fail and assert throws DEPTH_FIXTURES_MISSING", () => {
    const snap = buildPassingSeededRestoreDepthSnapshot({
      tenantIds: ["not-a-fixture"],
      tenantCount: 1,
    });
    expect(evaluateSeededRestoreDepth(snap).assertions.find((a) => a.id === "D2")
      ?.status).toBe("failed");
    try {
      assertSeededRestoreDepth(snap);
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      expect((error as BackupError).code).toBe("DEPTH_FIXTURES_MISSING");
    }
  });

  it("15. identical source/restore depth snapshots pass D11", () => {
    const a = buildPassingSeededRestoreDepthSnapshot();
    const b = buildPassingSeededRestoreDepthSnapshot();
    const d11 = compareSeededRestoreDepthSnapshots(a, b);
    expect(d11.status).toBe("passed");
    const full = evaluateSeededRestoreDepthWithSourceCompare(a, b);
    expect(full.status).toBe("passed");
    expect(full.assertions.some((x) => x.id === "D11")).toBe(true);
    expect(full.assertions.some((x) => x.id === "D21")).toBe(true);
  });

  it("16. relevant source field changed → D11 failure", () => {
    const source = buildPassingSeededRestoreDepthSnapshot();
    const changed = buildPassingSeededRestoreDepthSnapshot({
      campaignCountTenantA: 99,
    });
    const d11 = compareSeededRestoreDepthSnapshots(source, changed);
    expect(d11.status).toBe("failed");
    expect(d11.actual).toMatchObject({
      mismatchedKeys: expect.arrayContaining(["campaignCountTenantA"]),
    });
  });

  it("17-18. failure messages do not contain password or credential URL", () => {
    const secretUrl =
      "postgresql://adlinklab:SuperSecretPassword99@127.0.0.1:5432/adlinklab";
    const snap = buildPassingSeededRestoreDepthSnapshot({
      order001TrackingPublicId: secretUrl,
      order001: {
        orderId: "ORDER-001",
        tenantId: TenantA.id,
        clickId: TenantA.click1,
        trackingPublicId: secretUrl,
      },
    });
    try {
      assertSeededRestoreDepth(snap);
      expect.unreachable("should throw");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      expect(msg).not.toMatch(/SuperSecretPassword99/);
      expect(msg).not.toMatch(/postgresql:\/\/adlinklab:SuperSecretPassword99@/i);
      // redaction may leave host/db; password must be gone
      expect((error as BackupError).code).toMatch(/^DEPTH_/);
    }
  });

  it("snapshotSeededRestoreDepth requires explicit target", async () => {
    await expect(snapshotSeededRestoreDepth({})).rejects.toMatchObject({
      code: "DEPTH_TARGET_REQUIRED",
    });
  });

  it("snapshotSeededRestoreDepth works with injectable queryFn", async () => {
    const snap = await snapshotSeededRestoreDepth({
      queryFn: async (sql, params = []) => {
        if (sql.includes("FROM tenants")) {
          return [{ id: TenantA.id }, { id: TenantB.id }];
        }
        if (sql.includes("FROM campaigns")) {
          expect(params[0]).toBe(TenantA.id);
          return [{ n: 2 }];
        }
        if (sql.includes("FROM tracking_links") && !sql.includes("JOIN")) {
          return EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A.map((public_id) => ({
            public_id,
          }));
        }
        if (sql.includes("ORDER-001")) {
          return [
            {
              order_id: "ORDER-001",
              tenant_id: TenantA.id,
              click_id: TenantA.click1,
              public_id: "trk_demo_001",
            },
          ];
        }
        if (sql.includes("HAVING count")) return [];
        if (sql.includes("FROM url_versions WHERE status = 'ACTIVE'") && sql.includes("count(*)")) {
          return [{ n: 3 }];
        }
        if (sql.includes("FROM clicks")) {
          expect(params[0]).toBe(TenantB.id);
          return [{ n: 1 }];
        }
        if (
          sql.includes("FROM google_ads_script_integrations") &&
          sql.includes("count(*)")
        ) {
          return [{ n: 1 }];
        }
        if (
          sql.includes("FROM google_ads_script_integrations si") &&
          sql.includes("JOIN google_accounts")
        ) {
          return [
            {
              id: TenantA.scriptIntegration,
              tenant_id: TenantA.id,
              google_account_id: TenantA.account,
              token_prefix: FIXTURE_SI_TOKEN_A.tokenPrefix,
              status: "ACTIVE",
              token_hash: FIXTURE_SI_TOKEN_A.tokenHash,
            },
          ];
        }
        if (sql.includes("FROM script_sync_targets st")) {
          return [
            {
              id: TenantA.scriptSyncTarget,
              tenant_id: TenantA.id,
              integration_id: TenantA.scriptIntegration,
              entity_type: "AD",
              entity_id: TenantA.adA1,
              applied_version: 2,
              desired_version: 2,
              active_url_version: 2,
            },
          ];
        }
        if (
          sql.includes("FROM tracking_link_offers") &&
          sql.includes("count(*)")
        ) {
          return [{ n: 1 }];
        }
        if (sql.includes("FROM tracking_link_offers tlo")) {
          return [
            {
              id: TenantA.trackingLinkOffer,
              tenant_id: TenantA.id,
              tracking_link_id: TenantA.trackingA,
              offer_id: TenantA.offerA,
              priority: 10,
              is_fallback: false,
              tracking_public_id: "trk_demo_001",
            },
          ];
        }
        return [];
      },
    });
    expect(evaluateSeededRestoreDepth(snap).status).toBe("passed");
  });

  it("assertSeededRestoreDepth returns result when passing", () => {
    const result = assertSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot()
    );
    expect(result.status).toBe("passed");
    expect(result.passedCount).toBe(19);
  });

  it("export helper keeps expected tracking ids stable", () => {
    expect(EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A).toEqual([
      "trk_demo_001",
      "trk_demo_002",
      "trk_demo_003",
    ]);
  });
});

describe("Phase 13.4 Track B D12–D21", () => {
  it("D12 fails when Tenant A SI missing", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        scriptIntegrationCountTenantA: 0,
        scriptIntegrationA: null,
      })
    );
    expect(result.assertions.find((a) => a.id === "D12")?.status).toBe("failed");
    expect(result.status).toBe("failed");
  });

  it("D13 fails on wrong tokenPrefix", () => {
    const base = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        scriptIntegrationA: {
          ...base.scriptIntegrationA!,
          tokenPrefix: "wrong",
        },
      })
    );
    expect(result.assertions.find((a) => a.id === "D13")?.status).toBe("failed");
  });

  it("D14 fails on wrong googleAccountId", () => {
    const base = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        scriptIntegrationA: {
          ...base.scriptIntegrationA!,
          googleAccountId: TenantB.account,
        },
      })
    );
    expect(result.assertions.find((a) => a.id === "D14")?.status).toBe("failed");
  });

  it("D15 fails when Tenant B SI missing", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        scriptIntegrationCountTenantB: 0,
      })
    );
    expect(result.assertions.find((a) => a.id === "D15")?.status).toBe("failed");
  });

  it("D16 fails when appliedVersion mismatches ACTIVE UrlVersion", () => {
    const base = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        scriptSyncTargetA: {
          ...base.scriptSyncTargetA!,
          appliedVersion: 99,
          activeUrlVersion: 2,
        },
      })
    );
    expect(result.assertions.find((a) => a.id === "D16")?.status).toBe("failed");
  });

  it("D17 fails when desiredVersion diverges from ACTIVE authority", () => {
    const base = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        scriptSyncTargetA: {
          ...base.scriptSyncTargetA!,
          desiredVersion: 99,
          appliedVersion: 2,
          activeUrlVersion: 2,
        },
      })
    );
    expect(result.assertions.find((a) => a.id === "D17")?.status).toBe("failed");
  });

  it("D18 fails when Tenant A TLO count wrong", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ tloCountTenantA: 0, tloA: null })
    );
    expect(result.assertions.find((a) => a.id === "D18")?.status).toBe("failed");
  });

  it("D19 fails on wrong tracking publicId", () => {
    const base = buildPassingSeededRestoreDepthSnapshot();
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({
        tloA: { ...base.tloA!, trackingPublicId: "trk_wrong" },
      })
    );
    expect(result.assertions.find((a) => a.id === "D19")?.status).toBe("failed");
  });

  it("D20 fails when Tenant B TLO missing", () => {
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot({ tloCountTenantB: 0 })
    );
    expect(result.assertions.find((a) => a.id === "D20")?.status).toBe("failed");
  });

  it("D21 fails when Track B fields differ source vs restore", () => {
    const source = buildPassingSeededRestoreDepthSnapshot();
    const restore = buildPassingSeededRestoreDepthSnapshot({
      scriptIntegrationCountTenantA: 0,
    });
    const d21 = compareSeededRestoreDepthExtendedSnapshots(source, restore);
    expect(d21.status).toBe("failed");
    const full = evaluateSeededRestoreDepthWithSourceCompare(source, restore);
    expect(full.assertions.find((a) => a.id === "D21")?.status).toBe("failed");
    expect(full.status).toBe("failed");
  });

  it("D11 ignores Track B field changes (frozen semantics)", () => {
    const source = buildPassingSeededRestoreDepthSnapshot();
    const changed = buildPassingSeededRestoreDepthSnapshot({
      scriptIntegrationCountTenantA: 99,
    });
    expect(compareSeededRestoreDepthSnapshots(source, changed).status).toBe(
      "passed"
    );
    expect(
      compareSeededRestoreDepthExtendedSnapshots(source, changed).status
    ).toBe("failed");
  });

  it("D10 remains 3 on passing snapshot", () => {
    const snap = buildPassingSeededRestoreDepthSnapshot();
    expect(snap.activeUrlVersionCount).toBe(3);
    expect(
      evaluateSeededRestoreDepth(snap).assertions.find((a) => a.id === "D10")
        ?.status
    ).toBe("passed");
  });

  it("D12–D20 failure fail-closes via assertSeededRestoreDepth", () => {
    const snap = buildPassingSeededRestoreDepthSnapshot({
      scriptIntegrationCountTenantA: 0,
    });
    try {
      assertSeededRestoreDepth(snap);
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupError);
      expect((error as BackupError).code).toBe("DEPTH_ASSERTION_FAILED");
    }
  });
});

describe("Phase 12.2-A does not alter shallow dataVerification contract", () => {
  it("documents that depth result is separate from dataVerification passed", () => {
    // Structural guard: SeededRestoreDepthResult uses `status`, not dataVerification.
    const result = evaluateSeededRestoreDepth(
      buildPassingSeededRestoreDepthSnapshot()
    );
    expect(result).toHaveProperty("status", "passed");
    expect(result).not.toHaveProperty("dataVerification");
    const snap: SeededRestoreDepthSnapshot =
      buildPassingSeededRestoreDepthSnapshot();
    expect(snap.activeUrlVersionCount).toBe(3);
  });
});
