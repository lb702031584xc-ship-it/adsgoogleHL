/**
 * AdsPower Local API client tests — fetch is fully mocked.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AdsPowerClient,
  AdsPowerError,
  ADSPOWER_DEFAULT_API_URL,
  resolveAdsPowerBaseUrl,
} from "./adspower.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(impl: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (url: string) => impl(url));
}

describe("AdsPowerClient", () => {
  it("defaults to http://localhost:50325 and honors ADSPOWER_API_URL", () => {
    expect(new AdsPowerClient().baseUrl).toBe(ADSPOWER_DEFAULT_API_URL);
    expect(
      new AdsPowerClient({ baseUrl: "http://127.0.0.1:50326/" }).baseUrl
    ).toBe("http://127.0.0.1:50326");
    expect(resolveAdsPowerBaseUrl({ ADSPOWER_API_URL: "http://x:1234" })).toBe(
      "http://x:1234"
    );
    expect(resolveAdsPowerBaseUrl({})).toBe(ADSPOWER_DEFAULT_API_URL);
  });

  it("listProfiles maps the user list", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain("/api/v1/user/list");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          list: [
            {
              user_id: "k11abc",
              name: "rakuten-01",
              group_name: "cashback",
              username: "u1",
              ip: "1.2.3.4",
            },
          ],
        },
      });
    });
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    const profiles = await client.listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      userId: "k11abc",
      name: "rakuten-01",
      groupName: "cashback",
    });
  });

  it("listProfiles returns [] when the list is empty", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ code: 0, msg: "success", data: { list: [] } })
    );
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    expect(await client.listProfiles()).toEqual([]);
  });

  it("openBrowser passes user_id and returns the session", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain("/api/v1/browser/start");
      expect(url).toContain("user_id=k11abc");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          debug_port: "9222",
          webdriver: "127.0.0.1:9515",
          ws: { selenium: "ws://s", puppeteer: "ws://p" },
        },
      });
    });
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    const session = await client.openBrowser("k11abc");
    expect(session).toMatchObject({
      userId: "k11abc",
      debugPort: 9222,
      webdriver: "127.0.0.1:9515",
      seleniumWs: "ws://s",
      puppeteerWs: "ws://p",
    });
  });

  it("openBrowser rejects an empty profileId with 400", async () => {
    const client = new AdsPowerClient({
      fetchImpl: mockFetch(() => jsonResponse({})),
    });
    await expect(client.openBrowser("  ")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("closeBrowser calls the stop endpoint", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain("/api/v1/browser/stop");
      expect(url).toContain("user_id=k11abc");
      return jsonResponse({ code: 0, msg: "success", data: {} });
    });
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    await expect(client.closeBrowser("k11abc")).resolves.toBeUndefined();
  });

  it("network failure (AdsPower not running) → friendly 503, never 500", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    const err = await client.listProfiles().catch((e) => e);
    expect(err).toBeInstanceOf(AdsPowerError);
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain("AdsPower 未启动");
  });

  it("non-zero AdsPower code → 502 with the API message", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ code: -1, msg: "user not found", data: null })
    );
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    const err = await client.openBrowser("nope").catch((e) => e);
    expect(err).toBeInstanceOf(AdsPowerError);
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain("user not found");
  });

  it("HTTP non-2xx → 502", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}, 500));
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    const err = await client.listProfiles().catch((e) => e);
    expect(err).toBeInstanceOf(AdsPowerError);
    expect(err.statusCode).toBe(502);
  });

  it("non-JSON body → 502", async () => {
    const fetchImpl = mockFetch(
      () => new Response("<html>not json</html>", { status: 200 })
    );
    const client = new AdsPowerClient({ fetchImpl: fetchImpl as typeof fetch });
    const err = await client.listProfiles().catch((e) => e);
    expect(err).toBeInstanceOf(AdsPowerError);
    expect(err.statusCode).toBe(502);
  });

  it("fromEnv builds a client from ADSPOWER_API_URL", () => {
    const client = AdsPowerClient.fromEnv({ ADSPOWER_API_URL: "http://x:9999" });
    expect(client.baseUrl).toBe("http://x:9999");
  });
});
