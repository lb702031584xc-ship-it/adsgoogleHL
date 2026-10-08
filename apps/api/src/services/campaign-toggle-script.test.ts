/**
 * campaign-toggle-script unit tests: payload builder + Ads Script snippet.
 */
import { describe, expect, it } from "vitest";
import {
  buildCampaignToggleScriptSource,
  buildCampaignToggleTaskPayload,
  campaignToggleIdempotencyKey,
  isCampaignToggleAction,
  CAMPAIGN_TOGGLE_IDEMPOTENCY_SCOPE,
  CAMPAIGN_TOGGLE_PROVIDER,
  CAMPAIGN_TOGGLE_TASK_TYPE,
} from "./campaign-toggle-script.js";
import { randomUUID } from "node:crypto";

describe("buildCampaignToggleTaskPayload", () => {
  it("builds the canonical task payload", () => {
    const taskId = randomUUID();
    const campaignId = randomUUID();
    const googleAccountId = randomUUID();
    const tenantId = randomUUID();
    const payload = buildCampaignToggleTaskPayload({
      taskId,
      campaignId,
      googleCampaignId: "123456789",
      action: "ENABLE",
      googleAccountId,
      tenantId,
      requestedBy: "user-1",
    });
    expect(payload.type).toBe(CAMPAIGN_TOGGLE_TASK_TYPE);
    expect(payload.version).toBe(1);
    expect(payload.taskId).toBe(taskId);
    expect(payload.campaignId).toBe(campaignId);
    expect(payload.googleCampaignId).toBe("123456789");
    expect(payload.action).toBe("ENABLE");
    expect(payload.googleAccountId).toBe(googleAccountId);
    expect(payload.tenantId).toBe(tenantId);
    expect(payload.requestedBy).toBe("user-1");
    expect(typeof payload.requestedAt).toBe("string");
    // No secrets in the payload.
    expect(JSON.stringify(payload)).not.toContain("token");
  });

  it("omits requestedBy when undefined (Prisma Json rejects undefined)", () => {
    const payload = buildCampaignToggleTaskPayload({
      taskId: randomUUID(),
      campaignId: randomUUID(),
      googleCampaignId: "1",
      action: "PAUSE",
      googleAccountId: randomUUID(),
      tenantId: randomUUID(),
    });
    expect("requestedBy" in payload).toBe(false);
    expect(() => JSON.parse(JSON.stringify(payload))).not.toThrow();
  });
});

describe("isCampaignToggleAction / idempotency", () => {
  it("accepts only ENABLE and PAUSE", () => {
    expect(isCampaignToggleAction("ENABLE")).toBe(true);
    expect(isCampaignToggleAction("PAUSE")).toBe(true);
    expect(isCampaignToggleAction("enable")).toBe(false);
    expect(isCampaignToggleAction("RESUME")).toBe(false);
    expect(isCampaignToggleAction(undefined)).toBe(false);
  });

  it("builds a stable per-(campaign, action) idempotency key", () => {
    const id = randomUUID();
    expect(campaignToggleIdempotencyKey(id, "ENABLE")).toBe(
      `toggle:${id}:ENABLE`
    );
    expect(campaignToggleIdempotencyKey(id, "PAUSE")).not.toBe(
      campaignToggleIdempotencyKey(id, "ENABLE")
    );
    expect(CAMPAIGN_TOGGLE_IDEMPOTENCY_SCOPE).toBe("CAMPAIGN_TOGGLE");
    expect(CAMPAIGN_TOGGLE_PROVIDER).toBe("google-ads-script");
  });
});

describe("buildCampaignToggleScriptSource", () => {
  const source = buildCampaignToggleScriptSource({
    tasksEndpoint: "https://api.example.com/api/v1/script/campaign-toggle-tasks",
    resultEndpoint:
      "https://api.example.com/api/v1/script/campaign-toggle-result",
    integrationId: "int-1",
    token: "secret-token",
  });

  it("looks up campaigns by single id only (safety iron rule)", () => {
    // Single-ID lookup via withIds — the only AdsApp.campaigns() access.
    expect(source).toContain("AdsApp.campaigns().withIds(");
    // Must never enumerate campaigns without an id filter.
    expect(source).not.toMatch(/AdsApp\.campaigns\(\)\s*\.get\(\)/);
    expect(source).not.toContain("campaigns().get()");
  });

  it("validates the campaign id before touching AdsApp", () => {
    expect(source).toContain("/^\\d+$/");
    expect(source).toContain("INVALID_CAMPAIGN_ID");
  });

  it("applies exactly ENABLE/PAUSE and rejects other actions", () => {
    expect(source).toContain("campaign.enable()");
    expect(source).toContain("campaign.pause()");
    expect(source).toContain("INVALID_ACTION");
  });

  it("fetches tasks and reports results to the given endpoints", () => {
    expect(source).toContain(
      "https://api.example.com/api/v1/script/campaign-toggle-tasks"
    );
    expect(source).toContain(
      "https://api.example.com/api/v1/script/campaign-toggle-result"
    );
    expect(source).toContain("campaign-toggle");
  });

  it("never logs tokens", () => {
    expect(source).not.toMatch(/Logger\.log\([^)]*token/i);
  });
});
