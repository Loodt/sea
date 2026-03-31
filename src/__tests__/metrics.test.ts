import { describe, it, expect } from "vitest";
import { parseScoresFromText, isRegressing } from "../metrics.js";
import type { Score } from "../types.js";

// ── parseScoresFromText ──

describe("parseScoresFromText", () => {
  it("parses JSON code block", () => {
    const text = `Some reflection text.

\`\`\`json
{
  "accuracy": 8,
  "coverage": 7,
  "coherence": 9,
  "insightQuality": 6,
  "processCompliance": 7
}
\`\`\`

More text after.`;

    const score = parseScoresFromText(text, 3, 1);
    expect(score).not.toBeNull();
    expect(score!.accuracy).toBe(8);
    expect(score!.coverage).toBe(7);
    expect(score!.coherence).toBe(9);
    expect(score!.insightQuality).toBe(6);
    expect(score!.processCompliance).toBe(7);
    expect(score!.iteration).toBe(3);
    expect(score!.personaVersion).toBe(1);
  });

  it("computes overall via weighted sum", () => {
    const text = `\`\`\`json
{"accuracy": 10, "coverage": 10, "coherence": 10, "insightQuality": 10, "processCompliance": 10}
\`\`\``;
    const score = parseScoresFromText(text, 1, 1);
    // 10*0.25 + 10*0.20 + 10*0.15 + 10*0.20 + 10*0.20 = 10.0
    expect(score!.overall).toBeCloseTo(10.0);
  });

  it("computes overall with mixed scores", () => {
    const text = `\`\`\`json
{"accuracy": 8, "coverage": 6, "coherence": 7, "insightQuality": 5, "processCompliance": 9}
\`\`\``;
    const score = parseScoresFromText(text, 1, 1);
    // 8*0.25 + 6*0.20 + 7*0.15 + 5*0.20 + 9*0.20 = 2.0 + 1.2 + 1.05 + 1.0 + 1.8 = 7.05
    expect(score!.overall).toBeCloseTo(7.05);
  });

  it("parses inline JSON (no code block)", () => {
    const text = `The scores are {"accuracy": 7, "coverage": 6, "coherence": 8, "insightQuality": 5, "processCompliance": 7} which look reasonable.`;

    const score = parseScoresFromText(text, 2, 1);
    expect(score).not.toBeNull();
    expect(score!.accuracy).toBe(7);
    expect(score!.coverage).toBe(6);
  });

  it("extracts scores from field patterns", () => {
    const text = `
## Evaluation Scores
- Accuracy: 7
- Coverage: 6
- Coherence: 8
- Insight Quality: 5
- Process Compliance: 7
`;
    const score = parseScoresFromText(text, 1, 1);
    expect(score).not.toBeNull();
    expect(score!.accuracy).toBe(7);
    expect(score!.insightQuality).toBe(5);
    expect(score!.processCompliance).toBe(7);
  });

  it("extracts decimal scores from fields", () => {
    const text = "Accuracy: 7.5\nCoverage: 6.3";
    const score = parseScoresFromText(text, 1, 1);
    expect(score).not.toBeNull();
    expect(score!.accuracy).toBe(7.5);
    expect(score!.coverage).toBe(6.3);
  });

  it("returns null for malformed input (no valid scores)", () => {
    expect(parseScoresFromText("No scores here", 1, 1)).toBeNull();
    expect(parseScoresFromText("accuracy is good", 1, 1)).toBeNull();
  });

  it("returns null for empty or falsy input", () => {
    expect(parseScoresFromText("", 1, 1)).toBeNull();
  });

  it("returns null when only 1 field extracted (needs 2+)", () => {
    const text = "Accuracy: 7\nNothing else useful here.";
    expect(parseScoresFromText(text, 1, 1)).toBeNull();
  });

  it("prefers JSON block over field extraction", () => {
    const text = `Accuracy: 3
\`\`\`json
{"accuracy": 9, "coverage": 8, "coherence": 7, "insightQuality": 6, "processCompliance": 5}
\`\`\``;
    const score = parseScoresFromText(text, 1, 1);
    expect(score!.accuracy).toBe(9); // from JSON block, not field extraction
  });

  it("uses provided overall if present in JSON", () => {
    const text = `\`\`\`json
{"accuracy": 8, "coverage": 7, "coherence": 6, "insightQuality": 5, "processCompliance": 4, "overall": 99}
\`\`\``;
    const score = parseScoresFromText(text, 1, 1);
    expect(score!.overall).toBe(99);
  });

  it("defaults missing fields to 0", () => {
    const text = `\`\`\`json
{"accuracy": 8}
\`\`\``;
    const score = parseScoresFromText(text, 1, 1);
    expect(score).not.toBeNull();
    expect(score!.accuracy).toBe(8);
    expect(score!.coverage).toBe(0);
    expect(score!.coherence).toBe(0);
  });
});

// ── isRegressing ──

describe("isRegressing", () => {
  function makeScore(overall: number, iter: number = 1): Score {
    return {
      iteration: iter,
      timestamp: "2025-01-01T00:00:00.000Z",
      personaVersion: 1,
      accuracy: overall,
      coverage: overall,
      coherence: overall,
      insightQuality: overall,
      processCompliance: overall,
      overall,
    };
  }

  it("detects regression when recent scores drop >15%", () => {
    // Prior: [8, 8, 8] avg=8, Recent (window=3): [6, 6, 6] avg=6
    // Drop = (8-6)/8 = 0.25 > 0.15
    const scores = [8, 8, 8, 6, 6, 6].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores)).toBe(true);
  });

  it("returns false when no regression", () => {
    // Prior: [7, 7] Recent: [8, 8, 8] — scores improved
    const scores = [7, 7, 8, 8, 8].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores)).toBe(false);
  });

  it("returns false with not enough data", () => {
    // Default window=3, need at least 4 scores
    const scores = [8, 7, 6].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores)).toBe(false);
  });

  it("returns false with exactly window scores (need window+1)", () => {
    const scores = [8, 7, 6].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores, 3)).toBe(false);
  });

  it("works with exactly window+1 scores", () => {
    // Prior: [10] avg=10, Recent (window=3): [5, 5, 5] avg=5
    // Drop = (10-5)/10 = 0.5 > 0.15
    const scores = [10, 5, 5, 5].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores)).toBe(true);
  });

  it("returns false when prior average is zero", () => {
    const scores = [0, 0, 5, 5, 5].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores)).toBe(false);
  });

  it("respects custom window and threshold", () => {
    // Window=2: prior=[8, 8] avg=8, recent=[7, 7] avg=7
    // Drop = (8-7)/8 = 0.125 > 0.10 threshold
    const scores = [8, 8, 7, 7].map((v, i) => makeScore(v, i + 1));
    expect(isRegressing(scores, 2, 0.1)).toBe(true);
    // Same data but higher threshold
    expect(isRegressing(scores, 2, 0.15)).toBe(false);
  });

  it("handles single-score prior window", () => {
    // With window=3: need 4+ scores. With window=1: need 2+
    const scores = [10, 5].map((v, i) => makeScore(v, i + 1));
    // Drop = (10-5)/10 = 0.5 > 0.15
    expect(isRegressing(scores, 1)).toBe(true);
  });
});
