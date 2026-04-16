import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  queryFindings,
  informationGain,
  findingCounts,
  generateFallbackSummary,
  enforceSummarySize,
  enforceSummaryFreshness,
  graduateFindings,
  normalizeQuestionIds,
  enforceDerivationChains,
  enforceSourceUrls,
} from "../knowledge.js";
import type { Finding, Question } from "../types.js";

// ── Helpers ──

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F001",
    claim: "Test claim",
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
    question: "Test question?",
    priority: "high",
    context: "test context",
    domain: "test",
    iteration: 1,
    status: "open",
    questionType: "data-hunt",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

// ── queryFindings ──

describe("queryFindings", () => {
  const findings: Finding[] = [
    makeFinding({ id: "F001", domain: "water", status: "verified", tag: "SOURCE", confidence: 0.95 }),
    makeFinding({ id: "F002", domain: "water", status: "provisional", tag: "DERIVED", confidence: 0.7 }),
    makeFinding({ id: "F003", domain: "soil", status: "verified", tag: "SOURCE", confidence: 0.85 }),
    makeFinding({ id: "F004", domain: "soil", status: "refuted", tag: "ASSUMED", confidence: 0.4 }),
  ];

  it("filters by domain", () => {
    const result = queryFindings(findings, { domain: "water" });
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.domain === "water")).toBe(true);
  });

  it("filters by status", () => {
    const result = queryFindings(findings, { status: "verified" });
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.status === "verified")).toBe(true);
  });

  it("filters by tag", () => {
    const result = queryFindings(findings, { tag: "SOURCE" });
    expect(result).toHaveLength(2);
  });

  it("filters by minConfidence", () => {
    const result = queryFindings(findings, { minConfidence: 0.85 });
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.confidence >= 0.85)).toBe(true);
  });

  it("combines multiple filters (AND logic)", () => {
    const result = queryFindings(findings, { domain: "water", status: "verified" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("F001");
  });

  it("returns all when no filters", () => {
    expect(queryFindings(findings, {})).toHaveLength(4);
  });

  it("returns empty for no matches", () => {
    expect(queryFindings(findings, { domain: "air" })).toHaveLength(0);
  });
});

// ── informationGain ──

describe("informationGain", () => {
  it("counts new findings for an iteration", () => {
    const findings = [
      makeFinding({ iteration: 3 }),
      makeFinding({ id: "F002", iteration: 3 }),
      makeFinding({ id: "F003", iteration: 2 }),
    ];
    const result = informationGain(findings, [], 3);
    expect(result.newFindings).toBe(2);
  });

  it("counts resolved questions for an iteration", () => {
    const questions = [
      makeQuestion({ status: "resolved", resolvedAt: 5 }),
      makeQuestion({ id: "Q002", status: "resolved", resolvedAt: 5 }),
      makeQuestion({ id: "Q003", status: "resolved", resolvedAt: 4 }),
      makeQuestion({ id: "Q004", status: "open" }),
    ];
    const result = informationGain([], questions, 5);
    expect(result.resolvedQuestions).toBe(2);
  });

  it("counts contradictions (refuted findings verified at iteration)", () => {
    const findings = [
      makeFinding({ status: "refuted", verifiedAt: 3 }),
      makeFinding({ id: "F002", status: "refuted", verifiedAt: 3 }),
      makeFinding({ id: "F003", status: "refuted", verifiedAt: 2 }),
    ];
    const result = informationGain(findings, [], 3);
    expect(result.contradictions).toBe(2);
  });

  it("returns zeros for no activity", () => {
    const result = informationGain([], [], 1);
    expect(result).toEqual({ newFindings: 0, resolvedQuestions: 0, contradictions: 0 });
  });
});

// ── findingCounts ──

describe("findingCounts", () => {
  it("tallies by status", () => {
    const findings = [
      makeFinding({ status: "verified" }),
      makeFinding({ id: "F002", status: "verified" }),
      makeFinding({ id: "F003", status: "provisional" }),
      makeFinding({ id: "F004", status: "refuted" }),
      makeFinding({ id: "F005", status: "superseded" }),
    ];
    const counts = findingCounts(findings);
    expect(counts).toEqual({
      total: 5,
      verified: 2,
      provisional: 1,
      refuted: 1,
      superseded: 1,
    });
  });

  it("handles empty array", () => {
    const counts = findingCounts([]);
    expect(counts).toEqual({ total: 0, verified: 0, provisional: 0, refuted: 0, superseded: 0 });
  });
});

// ── generateFallbackSummary ──

