/**
 * Phase 12.2-A — Seeded restore depth assertions (Phase 1.3 fixture contract).
 * Phase 13.4 Track B — D12–D21 Script Integration + tracking_link_offers depth.
 *
 * Operates only against an explicitly supplied target (queryFn or connectionString).
 * Does not read DATABASE_URL, seed, migrate, restore, or mutate databases.
 *
 * Layer 4 only — must NOT be conflated with restoreVerify `dataVerification: "passed"`
 * (which remains shallow: tenantCount > 0).
 *
 * D1–D11 semantics are frozen. D10 remains fixture-specific ACTIVE UrlVersion count === 3.
 */
import { Client } from "pg";
import {
  FIXTURE_SI_TOKEN_A,
  TenantA,
  TenantB,
} from "../fixtures/ids.js";
import { BackupError } from "./types.js";
import { redactConnectionString } from "./safety.js";

/** Fixture contract version — ACTIVE UrlVersion count === 3 is fixture-specific. */
export const SEEDED_RESTORE_DEPTH_FIXTURE_VERSION = "phase-1.3" as const;

export const EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A = [
  "trk_demo_001",
  "trk_demo_002",
  "trk_demo_003",
] as const;

/** Phase 1.3 fixture: exactly three ACTIVE UrlVersions in the seeded dataset. */
export const EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3 = 3;

/** Phase 13.4 Track B: Tenant A Script Integration count. */
export const EXPECTED_SCRIPT_INTEGRATION_COUNT_TENANT_A = 1;

/** Phase 13.4 Track B: Tenant A tracking_link_offers count. */
export const EXPECTED_TLO_COUNT_TENANT_A = 1;

export type SeededDepthAssertionId =
  | "D1"
  | "D2"
  | "D3"
  | "D4"
  | "D5"
  | "D6"
  | "D7"
  | "D8"
  | "D9"
  | "D10"
  | "D11"
  | "D12"
  | "D13"
  | "D14"
  | "D15"
  | "D16"
  | "D17"
  | "D18"
  | "D19"
  | "D20"
  | "D21";

export type SeededDepthAssertionStatus = "passed" | "failed";

export interface SeededDepthAssertionResult {
  id: SeededDepthAssertionId;
  status: SeededDepthAssertionStatus;
  expected: unknown;
  actual: unknown;
  message?: string;
}

export interface SeededRestoreDepthResult {
  status: "passed" | "failed";
  fixtureVersion: typeof SEEDED_RESTORE_DEPTH_FIXTURE_VERSION;
  assertions: SeededDepthAssertionResult[];
  passedCount: number;
  failedCount: number;
}

export interface Order001ChainSnapshot {
  orderId: string;
  tenantId: string;
  clickId: string;
  trackingPublicId: string;
}

/** Phase 13.4 Track B — Script Integration identity (no plaintext token). */
export interface ScriptIntegrationDepthSnapshot {
  id: string;
  tenantId: string;
  googleAccountId: string;
  tokenPrefix: string;
  status: string;
  /** Deterministic fixture hash — never a live secret. */
  tokenHash: string;
}

export interface ScriptSyncTargetDepthSnapshot {
  id: string;
  tenantId: string;
  integrationId: string;
  entityType: string;
  entityId: string;
  appliedVersion: number | null;
  /** Cache/projection only — not Desired Authority. */
  desiredVersion: number | null;
  /** ACTIVE UrlVersion.version for the target entity (Desired Authority). */
  activeUrlVersion: number | null;
}

export interface TrackingLinkOfferDepthSnapshot {
  id: string;
  tenantId: string;
  trackingLinkId: string;
  offerId: string;
  trackingPublicId: string;
  priority: number;
  isFallback: boolean;
}

/**
 * Structured depth snapshot — D1–D11 base fields frozen; Track B fields additive.
 */
export interface SeededRestoreDepthSnapshot {
  tenantCount: number;
  tenantIds: string[];
  campaignCountTenantA: number;
  trackingPublicIdsTenantA: string[];
  /** Null when ORDER-001 JOIN chain is missing. */
  order001: Order001ChainSnapshot | null;
  order001TenantId: string | null;
  order001TrackingPublicId: string | null;
  tenantBClickCount: number;
  /**
   * Fixture-specific: Phase 1.3 seed yields exactly 3 ACTIVE UrlVersions.
   * Not a general production business rule.
   */
  activeUrlVersionCount: number;
  activeUrlVersionUniquenessViolations: number;
  /** Phase 13.4 Track B — Script Integration / TLO (additive; not part of D11 keys). */
  scriptIntegrationCountTenantA: number;
  scriptIntegrationA: ScriptIntegrationDepthSnapshot | null;
  scriptIntegrationCountTenantB: number;
  scriptSyncTargetA: ScriptSyncTargetDepthSnapshot | null;
  tloCountTenantA: number;
  tloA: TrackingLinkOfferDepthSnapshot | null;
  tloCountTenantB: number;
}

