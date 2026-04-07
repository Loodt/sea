import { describe, it, expect } from "vitest";
import { isPatternRelevant } from "../pattern-filter.js";

describe("isPatternRelevant", () => {
  it("returns true for content without frontmatter", () => {
    const content = "# Some Pattern\n\n## Description\nThis is a pattern.";
    expect(isPatternRelevant(content, "any-domain", "mechanism")).toBe(true);
  });

  it("returns true for general domain with all question types", () => {
    const content = "---\ndomains: [general]\nquestion_types: [all]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "thermal-fluids", "kill-check")).toBe(true);
  });

  it("filters by specific domain", () => {
    const content = "---\ndomains: [thermal-fluids, metallurgy]\nquestion_types: [all]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "thermal-fluids", "mechanism")).toBe(true);
    expect(isPatternRelevant(content, "water-treatment", "mechanism")).toBe(false);
  });

  it("filters by specific question type", () => {
    const content = "---\ndomains: [general]\nquestion_types: [mechanism, kill-check]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "any", "mechanism")).toBe(true);
    expect(isPatternRelevant(content, "any", "landscape")).toBe(false);
  });

  it("filters by both domain and question type", () => {
    const content = "---\ndomains: [thermal-fluids]\nquestion_types: [mechanism]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "thermal-fluids", "mechanism")).toBe(true);
    expect(isPatternRelevant(content, "thermal-fluids", "landscape")).toBe(false);
    expect(isPatternRelevant(content, "water", "mechanism")).toBe(false);
    expect(isPatternRelevant(content, "water", "landscape")).toBe(false);
  });

  it("includes all when domain is undefined", () => {
    const content = "---\ndomains: [thermal-fluids]\nquestion_types: [mechanism]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, undefined, "mechanism")).toBe(true);
  });

  it("includes all when questionType is undefined", () => {
    const content = "---\ndomains: [thermal-fluids]\nquestion_types: [mechanism]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "thermal-fluids", undefined)).toBe(true);
  });

  it("handles missing domains field (defaults to general)", () => {
    const content = "---\nquestion_types: [mechanism]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "anything", "mechanism")).toBe(true);
  });

  it("handles missing question_types field (defaults to all)", () => {
    const content = "---\ndomains: [thermal-fluids]\n---\n\n# Pattern";
    expect(isPatternRelevant(content, "thermal-fluids", "anything")).toBe(true);
  });
});