describe("generateFallbackSummary", () => {
  it("includes store counts", () => {
    const findings = [makeFinding({ status: "verified", claim: "Water is wet" })];
    const questions = [makeQuestion({ status: "open" })];
    const summary = generateFallbackSummary(findings, questions);
    expect(summary).toContain("## Store");
    expect(summary).toContain("1 findings: 1 verified, 0 provisional, 0 refuted, 0 superseded.");
    expect(summary).toContain("1 questions: 0 resolved, 1 open, 0 exhausted.");
  });

  it("includes latest findings section", () => {
    const findings = [makeFinding({ status: "provisional", claim: "Maybe true" })];
    const summary = generateFallbackSummary(findings, []);
    expect(summary).toContain("## Latest Findings");
    expect(summary).toContain("Maybe true");
  });

  it("includes open branches section", () => {
    const questions = [makeQuestion({ id: "Q007", priority: "high", question: "What about X?" })];
    const summary = generateFallbackSummary([], questions);
    expect(summary).toContain("## Open Branches");
    expect(summary).toContain("`Q007` [data-hunt] test");
  });

  it("limits open branches to 10", () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      makeQuestion({ id: `Q${i}`, priority: "medium", question: `Q${i}?`, domain: `d${i}`, questionType: "data-hunt" })
    );
    const summary = generateFallbackSummary([], questions);
    const branchMatches = summary.match(/\[data-hunt\]/g);
    expect(branchMatches).toHaveLength(10);
  });

  it("handles empty inputs", () => {
    const summary = generateFallbackSummary([], []);
    expect(summary).toContain("# Knowledge Summary");
    expect(summary).toContain("0 findings: 0 verified, 0 provisional, 0 refuted, 0 superseded.");
  });
});

// ── enforceSummarySize (disk-based) ──

describe("enforceSummarySize", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-test-"));
    await mkdir(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns false when summary does not exist", async () => {
    const result = await enforceSummarySize(tmpDir);
    expect(result).toBe(false);
  });

  it("returns false when summary is under 2KB", async () => {
    await writeFile(path.join(tmpDir, "knowledge", "summary.md"), "Short summary", "utf-8");
    const result = await enforceSummarySize(tmpDir);
    expect(result).toBe(false);
  });

  it("regenerates when summary exceeds 2KB", async () => {
    const oversized = "x".repeat(3000);
    await writeFile(path.join(tmpDir, "knowledge", "summary.md"), oversized, "utf-8");

    // Need findings.jsonl for regeneration
    const finding = makeFinding({ status: "verified", claim: "Regenerated claim" });
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(finding) + "\n",
      "utf-8"
    );
    await writeFile(path.join(tmpDir, "knowledge", "questions.jsonl"), "", "utf-8");

    const result = await enforceSummarySize(tmpDir);
    expect(result).toBe(true);

    const content = await readFile(path.join(tmpDir, "knowledge", "summary.md"), "utf-8");
    expect(Buffer.byteLength(content, "utf-8")).toBeLessThanOrEqual(2048);
    expect(content).toContain("Regenerated claim");
  });
});

describe("enforceSummaryFreshness", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-test-"));
    await mkdir(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("regenerates stale summary when counts or open IDs drift", async () => {
    const findings = [makeFinding({ status: "verified", claim: "Fresh claim" })];
    const questions = [
      makeQuestion({ id: "Q001", status: "open", questionType: "design-space", domain: "alpha" }),
      makeQuestion({ id: "Q002", status: "resolved" }),
    ];

    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );
    await writeFile(
      path.join(tmpDir, "knowledge", "questions.jsonl"),
      questions.map((q) => JSON.stringify(q)).join("\n") + "\n",
      "utf-8"
    );
    await writeFile(path.join(tmpDir, "knowledge", "summary.md"), "# Knowledge Summary\n\nstale", "utf-8");

    const changed = await enforceSummaryFreshness(tmpDir);
    expect(changed).toBe(true);

    const content = await readFile(path.join(tmpDir, "knowledge", "summary.md"), "utf-8");
    expect(content).toContain("1 findings: 1 verified, 0 provisional, 0 refuted, 0 superseded.");
    expect(content).toContain("2 questions: 1 resolved, 1 open, 0 exhausted.");
    expect(content).toContain("`Q001` [design-space] alpha");
  });

  it("leaves a fresh summary unchanged", async () => {
    const findings = [makeFinding({ status: "verified", claim: "Fresh claim" })];
    const questions = [makeQuestion({ id: "Q001", status: "open", questionType: "design-space", domain: "alpha" })];
    const summary = generateFallbackSummary(findings, questions);

    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );
    await writeFile(
      path.join(tmpDir, "knowledge", "questions.jsonl"),
      questions.map((q) => JSON.stringify(q)).join("\n") + "\n",
      "utf-8"
    );
    await writeFile(path.join(tmpDir, "knowledge", "summary.md"), summary, "utf-8");

    const changed = await enforceSummaryFreshness(tmpDir);
    expect(changed).toBe(false);
  });
});