export type SeededDepthQueryFn = (
  sql: string,
  params?: unknown[]
) => Promise<Record<string, unknown>[]>;

export interface SnapshotSeededRestoreDepthOptions {
  /**
   * Explicit query function against the target DB.
   * Prefer this in unit tests.
   */
  queryFn?: SeededDepthQueryFn;
  /**
   * Explicit connection string for the target DB only.
   * Must be supplied by the caller — never read from process.env.DATABASE_URL.
   */
  connectionString?: string;
}

function pass(
  id: SeededDepthAssertionId,
  expected: unknown,
  actual: unknown
): SeededDepthAssertionResult {
  return { id, status: "passed", expected, actual };
}

function fail(
  id: SeededDepthAssertionId,
  expected: unknown,
  actual: unknown,
  message: string
): SeededDepthAssertionResult {
  return { id, status: "failed", expected, actual, message };
}

function summarize(assertions: SeededDepthAssertionResult[]): SeededRestoreDepthResult {
  const passedCount = assertions.filter((a) => a.status === "passed").length;
  const failedCount = assertions.filter((a) => a.status === "failed").length;
  return {
    status: failedCount === 0 ? "passed" : "failed",
    fixtureVersion: SEEDED_RESTORE_DEPTH_FIXTURE_VERSION,
    assertions,
    passedCount,
    failedCount,
  };
}

function mapDepthErrorCode(
  failed: SeededDepthAssertionResult[]
): string {
  const ids = new Set(failed.map((f) => f.id));
  if (ids.has("D2") || (ids.has("D1") && failed.some((f) => f.id === "D1"))) {
    const d2 = failed.find((f) => f.id === "D2");
    if (d2) return "DEPTH_FIXTURES_MISSING";
  }
  if (ids.has("D2")) return "DEPTH_FIXTURES_MISSING";
  if (ids.has("D6") || ids.has("D3") || ids.has("D8")) return "DEPTH_TENANT_MISMATCH";
  if (ids.has("D5") || ids.has("D7")) return "DEPTH_ATTRIBUTION_MISMATCH";
  if (ids.has("D9") || ids.has("D10")) return "DEPTH_URL_VERSION_MISMATCH";
  if (
    ids.has("D12") ||
    ids.has("D13") ||
    ids.has("D14") ||
    ids.has("D15") ||
    ids.has("D16") ||
    ids.has("D17") ||
    ids.has("D18") ||
    ids.has("D19") ||
    ids.has("D20") ||
    ids.has("D21")
  ) {
    return "DEPTH_ASSERTION_FAILED";
  }
  return "DEPTH_ASSERTION_FAILED";
}

/**
 * Evaluate D1–D10 + D12–D20 against a snapshot (no DB access).
 * D11 / D21 require source vs restore compare (see evaluateSeededRestoreDepthWithSourceCompare).
 */
