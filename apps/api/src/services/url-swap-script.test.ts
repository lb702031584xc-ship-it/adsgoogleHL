import { describe, expect, it } from "vitest";
import { buildUrlSwapAdsScript } from "./url-swap-script.js";

describe("buildUrlSwapAdsScript", () => {
  it("embeds auth code and gettemplate endpoint", () => {
    const script = buildUrlSwapAdsScript({
      apiBaseUrl: "https://adtlab.xyz",
      apiAuthCode: "test_auth_code",
    });
    expect(script).toContain(
      "https://adtlab.xyz/api/v1/url-swap/gettemplate?apiauthcode=test_auth_code&campaign_name="
    );
    expect(script).toContain("setTrackingTemplate");
    expect(script).toContain("MccApp");
  });
});
