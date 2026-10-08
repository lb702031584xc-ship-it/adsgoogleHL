/**
 * 功能1 — push-url-change Script source unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildPushUrlChangeScriptSource,
  PUSH_URL_CHANGE_SCRIPT_VERSION,
} from "./push-url-change-script-source.js";
import { assertScriptSourceSafe } from "./script-generator-source.js";

const BASE_PARAMS = {
  requestId: "11111111-1111-4111-8111-111111111111",
  googleAdIds: ["111222333", "444555666"],
  newUrl: "https://merchant.example/deal?promo=1",
  referralUrl: "https://referral.example/go?aff=123&sub=abc",
  deviceTarget: "all" as const,
};

describe("buildPushUrlChangeScriptSource", () => {
  it("embeds the task payload as a JSON literal", () => {
    const src = buildPushUrlChangeScriptSource(BASE_PARAMS);
    expect(src).toContain("var PUSH_URL_CHANGE_TASK =");
    expect(src).toContain(JSON.stringify(BASE_PARAMS.requestId));
    expect(src).toContain(JSON.stringify(BASE_PARAMS.newUrl));
    expect(src).toContain(JSON.stringify(BASE_PARAMS.referralUrl));
    expect(src).toContain(`Script version: ${PUSH_URL_CHANGE_SCRIPT_VERSION}`);
    expect(src).toContain("function main()");
  });

  it("documents deviceTarget semantics and referral merging", () => {
    const src = buildPushUrlChangeScriptSource(BASE_PARAMS);
    expect(src).toContain("deviceTarget semantics");
    expect(src).toContain("referralUrl");
    expect(src).toContain("setFinalUrl");
    expect(src).toContain("setMobileFinalUrl");
  });

  it("only addresses the given ad IDs and passes the static safety audit", () => {
    const src = buildPushUrlChangeScriptSource(BASE_PARAMS);
    // No cross-account / bulk selectors: ads are located by Id only.
    expect(src).toContain('withCondition(\'Id = "');
    expect(src).not.toContain("AdsApp.adGroups()");
    expect(src).not.toContain("AdsApp.campaigns()");
    expect(assertScriptSourceSafe(src)).toEqual([]);
  });

  it("omits referralUrl from the payload when not provided", () => {
    const src = buildPushUrlChangeScriptSource({
      ...BASE_PARAMS,
      referralUrl: null,
    });
    expect(src).toContain('"referralUrl":null');
  });

  it("rejects invalid params", () => {
    expect(() =>
      buildPushUrlChangeScriptSource({ ...BASE_PARAMS, requestId: " " })
    ).toThrow("requestId is required");
    expect(() =>
      buildPushUrlChangeScriptSource({ ...BASE_PARAMS, googleAdIds: [] })
    ).toThrow("googleAdIds must be a non-empty array");
    expect(() =>
      buildPushUrlChangeScriptSource({
        ...BASE_PARAMS,
        newUrl: "ftp://x.example",
      })
    ).toThrow("newUrl must be a valid http(s) URL");
    expect(() =>
      buildPushUrlChangeScriptSource({
        ...BASE_PARAMS,
        deviceTarget: "tv" as never,
      })
    ).toThrow('deviceTarget must be "desktop", "mobile" or "all"');
  });

  it("rejects javascript: payloads that would become code", () => {
    expect(() =>
      buildPushUrlChangeScriptSource({
        ...BASE_PARAMS,
        newUrl: "javascript:alert(1)",
      })
    ).toThrow("newUrl must be a valid http(s) URL");
  });
});