export function evaluateSeededRestoreDepth(
  snapshot: SeededRestoreDepthSnapshot
): SeededRestoreDepthResult {
  const assertions: SeededDepthAssertionResult[] = [];

  // D1
  assertions.push(
    snapshot.tenantCount === 2
      ? pass("D1", 2, snapshot.tenantCount)
      : fail("D1", 2, snapshot.tenantCount, "tenantCount must be 2 for Phase 1.3 fixtures")
  );

  // D2
  const hasA = snapshot.tenantIds.includes(TenantA.id);
  const hasB = snapshot.tenantIds.includes(TenantB.id);
  assertions.push(
    hasA && hasB
      ? pass("D2", [TenantA.id, TenantB.id], snapshot.tenantIds)
      : fail(
          "D2",
          [TenantA.id, TenantB.id],
          snapshot.tenantIds,
          "fixture Tenant A and Tenant B IDs must both be present"
        )
  );

  // D3
  assertions.push(
    snapshot.campaignCountTenantA === 2
      ? pass("D3", 2, snapshot.campaignCountTenantA)
      : fail(
          "D3",
          2,
          snapshot.campaignCountTenantA,
          "Tenant A campaign count must be 2"
        )
  );

  // D4
  const expectedLinks = [...EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A];
  const linksOk =
    snapshot.trackingPublicIdsTenantA.length === expectedLinks.length &&
    expectedLinks.every((id, i) => snapshot.trackingPublicIdsTenantA[i] === id);
  assertions.push(
    linksOk
      ? pass("D4", expectedLinks, snapshot.trackingPublicIdsTenantA)
      : fail(
          "D4",
          expectedLinks,
          snapshot.trackingPublicIdsTenantA,
          "Tenant A tracking publicIds must exactly match Phase 1.3 fixtures"
        )
  );

  // D5
  assertions.push(
    snapshot.order001 !== null && snapshot.order001.orderId === "ORDER-001"
      ? pass("D5", "ORDER-001 chain", snapshot.order001)
      : fail("D5", "ORDER-001 chain", snapshot.order001, "ORDER-001 attribution JOIN chain missing")
  );

  // D6
  assertions.push(
    snapshot.order001TenantId === TenantA.id
      ? pass("D6", TenantA.id, snapshot.order001TenantId)
      : fail(
          "D6",
          TenantA.id,
          snapshot.order001TenantId,
          "ORDER-001 must belong to Tenant A"
        )
  );

  // D7 — explicit publicId (not merely JOIN existence)
  assertions.push(
    snapshot.order001TrackingPublicId === "trk_demo_001"
      ? pass("D7", "trk_demo_001", snapshot.order001TrackingPublicId)
      : fail(
          "D7",
          "trk_demo_001",
          snapshot.order001TrackingPublicId,
          "ORDER-001 chain must resolve to tracking publicId trk_demo_001"
        )
  );

  // D8
  assertions.push(
    snapshot.tenantBClickCount >= 1
      ? pass("D8", ">=1", snapshot.tenantBClickCount)
      : fail("D8", ">=1", snapshot.tenantBClickCount, "Tenant B must have at least one click")
  );

  // D9
  assertions.push(
    snapshot.activeUrlVersionUniquenessViolations === 0
      ? pass("D9", 0, snapshot.activeUrlVersionUniquenessViolations)
      : fail(
          "D9",
          0,
          snapshot.activeUrlVersionUniquenessViolations,
          "ACTIVE UrlVersion uniqueness violations must be 0"
        )
  );

  // D10 — Phase 1.3 fixture contract only (not a production business rule)
  assertions.push(
    snapshot.activeUrlVersionCount === EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3
      ? pass(
          "D10",
          EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
          snapshot.activeUrlVersionCount
        )
      : fail(
          "D10",
          EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
          snapshot.activeUrlVersionCount,
          "Phase 1.3 fixture contract: ACTIVE UrlVersion count must be exactly 3"
        )
  );

  // --- Phase 13.4 Track B: D12–D20 ---

  // D12 — Script Integration existence (Tenant A)
  assertions.push(
    snapshot.scriptIntegrationCountTenantA === EXPECTED_SCRIPT_INTEGRATION_COUNT_TENANT_A
      ? pass(
          "D12",
          EXPECTED_SCRIPT_INTEGRATION_COUNT_TENANT_A,
          snapshot.scriptIntegrationCountTenantA
        )
      : fail(
          "D12",
          EXPECTED_SCRIPT_INTEGRATION_COUNT_TENANT_A,
          snapshot.scriptIntegrationCountTenantA,
          "Tenant A Script Integration count must be 1"
        )
  );

  // D13 — Script Integration identity (no secret output)
  const siA = snapshot.scriptIntegrationA;
  const d13Ok =
    siA !== null &&
    siA.id === TenantA.scriptIntegration &&
    siA.tenantId === TenantA.id &&
    siA.tokenPrefix === FIXTURE_SI_TOKEN_A.tokenPrefix &&
    siA.status === "ACTIVE";
  assertions.push(
    d13Ok
      ? pass(
          "D13",
          {
            id: TenantA.scriptIntegration,
            tenantId: TenantA.id,
            tokenPrefix: FIXTURE_SI_TOKEN_A.tokenPrefix,
            status: "ACTIVE",
          },
          {
            id: siA?.id,
            tenantId: siA?.tenantId,
            tokenPrefix: siA?.tokenPrefix,
            status: siA?.status,
          }
        )
      : fail(
          "D13",
          {
            id: TenantA.scriptIntegration,
            tenantId: TenantA.id,
            tokenPrefix: FIXTURE_SI_TOKEN_A.tokenPrefix,
            status: "ACTIVE",
          },
          siA
            ? {
                id: siA.id,
                tenantId: siA.tenantId,
                tokenPrefix: siA.tokenPrefix,
                status: siA.status,
              }
            : null,
          "Tenant A Script Integration identity mismatch"
        )
  );

  // D14 — Integration → GoogleAccount JOIN (same tenant, expected account)
  const d14Ok =
    siA !== null &&
    siA.googleAccountId === TenantA.account &&
    siA.tenantId === TenantA.id;
  assertions.push(
    d14Ok
      ? pass(
          "D14",
          { googleAccountId: TenantA.account, tenantId: TenantA.id },
          {
            googleAccountId: siA?.googleAccountId,
            tenantId: siA?.tenantId,
          }
        )
      : fail(
          "D14",
          { googleAccountId: TenantA.account, tenantId: TenantA.id },
          siA
            ? {
                googleAccountId: siA.googleAccountId,
                tenantId: siA.tenantId,
              }
            : null,
          "Script Integration must JOIN Tenant A GoogleAccount"
        )
  );

  // D15 — Script Integration tenant isolation
  const d15Ok =
    snapshot.scriptIntegrationCountTenantB >= 1 &&
    (siA === null || siA.tenantId === TenantA.id) &&
    snapshot.scriptIntegrationCountTenantA === 1;
  assertions.push(
    d15Ok
      ? pass(
          "D15",
          { tenantA: 1, tenantB: ">=1", noCrossTenant: true },
          {
            tenantA: snapshot.scriptIntegrationCountTenantA,
            tenantB: snapshot.scriptIntegrationCountTenantB,
          }
        )
      : fail(
          "D15",
          { tenantA: 1, tenantB: ">=1" },
          {
            tenantA: snapshot.scriptIntegrationCountTenantA,
            tenantB: snapshot.scriptIntegrationCountTenantB,
          },
          "Tenant A SI query must not include Tenant B; Tenant B SI must exist"
        )
  );

  // D16 — ScriptSyncTarget integrity + appliedVersion ↔ ACTIVE UrlVersion
  const stA = snapshot.scriptSyncTargetA;
  const d16Ok =
    stA !== null &&
    stA.id === TenantA.scriptSyncTarget &&
    stA.integrationId === TenantA.scriptIntegration &&
    stA.entityType === "AD" &&
    stA.entityId === TenantA.adA1 &&
    stA.tenantId === TenantA.id &&
    stA.appliedVersion === 2 &&
    stA.activeUrlVersion === 2;
  assertions.push(
    d16Ok
      ? pass(
          "D16",
          {
            id: TenantA.scriptSyncTarget,
            integrationId: TenantA.scriptIntegration,
            entityType: "AD",
            entityId: TenantA.adA1,
            appliedVersion: 2,
            activeUrlVersion: 2,
          },
          stA
        )
      : fail(
          "D16",
          {
            id: TenantA.scriptSyncTarget,
            integrationId: TenantA.scriptIntegration,
            entityType: "AD",
            entityId: TenantA.adA1,
            appliedVersion: 2,
            activeUrlVersion: 2,
          },
          stA,
          "ScriptSyncTarget must match fixture Ad + ACTIVE UrlVersion appliedVersion"
        )
  );

  // D17 — Desired-authority hygiene: ACTIVE UrlVersion is sole Desired Authority
  const d17Ok =
    snapshot.activeUrlVersionCount === EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3 &&
    stA !== null &&
    stA.activeUrlVersion === stA.appliedVersion &&
    (stA.desiredVersion === null ||
      stA.desiredVersion === undefined ||
      stA.desiredVersion === stA.activeUrlVersion);
  assertions.push(
    d17Ok
      ? pass(
          "D17",
          {
            activeUrlVersionAuthority: true,
            desiredVersionIsCacheOnly: true,
            activeUrlVersionCount: 3,
          },
          {
            activeUrlVersion: stA?.activeUrlVersion,
            appliedVersion: stA?.appliedVersion,
            desiredVersion: stA?.desiredVersion ?? null,
            activeUrlVersionCount: snapshot.activeUrlVersionCount,
          }
        )
      : fail(
          "D17",
          {
            activeUrlVersionAuthority: true,
            desiredVersionIsCacheOnly: true,
          },
          {
            activeUrlVersion: stA?.activeUrlVersion,
            appliedVersion: stA?.appliedVersion,
            desiredVersion: stA?.desiredVersion ?? null,
            activeUrlVersionCount: snapshot.activeUrlVersionCount,
          },
          "ACTIVE UrlVersion must remain sole Desired Authority; target.desiredVersion is cache only"
        )
  );

  // D18 — tracking_link_offers existence (Tenant A)
  assertions.push(
    snapshot.tloCountTenantA === EXPECTED_TLO_COUNT_TENANT_A
      ? pass("D18", EXPECTED_TLO_COUNT_TENANT_A, snapshot.tloCountTenantA)
      : fail(
          "D18",
          EXPECTED_TLO_COUNT_TENANT_A,
          snapshot.tloCountTenantA,
          "Tenant A tracking_link_offers count must be exactly 1"
        )
  );

  // D19 — TLO relationship integrity
  const tloA = snapshot.tloA;
  const d19Ok =
    tloA !== null &&
    tloA.id === TenantA.trackingLinkOffer &&
    tloA.tenantId === TenantA.id &&
    tloA.trackingLinkId === TenantA.trackingA &&
    tloA.offerId === TenantA.offerA &&
    tloA.trackingPublicId === "trk_demo_001";
  assertions.push(
    d19Ok
      ? pass(
          "D19",
          {
            trackingPublicId: "trk_demo_001",
            offerId: TenantA.offerA,
            tenantId: TenantA.id,
          },
          tloA
        )
      : fail(
          "D19",
          {
            trackingPublicId: "trk_demo_001",
            offerId: TenantA.offerA,
            tenantId: TenantA.id,
          },
          tloA,
          "TLO must JOIN Tenant A tracking_links + offers with matching tenantId"
        )
  );

  // D20 — TLO tenant isolation
  const d20Ok =
    snapshot.tloCountTenantB >= 1 &&
    snapshot.tloCountTenantA === EXPECTED_TLO_COUNT_TENANT_A &&
    (tloA === null || tloA.tenantId === TenantA.id);
  assertions.push(
    d20Ok
      ? pass(
          "D20",
          { tenantA: 1, tenantB: ">=1", noCrossTenant: true },
          {
            tenantA: snapshot.tloCountTenantA,
            tenantB: snapshot.tloCountTenantB,
          }
        )
      : fail(
          "D20",
          { tenantA: 1, tenantB: ">=1" },
          {
            tenantA: snapshot.tloCountTenantA,
            tenantB: snapshot.tloCountTenantB,
          },
          "Tenant A TLO query must not include Tenant B; Tenant B TLO must exist"
        )
  );

  return summarize(assertions);
}

