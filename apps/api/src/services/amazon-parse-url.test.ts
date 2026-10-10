import { describe, expect, it } from "vitest";
import { parseAmazonUrl } from "./amazon-parse-url.js";

describe("parseAmazonUrl", () => {
  it("从 /dp/ 链接提取 ASIN 和 slug 产品名", () => {
    const r = parseAmazonUrl(
      "https://www.amazon.com/CyberPower-CP850PFCLCD-PFC-Sinewave-UPS/dp/B0XXXXXXX1/ref=sr_1_1"
    );
    expect(r.asin).toBe("B0XXXXXXX1");
    expect(r.name).toBe("CyberPower CP850PFCLCD PFC Sinewave UPS");
    expect(r.nameSource).toBe("slug");
  });

  it("支持 /gp/product/ 形式", () => {
    const r = parseAmazonUrl("https://www.amazon.co.uk/gp/product/B07ABC1234");
    expect(r.asin).toBe("B07ABC1234");
  });

  it("无 slug 的短链接只出 ASIN", () => {
    const r = parseAmazonUrl("https://www.amazon.com/dp/B07ABC1234");
    expect(r.asin).toBe("B07ABC1234");
    expect(r.name).toBeNull();
    expect(r.nameSource).toBe("none");
  });

  it("非法输入返回空", () => {
    expect(parseAmazonUrl("")).toEqual({ asin: null, name: null, nameSource: "none" });
    expect(parseAmazonUrl("not a url")).toEqual({ asin: null, name: null, nameSource: "none" });
    expect(parseAmazonUrl("https://www.google.com/search?q=test")).toEqual({
      asin: null,
      name: null,
      nameSource: "none",
    });
  });
});
