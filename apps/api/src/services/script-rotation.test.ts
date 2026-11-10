import { describe, expect, it } from "vitest";
import {
  buildRotationScript,
  validateRotationScriptInput,
} from "./script-rotation.js";

describe("script-rotation", () => {
  it("generates a valid Google Ads script with the label", () => {
    const src = buildRotationScript({ label: "adlinklab-rotate-nike" });
    expect(src).toContain("adlinklab-rotate-nike");
    expect(src).toContain("function main()");
    expect(src).toContain("AdsApp.ads()");
    expect(src).toContain("PropertiesService.getScriptProperties()");
  });

  it("rejects empty label", () => {
    expect(validateRotationScriptInput({ label: "" })).toHaveLength(1);
    expect(validateRotationScriptInput({ label: "   " })).toHaveLength(1);
  });

  it("rejects label with illegal characters", () => {
    const errors = validateRotationScriptInput({ label: "bad label!" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts valid label", () => {
    expect(
      validateRotationScriptInput({ label: "adlinklab-rotate-nike_01" })
    ).toHaveLength(0);
  });

  it("throws on empty label in builder", () => {
    expect(() => buildRotationScript({ label: "" })).toThrow();
  });
});