/**
 * Assert D1–D10 + D12–D20; throws BackupError when any assertion fails.
 * Returns the structured result when all pass.
 */
export function assertSeededRestoreDepth(
  snapshot: SeededRestoreDepthSnapshot
): SeededRestoreDepthResult {
  const result = evaluateSeededRestoreDepth(snapshot);
  if (result.status === "passed") return result;

  const failed = result.assertions.filter((a) => a.status === "failed");
  const code = mapDepthErrorCode(failed);
  const detail = failed
    .map(
      (f) =>
        `${f.id}: expected=${JSON.stringify(f.expected)} actual=${JSON.stringify(f.actual)}`
    )
    .join("; ");
  throw new BackupError(
    code,
    redactConnectionString(
      `Seeded restore depth failed (${failed.map((f) => f.id).join(",")}): ${detail}`
    )
  );
}

/** Depth fields compared for D11 (source unchanged) — FROZEN; do not add Track B keys. */
const D11_COMPARE_KEYS: (keyof SeededRestoreDepthSnapshot)[] = [
  "tenantCount",
  "tenantIds",
  "campaignCountTenantA",
  "trackingPublicIdsTenantA",
  "order001",
  "order001TenantId",
  "order001TrackingPublicId",
  "tenantBClickCount",
  "activeUrlVersionCount",
  "activeUrlVersionUniquenessViolations",
];

