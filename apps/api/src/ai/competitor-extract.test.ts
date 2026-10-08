/**
 * Lander Intel ② — competitor-extract unit tests (pure functions).
 */
import { describe, expect, it } from "vitest";
import {
  diffCompetitorSnapshots,
  diffIsEmpty,
  extractCompetitorFields,
  hashCompetitorSnapshot,
  type CompetitorSnapshot,
} from "./competitor-extract.js";

const ZH_HTML = `<!DOCTYPE html><html><head><title>超值跑鞋 - 限时优惠</title>
<style>.a{color:red}</style></head><body>
<h1>超轻透气跑鞋</h1>
<h2>为什么选择我们</h2>
<h2>用户评价</h2>
<p>原价 ¥899，现价 ¥499，限时优惠！</p>
<p>会员价 ¥399</p>
<p>再送价值 $29 的袜子</p>
<button>立即购买</button>
<a href="/t">免费试用 30 天</a>
<a href="/more">了解更多</a>
<a href="/x">立即购买</a>
<footer><a href="/privacy">隐私政策</a></footer>
</body></html>`;

const EN_HTML = `<!DOCTYPE html><html><head><title>Acme Shoes - 50% Off Today</title></head>
<body>
<h1>Run Faster, Run Lighter</h1>
<h2>Features</h2>
<p>Was $199.99, now $99.99. Or €89.99 in Europe.</p>
<button>Buy Now</button>
<a href="/s">Sign Up Free</a>
<a href="/s">Sign Up Free</a>
<a href="/c">Claim your discount</a>
<a href="/privacy">Privacy</a>
</body></html>`;

describe("extractCompetitorFields", () => {
  it("extracts title from <title>", () => {
    expect(extractCompetitorFields(ZH_HTML).title).toBe("超值跑鞋 - 限时优惠");
    expect(extractCompetitorFields(EN_HTML).title).toBe(
      "Acme Shoes - 50% Off Today"
    );
  });

  it("extracts up to 3 prices in match order", () => {
    const zh = extractCompetitorFields(ZH_HTML).price;
    expect(zh).toEqual(["¥899", "¥499", "¥399"]);
    const en = extractCompetitorFields(EN_HTML).price;
    expect(en).toEqual(["$199.99", "$99.99", "€89.99"]);
  });

  it("extracts CTA texts matching the keyword list, deduped, max 5", () => {
    const zh = extractCompetitorFields(ZH_HTML).cta;
    expect(zh).toEqual(["立即购买", "免费试用 30 天", "了解更多"]);
    const en = extractCompetitorFields(EN_HTML).cta;
    expect(en).toEqual(["Buy Now", "Sign Up Free", "Claim your discount"]);
  });

  it("caps CTA list at 5", () => {
    const html =
      "<body>" +
      Array.from(
        { length: 8 },
        (_, i) => `<button>Buy Now ${i}</button>`
      ).join("") +
      "</body>";
    expect(extractCompetitorFields(html).cta).toHaveLength(5);
  });

  it("extracts h1/h2 sections", () => {
    expect(extractCompetitorFields(ZH_HTML).sections).toEqual([
      "超轻透气跑鞋",
      "为什么选择我们",
      "用户评价",
    ]);
    expect(extractCompetitorFields(EN_HTML).sections).toEqual([
      "Run Faster, Run Lighter",
      "Features",
    ]);
  });

  it("never throws on malformed input", () => {
    expect(extractCompetitorFields("<div><h1>oops")).toEqual({
      title: "",
      price: [],
      cta: [],
      sections: [],
    });
    expect(extractCompetitorFields("")).toEqual({
      title: "",
      price: [],
      cta: [],
      sections: [],
    });
  });
});

describe("hashCompetitorSnapshot", () => {
  const snap: CompetitorSnapshot = {
    title: "T",
    price: ["¥1"],
    cta: ["购买"],
    sections: ["S"],
  };

  it("is stable for identical snapshots", () => {
    expect(hashCompetitorSnapshot(snap)).toBe(
      hashCompetitorSnapshot({ ...snap })
    );
    expect(hashCompetitorSnapshot(snap)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    expect(
      hashCompetitorSnapshot({ ...snap, title: "T2" })
    ).not.toBe(hashCompetitorSnapshot(snap));
    expect(
      hashCompetitorSnapshot({ ...snap, price: ["¥2"] })
    ).not.toBe(hashCompetitorSnapshot(snap));
  });
});

describe("diffCompetitorSnapshots", () => {
  const before: CompetitorSnapshot = {
    title: "Old title",
    price: ["¥100"],
    cta: ["立即购买"],
    sections: ["Intro", "Pricing"],
  };
  const after: CompetitorSnapshot = {
    title: "New title",
    price: ["¥100", "¥80"],
    cta: ["立即购买"],
    sections: ["Intro", "Reviews"],
  };

  it("records before/after for changed fields only", () => {
    const diff = diffCompetitorSnapshots(before, after);
    expect(diff.title).toEqual({ before: "Old title", after: "New title" });
    expect(diff.price).toEqual({ before: ["¥100"], after: ["¥100", "¥80"] });
    expect(diff.cta).toBeUndefined();
    expect(diff.sectionsAdded).toEqual(["Reviews"]);
    expect(diff.sectionsRemoved).toEqual(["Pricing"]);
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it("returns an empty diff when nothing changed", () => {
    const diff = diffCompetitorSnapshots(before, { ...before });
    expect(diffIsEmpty(diff)).toBe(true);
    expect(diff).toEqual({});
  });

  it("records before=null on the first change (no baseline)", () => {
    const diff = diffCompetitorSnapshots(null, after);
    expect(diff.title).toEqual({ before: null, after: "New title" });
    expect(diff.price).toEqual({ before: null, after: ["¥100", "¥80"] });
    expect(diff.cta).toEqual({ before: null, after: ["立即购买"] });
    expect(diff.sectionsAdded).toBeUndefined();
    expect(diff.sectionsRemoved).toBeUndefined();
  });
});
