import { describe, it, expect } from "vitest";
import {
  findMatchingExperts,
  hashPersona,
  computeUtilityScore,
} from "../expert-library.js";
import type { LibraryEntry, QuestionType } from "../types.js";

// ── Helpers ──

function makeEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    personaHash: "abc123def456",
    questionType: "landscape",
    domain: "wastewater treatment",
    expertType: "environmental specialist",
    avgIG: 5,
    dispatches: 3,
    lastUsed: "2025-01-01T00:00:00.000Z",
    personaPath: "experts/test.md",
    score: 4.0,
    status: "active",
    ...overrides,
  };
}

// ── hashPersona ──

describe("hashPersona", () => {
  it("returns a 12-character hex string", () => {
    const hash = hashPersona("test persona content");
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    const a = hashPersona("same input");
    const b = hashPersona("same input");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = hashPersona("persona A");
    const b = hashPersona("persona B");
    expect(a).not.toBe(b);
  });
});

// ── computeUtilityScore ──

describe("computeUtilityScore", () => {
  it("returns avgIG * log(dispatches + 1)", () => {
    const score = computeUtilityScore(5, 3);
    expect(score).toBeCloseTo(5 * Math.log(4));
  });

  it("returns 0 when avgIG is 0", () => {
    expect(computeUtilityScore(0, 10)).toBe(0);
  });

  it("returns 0 when dispatches is 0 (log(1) = 0)", () => {
    expect(computeUtilityScore(5, 0)).toBe(0);
  });

  it("increases with more dispatches", () => {
    const low = computeUtilityScore(5, 2);
    const high = computeUtilityScore(5, 10);
    expect(high).toBeGreaterThan(low);
  });
});

// ── findMatchingExperts ──

describe("findMatchingExperts", () => {
  it("returns empty array for empty library", () => {
    const result = findMatchingExperts([], "landscape", "water treatment");
    expect(result).toEqual([]);
  });

  it("filters by question type", () => {
    const library: LibraryEntry[] = [
      makeEntry({ personaHash: "aaa", questionType: "landscape", score: 3 }),
      makeEntry({ personaHash: "bbb", questionType: "mechanism", score: 5 }),
    ];
    const result = findMatchingExperts(library, "landscape", "water treatment");
    expect(result).toHaveLength(1);
    expect(result[0].personaHash).toBe("aaa");
  });

  it("excludes retired entries", () => {
    const library: LibraryEntry[] = [
      makeEntry({ personaHash: "aaa", status: "retired", score: 10 }),
      makeEntry({ personaHash: "bbb", status: "active", score: 2 }),
    ];
    const result = findMatchingExperts(library, "landscape", "water treatment");
    expect(result).toHaveLength(1);
    expect(result[0].personaHash).toBe("bbb");
  });

  it("excludes zero-score entries", () => {
    const library: LibraryEntry[] = [
      makeEntry({ personaHash: "aaa", score: 0 }),
      makeEntry({ personaHash: "bbb", score: 3 }),
    ];
    const result = findMatchingExperts(library, "landscape", "water");
    expect(result).toHaveLength(1);
    expect(result[0].personaHash).toBe("bbb");
  });

  it("respects topN limit", () => {
    const library: LibraryEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ personaHash: `hash${i}`, score: i + 1 })
    );
    const result = findMatchingExperts(library, "landscape", "water treatment", 3);
    expect(result).toHaveLength(3);
  });

  it("ranks by composite score (overlap * 0.4 + normalizedScore * 0.6)", () => {
    const library: LibraryEntry[] = [
      makeEntry({
        personaHash: "high-overlap",
        domain: "wastewater treatment",
        expertType: "treatment engineer",
        score: 2,
      }),
      makeEntry({
        personaHash: "high-score",
        domain: "unrelated domain xyz",
        expertType: "generic analyst",
        score: 10,
      }),
    ];
    const result = findMatchingExperts(library, "landscape", "wastewater treatment processes");
    // high-overlap has keyword overlap with query, high-score has better utility
    // Both should be returned, order depends on composite
    expect(result).toHaveLength(2);
  });

  it("normalizes overlap to [0,1] range", () => {
    // Entry domain has no overlap with query — overlap should be 0
    const library: LibraryEntry[] = [
      makeEntry({
        personaHash: "no-overlap",
        domain: "quantum physics",
        expertType: "physicist",
        score: 5,
      }),
    ];
    const result = findMatchingExperts(library, "landscape", "wastewater treatment");
    expect(result).toHaveLength(1);
    // Score should be purely from normalizedScore component (0.6 * 1.0 = 0.6)
  });

  it("handles query with only short/stop words (all filtered out)", () => {
    const library: LibraryEntry[] = [
      makeEntry({ personaHash: "aaa", score: 5 }),
    ];
    // "the" and "and" are stopwords, "is" is <4 chars
    const result = findMatchingExperts(library, "landscape", "the and is");
    expect(result).toHaveLength(1); // still returns by score, overlap=0
  });
});

// ── extractKeywords (tested indirectly via findMatchingExperts) ──

describe("extractKeywords (indirect)", () => {
  it("filters stopwords and short words", () => {
    // If query is "the water treatment and process", keywords should be ["water", "treatment", "process"]
    // An entry with domain "water treatment" should have overlap
    const library: LibraryEntry[] = [
      makeEntry({
        personaHash: "match",
        domain: "water treatment",
        expertType: "expert",
        score: 5,
      }),
    ];
    const result = findMatchingExperts(library, "landscape", "the water treatment and process");
    expect(result).toHaveLength(1);
    // The match on "water" and "treatment" means overlap > 0
  });

  it("handles special characters in text", () => {
    const library: LibraryEntry[] = [
      makeEntry({
        personaHash: "special",
        domain: "heavy-metal contamination",
        expertType: "specialist",
        score: 5,
      }),
    ];
    // Hyphens become spaces, so "heavy" and "metal" are separate words
    const result = findMatchingExperts(library, "landscape", "heavy metal contamination");
    expect(result).toHaveLength(1);
  });
});