/** Phase 13.4 Track B — extended snapshot keys for D21 restore value preservation. */
const D21_COMPARE_KEYS: (keyof SeededRestoreDepthSnapshot)[] = [
  "scriptIntegrationCountTenantA",
  "scriptIntegrationA",
  "scriptIntegrationCountTenantB",
  "scriptSyncTargetA",
  "tloCountTenantA",
  "tloA",
  "tloCountTenantB",
];

/**
 * D11 — compare two snapshots supplied by the caller (no implicit DB access).
 * Compares only frozen D1–D10 field set — Track B fields are intentionally excluded.
 */
export function compareSeededRestoreDepthSnapshots(
  sourceSnapshot: SeededRestoreDepthSnapshot,
  restoreOrPostSourceSnapshot: SeededRestoreDepthSnapshot
): SeededDepthAssertionResult {
  const mismatches: string[] = [];
  for (const key of D11_COMPARE_KEYS) {
    const a = JSON.stringify(sourceSnapshot[key]);
    const b = JSON.stringify(restoreOrPostSourceSnapshot[key]);
    if (a !== b) mismatches.push(key);
  }
  if (mismatches.length === 0) {
    return pass("D11", "unchanged", "unchanged");
  }
  return fail(
    "D11",
    "identical depth fields",
    { mismatchedKeys: mismatches },
    `source depth snapshot differs on: ${mismatches.join(", ")}`
  );
}

