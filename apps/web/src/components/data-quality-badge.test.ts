/**
 * DataQualityBadge: three states render with the right label and color.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DataQualityBadge,
  normalizeDataQuality,
} from "@/components/data-quality-badge";

function render(quality: "OBSERVED" | "PREDICTED" | "UNKNOWN"): string {
  return renderToStaticMarkup(createElement(DataQualityBadge, { quality }));
}

describe("DataQualityBadge", () => {
  it("renders OBSERVED as green “Observed”", () => {
    const html = render("OBSERVED");
    expect(html).toContain("Observed");
    expect(html).toContain("bg-green-100");
  });

  it("renders PREDICTED as amber “Predicted”", () => {
    const html = render("PREDICTED");
    expect(html).toContain("Predicted");
    expect(html).toContain("bg-amber-100");
  });

  it("renders UNKNOWN as gray “Unknown”", () => {
    const html = render("UNKNOWN");
    expect(html).toContain("Unknown");
    expect(html).toContain("bg-ink/10");
  });
});

describe("normalizeDataQuality", () => {
  it("keeps OBSERVED", () => {
    expect(normalizeDataQuality("OBSERVED")).toBe("OBSERVED");
  });

  it("coerces ESTIMATED / INFERRED to PREDICTED, never OBSERVED", () => {
    expect(normalizeDataQuality("ESTIMATED")).toBe("PREDICTED");
    expect(normalizeDataQuality("INFERRED")).toBe("PREDICTED");
    expect(normalizeDataQuality("PREDICTED")).toBe("PREDICTED");
  });

  it("falls back to UNKNOWN for missing or unrecognized values", () => {
    expect(normalizeDataQuality(null)).toBe("UNKNOWN");
    expect(normalizeDataQuality(undefined)).toBe("UNKNOWN");
    expect(normalizeDataQuality("")).toBe("UNKNOWN");
    expect(normalizeDataQuality("WHATEVER")).toBe("UNKNOWN");
  });
});
