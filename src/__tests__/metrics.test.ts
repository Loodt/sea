import { describe, it, expect } from "vitest";
import { parseScoresFromText, isRegressing, computeDispatchEfficiency, detectConvergenceSignals } from "../metrics.js";
import type { Score, ConductorMetric, Finding, Question } from "../types.js";

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

// ── Helpers for convergence tests ──

function makeMetric(overrides: Partial<ConductorMetric> = {}): ConductorMetric {
  return {
    conductorIteration: 1,
    questionId: "Q001",
    expertStatus: "answered",
    findingsAdded: 5,
    questionsResolved: 1,
    newQuestionsCreated: 0,
    innerIterationsRun: 2,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F001",
    claim: "Test",
    tag: "SOURCE",
    source: "https://example.com",
    confidence: 0.9,
    domain: "test",
    iteration: 1,
    status: "provisional",
    verifiedAt: null,
    supersededBy: null,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "Q001",
    question: "Test?",
    priority: "high",
    context: "",
    domain: "test",
    iteration: 1,
    status: "open",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

// ── computeDispatchEfficiency ──

describe("computeDispatchEfficiency", () => {
  it("returns zero for empty metrics", () => {
    const result = computeDispatchEfficiency([]);
    expect(result.avgFindings).toBe(0);
    expect(result.trend).toBe("stable");
  });

  it("computes correct average", () => {
    const metrics = [
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 20 }),
    ];
    const result = computeDispatchEfficiency(metrics);
    expect(result.avgFindings).toBe(15);
  });

  it("returns stable when not enough data for trend", () => {
    const metrics = [
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 5 }),
    ];
    const result = computeDispatchEfficiency(metrics, 5);
    expect(result.trend).toBe("stable");
  });

  it("detects degrading trend", () => {
    // Prior: 10, 10, 10 (avg 10). Recent (window=3): 2, 2, 2 (avg 2). Drop = -80%
    const metrics = [
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
    ];
    const result = computeDispatchEfficiency(metrics, 3);
    expect(result.trend).toBe("degrading");
    expect(result.recentAvg).toBe(2);
    expect(result.priorAvg).toBe(10);
  });

  it("detects improving trend", () => {
    // Prior: 2, 2, 2 (avg 2). Recent: 10, 10, 10 (avg 10). Increase = +400%
    const metrics = [
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
    ];
    const result = computeDispatchEfficiency(metrics, 3);
    expect(result.trend).toBe("improving");
  });

  it("returns stable for small changes", () => {
    // Prior avg 10, Recent avg 9. Drop = -10%, below 30% threshold
    const metrics = [
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 9 }),
      makeMetric({ findingsAdded: 9 }),
      makeMetric({ findingsAdded: 9 }),
    ];
    const result = computeDispatchEfficiency(metrics, 3);
    expect(result.trend).toBe("stable");
  });
});

// ── detectConvergenceSignals ──