/**
 * D21 — compare Track B extended snapshot fields (SI / TLO) source vs restore.
 */
export function compareSeededRestoreDepthExtendedSnapshots(
  sourceSnapshot: SeededRestoreDepthSnapshot,
  restoreSnapshot: SeededRestoreDepthSnapshot
): SeededDepthAssertionResult {
  const mismatches: string[] = [];
  for (const key of D21_COMPARE_KEYS) {
    const a = JSON.stringify(sourceSnapshot[key]);
    const b = JSON.stringify(restoreSnapshot[key]);
    if (a !== b) mismatches.push(key);
  }
  if (mismatches.length === 0) {
    return pass("D21", "unchanged", "unchanged");
  }
  return fail(
    "D21",
    "identical Track B depth fields",
    { mismatchedKeys: mismatches },
    `source vs restore Track B snapshot differs on: ${mismatches.join(", ")}`
  );
}

/**
 * Evaluate D11 + D21 and merge into a full D1–D21 result using the restore snapshot for D1–D10/D12–D20.
 */
export function evaluateSeededRestoreDepthWithSourceCompare(
  sourceSnapshot: SeededRestoreDepthSnapshot,
  restoreSnapshot: SeededRestoreDepthSnapshot
): SeededRestoreDepthResult {
  const base = evaluateSeededRestoreDepth(restoreSnapshot);
  const d11 = compareSeededRestoreDepthSnapshots(
    sourceSnapshot,
    restoreSnapshot
  );
  const d21 = compareSeededRestoreDepthExtendedSnapshots(
    sourceSnapshot,
    restoreSnapshot
  );
  return summarize([...base.assertions, d11, d21]);
}

/**
 * Load a depth snapshot from an explicitly supplied target.
 * Caller must pass queryFn or connectionString — never reads DATABASE_URL.
 */
