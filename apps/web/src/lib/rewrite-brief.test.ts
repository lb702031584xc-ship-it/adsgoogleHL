/**
 * Task 4 — rewrite workbench brief validation (pure, no I/O).
 */
import { describe, expect, it } from "vitest";
import {
  defaultRewriteBrief,
  REWRITE_LENGTHS,
  REWRITE_TONES,
  validateRewriteBrief,
} from "@/lib/rewrite-brief";

describe("validateRewriteBrief", () => {
  it("accepts a complete valid brief and normalizes it", () => {
    const res = validateRewriteBrief({
      targetAudience: "  25-35 岁新手妈妈 ",
      sellingPoints: [" 静音设计 ", "", "30 天退款"],
      tone: "Friendly",
      ctaText: "立即抢购",
      discountInfo: "限时 4 折",
      seoKeywords: "vacuum, robot",
      language: "en",
      length: "SHORT",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.targetAudience).toBe("25-35 岁新手妈妈");
    expect(res.data.sellingPoints).toEqual(["静音设计", "30 天退款"]);
    expect(res.data.tone).toBe("friendly");
    expect(res.data.language).toBe("en");
    expect(res.data.length).toBe("short");
  });

  it("requires at least an audience or one selling point", () => {
    const res = validateRewriteBrief({ tone: "urgent" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.field === "targetAudience")).toBe(true);
  });

  it("rejects unknown tone/length/language", () => {
    const res = validateRewriteBrief({
      targetAudience: "x",
      tone: "nope",
      length: "huge",
      language: "fr",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const fields = res.errors.map((e) => e.field);
    expect(fields).toContain("tone");
    expect(fields).toContain("length");
    expect(fields).toContain("language");
  });

  it("caps selling points at 12 and enforces length limits", () => {
    const res = validateRewriteBrief({
      sellingPoints: Array.from({ length: 20 }, (_, i) => `point ${i}`),
      targetAudience: "x".repeat(201),
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.field === "targetAudience")).toBe(true);

    const ok = validateRewriteBrief({
      sellingPoints: Array.from({ length: 20 }, (_, i) => `point ${i}`),
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data.sellingPoints).toHaveLength(12);
  });

  it("exposes the expected tone and length options", () => {
    expect([...REWRITE_TONES]).toEqual([
      "professional",
      "friendly",
      "urgent",
      "humorous",
      "authoritative",
      "concise",
    ]);
    expect([...REWRITE_LENGTHS]).toEqual(["short", "medium", "long"]);
  });

  it("defaultRewriteBrief returns an editable empty form", () => {
    const d = defaultRewriteBrief();
    expect(d.targetAudience).toBe("");
    expect(d.sellingPoints).toEqual([""]);
    expect(d.tone).toBe("friendly");
    expect(d.language).toBe("zh");
    expect(d.length).toBe("medium");
  });
});
