/**
 * Google Ads API — interface reservation (stub).
 *
 * The Google Ads API requires:
 * 1. Google Cloud project with Google Ads API enabled
 * 2. OAuth2 credentials (client ID + client secret + refresh token)
 * 3. Developer token (approved by Google, takes time)
 * 4. Customer ID (the Ads account to manage)
 *
 * Credential format (stored encrypted, JSON):
 * {
 *   "clientId": "...",
 *   "clientSecret": "...",
 *   "refreshToken": "...",
 *   "developerToken": "...",
 *   "customerId": "1234567890"
 * }
 *
 * API base: https://googleads.googleapis.com/v17/
 *
 * Status: STUB — interface reserved. Full implementation needs:
 * 1. `google-ads-api` npm package or direct REST calls
 * 2. OAuth2 flow for refresh token (user does this in Google Cloud Console)
 * 3. Developer token approval (apply at ads.google.com)
 *
 * Planned operations (when implemented):
 * - listCampaigns(customerId): list all campaigns
 * - pauseCampaign / enableCampaign
 * - updateCampaignBudget
 * - listAdGroups, pauseAd, etc.
 */

export interface GoogleAdsCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  customerId: string;
}

export interface GoogleAdsCampaign {
  id: string;
  name: string;
  status: "ENABLED" | "PAUSED" | "REMOVED";
  budgetAmountMicros: number;
  advertisingChannelType: string;
}

export class GoogleAdsApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleAdsApiError";
    this.code = code;
  }
}

export function parseGoogleAdsCredentials(json: string): GoogleAdsCredentials {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new GoogleAdsApiError("BAD_CREDENTIALS", "Google Ads credentials must be valid JSON");
  }
  const required = ["clientId", "clientSecret", "refreshToken", "developerToken", "customerId"];
  for (const k of required) {
    if (typeof obj[k] !== "string" || !(obj[k] as string).trim()) {
      throw new GoogleAdsApiError("BAD_CREDENTIALS", `Google Ads credentials missing: ${k}`);
    }
  }
  return obj as unknown as GoogleAdsCredentials;
}

/**
 * Stub client. All methods throw NOT_IMPLEMENTED until the real
 * Google Ads API integration is built (needs developer token approval).
 */
export class GoogleAdsClient {
  constructor(private creds: GoogleAdsCredentials) {
    void this.creds;
  }

  async listCampaigns(): Promise<GoogleAdsCampaign[]> {
    throw new GoogleAdsApiError(
      "NOT_IMPLEMENTED",
      "Google Ads API client is a stub — needs developer token + OAuth2 setup. " +
      "See this file's header for the credential requirements."
    );
  }

  async pauseCampaign(_campaignId: string): Promise<void> {
    throw new GoogleAdsApiError("NOT_IMPLEMENTED", "Google Ads API client is a stub");
  }

  async enableCampaign(_campaignId: string): Promise<void> {
    throw new GoogleAdsApiError("NOT_IMPLEMENTED", "Google Ads API client is a stub");
  }
}