export async function snapshotSeededRestoreDepth(
  options: SnapshotSeededRestoreDepthOptions
): Promise<SeededRestoreDepthSnapshot> {
  if (options.queryFn) {
    return loadSnapshot(options.queryFn);
  }
  if (!options.connectionString?.trim()) {
    throw new BackupError(
      "DEPTH_TARGET_REQUIRED",
      "snapshotSeededRestoreDepth requires explicit queryFn or connectionString (never reads DATABASE_URL)"
    );
  }
  const client = new Client({
    connectionString: options.connectionString.trim(),
  });
  await client.connect();
  try {
    const query: SeededDepthQueryFn = async (sql, params = []) => {
      const res = await client.query(sql, params);
      return res.rows as Record<string, unknown>[];
    };
    return await loadSnapshot(query);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function loadSnapshot(
  query: SeededDepthQueryFn
): Promise<SeededRestoreDepthSnapshot> {
  const tenants = await query(`SELECT id FROM tenants ORDER BY id`);
  const campaignsA = await query(
    `SELECT count(*)::int AS n FROM campaigns WHERE tenant_id = $1`,
    [TenantA.id]
  );
  const tracking = await query(
    `SELECT public_id FROM tracking_links WHERE tenant_id = $1 ORDER BY public_id`,
    [TenantA.id]
  );
  const orderRows = await query(
    `SELECT o.order_id AS order_id, o.tenant_id AS tenant_id, c.id AS click_id, t.public_id AS public_id
     FROM orders o
     JOIN conversions cv ON cv.id = o.conversion_id
     JOIN clicks c ON c.id = cv.click_id
     JOIN tracking_links t ON t.id = c.tracking_link_id
     WHERE o.order_id = 'ORDER-001'`
  );
  const activeViolations = await query(
    `SELECT tenant_id, entity_type, entity_id, count(*)::int AS n
     FROM url_versions WHERE status = 'ACTIVE'
     GROUP BY 1, 2, 3 HAVING count(*) <> 1`
  );
  const activeCount = await query(
    `SELECT count(*)::int AS n FROM url_versions WHERE status = 'ACTIVE'`
  );
  const clicksB = await query(
    `SELECT count(*)::int AS n FROM clicks WHERE tenant_id = $1`,
    [TenantB.id]
  );

  // Phase 13.4 Track B — Script Integration
  const siCountA = await query(
    `SELECT count(*)::int AS n FROM google_ads_script_integrations
     WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [TenantA.id]
  );
  const siCountB = await query(
    `SELECT count(*)::int AS n FROM google_ads_script_integrations
     WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [TenantB.id]
  );
  const siARows = await query(
    `SELECT si.id, si.tenant_id, si.google_account_id, si.token_prefix, si.status, si.token_hash
     FROM google_ads_script_integrations si
     JOIN google_accounts ga ON ga.id = si.google_account_id
     WHERE si.tenant_id = $1 AND si.id = $2 AND si.deleted_at IS NULL
       AND ga.tenant_id = si.tenant_id`,
    [TenantA.id, TenantA.scriptIntegration]
  );
  const stARows = await query(
    `SELECT st.id, st.tenant_id, st.integration_id, st.entity_type, st.entity_id,
            st.applied_version, st.desired_version,
            uv.version AS active_url_version
     FROM script_sync_targets st
     LEFT JOIN url_versions uv
       ON uv.tenant_id = st.tenant_id
      AND uv.entity_type = st.entity_type
      AND uv.entity_id = st.entity_id
      AND uv.status = 'ACTIVE'
     WHERE st.tenant_id = $1 AND st.id = $2 AND st.deleted_at IS NULL`,
    [TenantA.id, TenantA.scriptSyncTarget]
  );

  // Phase 13.4 Track B — tracking_link_offers
  const tloCountA = await query(
    `SELECT count(*)::int AS n FROM tracking_link_offers WHERE tenant_id = $1`,
    [TenantA.id]
  );
  const tloCountB = await query(
    `SELECT count(*)::int AS n FROM tracking_link_offers WHERE tenant_id = $1`,
    [TenantB.id]
  );
  const tloARows = await query(
    `SELECT tlo.id, tlo.tenant_id, tlo.tracking_link_id, tlo.offer_id,
            tlo.priority, tlo.is_fallback, tl.public_id AS tracking_public_id
     FROM tracking_link_offers tlo
     JOIN tracking_links tl ON tl.id = tlo.tracking_link_id
     JOIN offers o ON o.id = tlo.offer_id
     WHERE tlo.tenant_id = $1 AND tlo.id = $2
       AND tl.tenant_id = tlo.tenant_id
       AND o.tenant_id = tlo.tenant_id`,
    [TenantA.id, TenantA.trackingLinkOffer]
  );

  const orderRow = orderRows[0];
  const order001: Order001ChainSnapshot | null = orderRow
    ? {
        orderId: String(orderRow.order_id),
        tenantId: String(orderRow.tenant_id),
        clickId: String(orderRow.click_id),
        trackingPublicId: String(orderRow.public_id),
      }
    : null;

  const siRow = siARows[0];
  const scriptIntegrationA: ScriptIntegrationDepthSnapshot | null = siRow
    ? {
        id: String(siRow.id),
        tenantId: String(siRow.tenant_id),
        googleAccountId: String(siRow.google_account_id),
        tokenPrefix: String(siRow.token_prefix),
        status: String(siRow.status),
        tokenHash: String(siRow.token_hash),
      }
    : null;

  const stRow = stARows[0];
  const scriptSyncTargetA: ScriptSyncTargetDepthSnapshot | null = stRow
    ? {
        id: String(stRow.id),
        tenantId: String(stRow.tenant_id),
        integrationId: String(stRow.integration_id),
        entityType: String(stRow.entity_type),
        entityId: String(stRow.entity_id),
        appliedVersion:
          stRow.applied_version === null || stRow.applied_version === undefined
            ? null
            : Number(stRow.applied_version),
        desiredVersion:
          stRow.desired_version === null || stRow.desired_version === undefined
            ? null
            : Number(stRow.desired_version),
        activeUrlVersion:
          stRow.active_url_version === null ||
          stRow.active_url_version === undefined
            ? null
            : Number(stRow.active_url_version),
      }
    : null;

  const tloRow = tloARows[0];
  const tloA: TrackingLinkOfferDepthSnapshot | null = tloRow
    ? {
        id: String(tloRow.id),
        tenantId: String(tloRow.tenant_id),
        trackingLinkId: String(tloRow.tracking_link_id),
        offerId: String(tloRow.offer_id),
        trackingPublicId: String(tloRow.tracking_public_id),
        priority: Number(tloRow.priority),
        isFallback: Boolean(tloRow.is_fallback),
      }
    : null;

  return {
    tenantCount: tenants.length,
    tenantIds: tenants.map((t) => String(t.id)),
    campaignCountTenantA: Number(campaignsA[0]?.n ?? 0),
    trackingPublicIdsTenantA: tracking.map((t) => String(t.public_id)),
    order001,
    order001TenantId: order001?.tenantId ?? null,
    order001TrackingPublicId: order001?.trackingPublicId ?? null,
    tenantBClickCount: Number(clicksB[0]?.n ?? 0),
    activeUrlVersionCount: Number(activeCount[0]?.n ?? 0),
    activeUrlVersionUniquenessViolations: activeViolations.length,
    scriptIntegrationCountTenantA: Number(siCountA[0]?.n ?? 0),
    scriptIntegrationA,
    scriptIntegrationCountTenantB: Number(siCountB[0]?.n ?? 0),
    scriptSyncTargetA,
    tloCountTenantA: Number(tloCountA[0]?.n ?? 0),
    tloA,
    tloCountTenantB: Number(tloCountB[0]?.n ?? 0),
  };
}

/** Build a valid Phase 1.3 + Track B-shaped snapshot for unit tests. */
export function buildPassingSeededRestoreDepthSnapshot(
  overrides: Partial<SeededRestoreDepthSnapshot> = {}
): SeededRestoreDepthSnapshot {
  return {
    tenantCount: 2,
    tenantIds: [TenantA.id, TenantB.id],
    campaignCountTenantA: 2,
    trackingPublicIdsTenantA: [...EXPECTED_TRACKING_PUBLIC_IDS_TENANT_A],
    order001: {
      orderId: "ORDER-001",
      tenantId: TenantA.id,
      clickId: TenantA.click1,
      trackingPublicId: "trk_demo_001",
    },
    order001TenantId: TenantA.id,
    order001TrackingPublicId: "trk_demo_001",
    tenantBClickCount: 1,
    activeUrlVersionCount: EXPECTED_ACTIVE_URL_VERSION_COUNT_PHASE_1_3,
    activeUrlVersionUniquenessViolations: 0,
    scriptIntegrationCountTenantA: EXPECTED_SCRIPT_INTEGRATION_COUNT_TENANT_A,
    scriptIntegrationA: {
      id: TenantA.scriptIntegration,
      tenantId: TenantA.id,
      googleAccountId: TenantA.account,
      tokenPrefix: FIXTURE_SI_TOKEN_A.tokenPrefix,
      status: "ACTIVE",
      tokenHash: FIXTURE_SI_TOKEN_A.tokenHash,
    },
    scriptIntegrationCountTenantB: 1,
    scriptSyncTargetA: {
      id: TenantA.scriptSyncTarget,
      tenantId: TenantA.id,
      integrationId: TenantA.scriptIntegration,
      entityType: "AD",
      entityId: TenantA.adA1,
      appliedVersion: 2,
      desiredVersion: 2,
      activeUrlVersion: 2,
    },
    tloCountTenantA: EXPECTED_TLO_COUNT_TENANT_A,
    tloA: {
      id: TenantA.trackingLinkOffer,
      tenantId: TenantA.id,
      trackingLinkId: TenantA.trackingA,
      offerId: TenantA.offerA,
      trackingPublicId: "trk_demo_001",
      priority: 10,
      isFallback: false,
    },
    tloCountTenantB: 1,
    ...overrides,
  };
}