describe("detectConvergenceSignals", () => {
  it("returns no convergence for fresh project (< 3 dispatches)", () => {
    const metrics = [makeMetric(), makeMetric()];
    const result = detectConvergenceSignals([], [], metrics);
    expect(result.isConverging).toBe(false);
    expect(result.signals).toHaveLength(0);
    expect(result.recommendation).toBe("continue");
  });

  it("detects knowledge saturation (< 1 finding per dispatch)", () => {
    const metrics = [
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
    ];
    const questions = [makeQuestion({ status: "open" })];
    const result = detectConvergenceSignals([], questions, metrics);
    expect(result.signals.some((s) => s.includes("Knowledge saturation"))).toBe(true);
  });

  it("detects closed question frontier", () => {
    const metrics = [makeMetric(), makeMetric(), makeMetric()];
    const questions = [
      makeQuestion({ status: "resolved" }),
      makeQuestion({ status: "resolved" }),
    ];
    const result = detectConvergenceSignals([], questions, metrics);
    expect(result.signals.some((s) => s.includes("Question frontier closed"))).toBe(true);
  });

  it("detects diminishing returns", () => {
    // Prior: high findings. Recent window: low findings (>30% drop)
    const metrics = [
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
      makeMetric({ findingsAdded: 2 }),
    ];
    const result = detectConvergenceSignals([], [makeQuestion({ status: "open" })], metrics);
    expect(result.signals.some((s) => s.includes("Diminishing returns"))).toBe(true);
  });

  it("detects domain saturation", () => {
    // 10+ findings, last 5 all in domains that appeared before
    const findings = [
      ...Array.from({ length: 8 }, (_, i) => makeFinding({ id: `F${i}`, domain: "water" })),
      makeFinding({ id: "F8", domain: "water" }),
      makeFinding({ id: "F9", domain: "water" }),
      makeFinding({ id: "F10", domain: "water" }),
      makeFinding({ id: "F11", domain: "water" }),
      makeFinding({ id: "F12", domain: "water" }),
    ];
    const metrics = [makeMetric(), makeMetric(), makeMetric()];
    const result = detectConvergenceSignals(findings, [makeQuestion({ status: "open" })], metrics);
    expect(result.signals.some((s) => s.includes("Domain saturation"))).toBe(true);
  });

  it("does NOT detect domain saturation when new domains appear", () => {
    const findings = [
      ...Array.from({ length: 8 }, (_, i) => makeFinding({ id: `F${i}`, domain: "water" })),
      makeFinding({ id: "F8", domain: "gold" }),
      makeFinding({ id: "F9", domain: "gold" }),
      makeFinding({ id: "F10", domain: "thermal" }),
      makeFinding({ id: "F11", domain: "water" }),
      makeFinding({ id: "F12", domain: "new-domain" }),
    ];
    const metrics = [makeMetric(), makeMetric(), makeMetric()];
    const result = detectConvergenceSignals(findings, [makeQuestion({ status: "open" })], metrics);
    expect(result.signals.some((s) => s.includes("Domain saturation"))).toBe(false);
  });

  it("detects high exhaustion rate", () => {
    const metrics = [
      makeMetric({ expertStatus: "answered" }),
      makeMetric({ expertStatus: "answered" }),
      makeMetric({ expertStatus: "exhausted" }),
      makeMetric({ expertStatus: "crashed" }),
      makeMetric({ expertStatus: "exhausted" }),
      makeMetric({ expertStatus: "exhausted" }),
      makeMetric({ expertStatus: "crashed" }),
    ];
    const result = detectConvergenceSignals([], [makeQuestion({ status: "open" })], metrics);
    expect(result.signals.some((s) => s.includes("High exhaustion rate"))).toBe(true);
  });

  it("recommends 'continue' with 0-1 signals", () => {
    const metrics = [makeMetric({ findingsAdded: 10 }), makeMetric({ findingsAdded: 10 }), makeMetric({ findingsAdded: 10 })];
    const questions = [makeQuestion({ status: "open" })];
    const result = detectConvergenceSignals([], questions, metrics);
    expect(result.recommendation).toBe("continue");
  });

  it("recommends 'review' with 2 signals", () => {
    // Signal 1: knowledge saturation (0 findings last 3)
    // Signal 2: closed frontier (no open questions)
    const metrics = [
      makeMetric({ findingsAdded: 10 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
    ];
    const questions = [makeQuestion({ status: "resolved" })];
    const result = detectConvergenceSignals([], questions, metrics);
    expect(result.isConverging).toBe(true);
    expect(result.recommendation).toBe("review");
  });

  it("recommends 'stop' with 3+ signals", () => {
    // Signal 1: knowledge saturation (0 findings last 3)
    // Signal 2: closed frontier (no open questions)
    // Signal 3: diminishing returns (degrading trend)
    const metrics = [
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 20 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
      makeMetric({ findingsAdded: 0 }),
    ];
    const questions = [makeQuestion({ status: "resolved" })];
    const result = detectConvergenceSignals([], questions, metrics);
    expect(result.isConverging).toBe(true);
    expect(result.recommendation).toBe("stop");
    expect(result.signals.length).toBeGreaterThanOrEqual(3);
  });
});