// ── graduateFindings (disk-based) ──

describe("graduateFindings", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-test-"));
    await mkdir(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("graduates qualifying provisional findings", async () => {
    const findings = [
      makeFinding({
        id: "F001",
        status: "provisional",
        confidence: 0.90,
        tag: "SOURCE",
        source: "https://example.com",
        iteration: 1,
      }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3); // iteration 5, staleAfter 3
    expect(count).toBe(1);

    // Verify on disk
    const content = await readFile(path.join(tmpDir, "knowledge", "findings.jsonl"), "utf-8");
    const updated = JSON.parse(content.trim().split("\n")[0]);
    expect(updated.status).toBe("verified");
    expect(updated.verifiedAt).toBe(5);
  });

  it("rejects low confidence findings", async () => {
    const findings = [
      makeFinding({ confidence: 0.7, tag: "SOURCE", source: "https://x.com", iteration: 1 }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0);
  });

  it("rejects non-SOURCE tagged findings", async () => {
    const findings = [
      makeFinding({ confidence: 0.95, tag: "DERIVED", source: null, iteration: 1 }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0);
  });

  it("rejects findings that are too young", async () => {
    const findings = [
      makeFinding({ confidence: 0.95, tag: "SOURCE", source: "https://x.com", iteration: 4 }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3); // age = 5-4 = 1 < 3
    expect(count).toBe(0);
  });

  it("rejects findings whose ID appears in refuted supersededBy set", async () => {
    const findings = [
      makeFinding({
        id: "F001",
        status: "provisional",
        confidence: 0.95,
        tag: "SOURCE",
        source: "https://x.com",
        iteration: 1,
      }),
      makeFinding({
        id: "F002",
        status: "refuted",
        supersededBy: "F001", // F001 is in the refuted claims set
        iteration: 2,
      }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0);
  });

  it("skips already-verified findings", async () => {
    const findings = [
      makeFinding({
        status: "verified",
        confidence: 0.95,
        tag: "SOURCE",
        source: "https://x.com",
        iteration: 1,
      }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0); // already verified, not provisional
  });

  it("rejects SOURCE with null source string", async () => {
    const findings = [
      makeFinding({ confidence: 0.95, tag: "SOURCE", source: "null", iteration: 1 }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0);
  });

  it("rejects SOURCE whose source is a bare label rather than a URL", async () => {
    const findings = [
      makeFinding({ confidence: 0.95, tag: "SOURCE", source: "sprout-social-2026", iteration: 1 }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0);
  });

  it("skips findings flagged needsReview even when otherwise eligible", async () => {
    const findings = [
      makeFinding({
        id: "F001",
        confidence: 0.95,
        tag: "SOURCE",
        source: "https://example.com/paper",
        iteration: 1,
        needsReview: { reason: "number mismatch with source", flaggedAt: "2026-04-16T00:00:00Z" },
      }),
    ];
    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      JSON.stringify(findings[0]) + "\n",
      "utf-8"
    );

    const count = await graduateFindings(tmpDir, 5, 3);
    expect(count).toBe(0);
  });
});

describe("normalizeQuestionIds", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-test-"));
    await mkdir(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reassigns later duplicate IDs to the next free question IDs", async () => {
    const questions = [
      makeQuestion({ id: "Q001", question: "First?" }),
      makeQuestion({ id: "Q002", question: "Second?" }),
      makeQuestion({ id: "Q002", question: "Duplicate second?" }),
      makeQuestion({ id: "Q004", question: "Fourth?" }),
      makeQuestion({ id: "Q004", question: "Duplicate fourth?" }),
    ];

    await writeFile(
      path.join(tmpDir, "knowledge", "questions.jsonl"),
      questions.map((q) => JSON.stringify(q)).join("\n") + "\n",
      "utf-8"
    );

    const changed = await normalizeQuestionIds(tmpDir);
    expect(changed).toBe(2);

    const content = await readFile(path.join(tmpDir, "knowledge", "questions.jsonl"), "utf-8");
    const updated = content.trim().split("\n").map((line) => JSON.parse(line) as Question);

    expect(updated.map((q) => q.id)).toEqual(["Q001", "Q002", "Q005", "Q004", "Q006"]);
    expect(new Set(updated.map((q) => q.id)).size).toBe(updated.length);
  });
});

describe("enforceDerivationChains", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-test-"));
    await mkdir(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("downgrades DERIVED findings without a derivationChain to ESTIMATED", async () => {
    const findings = [
      makeFinding({
        id: "F001",
        tag: "DERIVED",
        claim: "[DERIVED: synthesis] Some derived claim",
      }),
      makeFinding({
        id: "F002",
        tag: "DERIVED",
        claim: "[DERIVED: deduction] Properly chained claim",
        derivationChain: {
          premises: ["F001", "axiom: X"],
          method: "deduction",
          assumptions: [],
        },
      }),
      makeFinding({ id: "F003", tag: "SOURCE", source: "https://example.com" }),
      makeFinding({
        id: "F004",
        tag: "DERIVED",
        claim: "[DERIVED: calculation] Empty-premises chain",
        derivationChain: {
          premises: [],
          method: "calculation",
          assumptions: [],
        },
      }),
    ];

    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );

    const downgraded = await enforceDerivationChains(tmpDir);
    expect(downgraded).toBe(2);

    const content = await readFile(path.join(tmpDir, "knowledge", "findings.jsonl"), "utf-8");
    const updated = content.trim().split("\n").map((line) => JSON.parse(line) as Finding);

    expect(updated[0].tag).toBe("ESTIMATED");
    expect(updated[0].claim).toMatch(/^\[ESTIMATED: derivationChain missing\]/);
    expect(updated[1].tag).toBe("DERIVED"); // kept — has premises
    expect(updated[2].tag).toBe("SOURCE");  // unaffected
    expect(updated[3].tag).toBe("ESTIMATED"); // empty premises == missing chain
  });

  it("returns 0 when all DERIVED findings have valid chains", async () => {
    const findings = [
      makeFinding({
        id: "F001",
        tag: "DERIVED",
        claim: "Valid claim",
        derivationChain: {
          premises: ["F002"],
          method: "deduction",
          assumptions: [],
        },
      }),
      makeFinding({ id: "F002", tag: "SOURCE" }),
    ];

    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );

    const downgraded = await enforceDerivationChains(tmpDir);
    expect(downgraded).toBe(0);
  });
});

describe("enforceSourceUrls", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-test-"));
    await mkdir(path.join(tmpDir, "knowledge"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("downgrades SOURCE findings without a valid URL to UNKNOWN", async () => {
    const findings = [
      makeFinding({ id: "F001", tag: "SOURCE", source: "sprout-social-2026", claim: "[SOURCE: sprout-social-2026] Bare label source" }),
      makeFinding({ id: "F002", tag: "SOURCE", source: "https://example.com/paper", claim: "[SOURCE: example] Real URL" }),
      makeFinding({ id: "F003", tag: "SOURCE", source: null, claim: "No source" }),
      makeFinding({ id: "F004", tag: "SOURCE", source: "McKinsey, Salesforce reports, Grubhub case study", claim: "Bundle blob" }),
      makeFinding({ id: "F005", tag: "DERIVED", source: null, claim: "Unaffected" }),
    ];

    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );

    const downgraded = await enforceSourceUrls(tmpDir);
    expect(downgraded).toBe(3);

    const content = await readFile(path.join(tmpDir, "knowledge", "findings.jsonl"), "utf-8");
    const updated = content.trim().split("\n").map((line) => JSON.parse(line) as Finding);

    expect(updated[0].tag).toBe("UNKNOWN");
    expect(updated[0].source).toBeNull();
    expect(updated[0].claim).toMatch(/^\[UNKNOWN: source-url-missing \(was: sprout-social-2026\)\]/);
    expect(updated[1].tag).toBe("SOURCE"); // kept — real URL
    expect(updated[1].source).toBe("https://example.com/paper");
    expect(updated[2].tag).toBe("UNKNOWN"); // null source
    expect(updated[3].tag).toBe("UNKNOWN"); // bundle citation
    expect(updated[4].tag).toBe("DERIVED"); // unaffected
  });

  it("returns 0 when all SOURCE findings have valid URLs", async () => {
    const findings = [
      makeFinding({ id: "F001", tag: "SOURCE", source: "https://a.com" }),
      makeFinding({ id: "F002", tag: "SOURCE", source: "http://b.org/paper" }),
    ];

    await writeFile(
      path.join(tmpDir, "knowledge", "findings.jsonl"),
      findings.map((f) => JSON.stringify(f)).join("\n") + "\n",
      "utf-8"
    );

    const downgraded = await enforceSourceUrls(tmpDir);
    expect(downgraded).toBe(0);
  });
});
