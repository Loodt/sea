import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runAudit } from "../audit.js";
import type { Finding, Question, ConductorMetric } from "../types.js";

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
    status: "verified",
    verifiedAt: 3,
    supersededBy: null,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "Q001",
    question: "Test question?",
    priority: "high",
    context: "test",
    domain: "test",
    iteration: 1,
    status: "open",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function makeMetric(overrides: Partial<ConductorMetric> = {}): ConductorMetric {
  return {
    conductorIteration: 1,
    questionId: "Q001",
    expertStatus: "answered",
    findingsAdded: 3,
    questionsResolved: 1,
    newQuestionsCreated: 0,
    innerIterationsRun: 3,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

async function setupProjectDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sea-audit-test-"));
  await mkdir(path.join(dir, "knowledge"), { recursive: true });
  await mkdir(path.join(dir, "metrics"), { recursive: true });
  await mkdir(path.join(dir, "output"), { recursive: true });
  return dir;
}

async function writeFindings(projectDir: string, findings: Finding[]): Promise<void> {
  const content = findings.map((f) => JSON.stringify(f)).join("\n") + (findings.length ? "\n" : "");
  await writeFile(path.join(projectDir, "knowledge", "findings.jsonl"), content, "utf-8");
}

async function writeQuestions(projectDir: string, questions: Question[]): Promise<void> {
  const content = questions.map((q) => JSON.stringify(q)).join("\n") + (questions.length ? "\n" : "");
  await writeFile(path.join(projectDir, "knowledge", "questions.jsonl"), content, "utf-8");
}

async function writeMetrics(projectDir: string, metrics: ConductorMetric[]): Promise<void> {
  const content = metrics.map((m) => JSON.stringify(m)).join("\n") + (metrics.length ? "\n" : "");
  await writeFile(path.join(projectDir, "metrics", "conductor-metrics.jsonl"), content, "utf-8");
}

async function writeWikiManifest(
  projectDir: string,
  entries: { findingId: string; contentHash: string; wikiPath: string; writtenAt: string }[]
): Promise<void> {
  await mkdir(path.join(projectDir, "wiki"), { recursive: true });
  await writeFile(
    path.join(projectDir, "wiki", "manifest.json"),
    JSON.stringify({ entries }),
    "utf-8"
  );
}

// ── Tests ──

describe("runAudit", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await setupProjectDir();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("runs clean on empty project", async () => {
    const result = await runAudit(projectDir);

    expect(result.findingIntegrity.sourceWithoutUrl).toHaveLength(0);
    expect(result.findingIntegrity.claimDuplicates).toHaveLength(0);
    expect(result.wikiIntegrity.manifestCount).toBe(0);
    expect(result.questionHealth.totalOpen).toBe(0);
    expect(result.convergence.isConverging).toBe(false);
    expect(existsSync(path.join(projectDir, "output", "audit-report.md"))).toBe(true);
  });

  it("detects SOURCE findings without URLs", async () => {
    const findings = [
      makeFinding({ id: "F001", tag: "SOURCE", source: null }),
      makeFinding({ id: "F002", tag: "SOURCE", source: "local notes" }),
      makeFinding({ id: "F003", tag: "SOURCE", source: "https://valid.com" }),
      makeFinding({ id: "F004", tag: "DERIVED", source: null }), // DERIVED, not flagged
    ];
    await writeFindings(projectDir, findings);

    const result = await runAudit(projectDir);
    expect(result.findingIntegrity.sourceWithoutUrl).toEqual(["F001", "F002"]);
  });

  it("detects duplicate claims", async () => {
    const findings = [
      makeFinding({ id: "F001", claim: "Gold recovery is 95%" }),
      makeFinding({ id: "F002", claim: "gold recovery is 95%" }), // case-insensitive match
      makeFinding({ id: "F003", claim: "Different claim" }),
    ];
    await writeFindings(projectDir, findings);

    const result = await runAudit(projectDir);
    expect(result.findingIntegrity.claimDuplicates).toHaveLength(1);
    expect(result.findingIntegrity.claimDuplicates[0]).toEqual(["F001", "F002"]);
  });

  it("detects missing wiki files", async () => {
    await writeWikiManifest(projectDir, [
      {
        findingId: "F001",
        contentHash: "abc123",
        wikiPath: "wiki/facts/F001.md",
        writtenAt: new Date().toISOString(),
      },
    ]);
    // Don't create the actual file — it's missing

    const result = await runAudit(projectDir);
    expect(result.wikiIntegrity.missingFiles).toEqual(["wiki/facts/F001.md"]);
    expect(result.wikiIntegrity.manifestCount).toBe(1);
  });

  it("detects orphaned wiki files", async () => {
    await writeWikiManifest(projectDir, []); // empty manifest
    // Create a wiki file not in manifest
    await mkdir(path.join(projectDir, "wiki", "facts"), { recursive: true });
    await writeFile(path.join(projectDir, "wiki", "facts", "F099.md"), "orphan", "utf-8");

    const result = await runAudit(projectDir);
    expect(result.wikiIntegrity.orphanedFiles).toEqual(["wiki/facts/F099.md"]);
    expect(result.wikiIntegrity.diskCount).toBe(1);
  });

  it("reports wiki in sync when manifest matches disk", async () => {
    await writeWikiManifest(projectDir, [
      {
        findingId: "F001",
        contentHash: "abc",
        wikiPath: "wiki/facts/F001.md",
        writtenAt: new Date().toISOString(),
      },
    ]);
    await mkdir(path.join(projectDir, "wiki", "facts"), { recursive: true });
    await writeFile(path.join(projectDir, "wiki", "facts", "F001.md"), "content", "utf-8");

    const result = await runAudit(projectDir);
    expect(result.wikiIntegrity.missingFiles).toHaveLength(0);
    expect(result.wikiIntegrity.orphanedFiles).toHaveLength(0);
    expect(result.wikiIntegrity.manifestCount).toBe(1);
    expect(result.wikiIntegrity.diskCount).toBe(1);
  });

  it("detects stale open questions", async () => {
    const findings = [makeFinding({ iteration: 15 })]; // current iteration = 15
    const questions = [
      makeQuestion({ id: "Q001", iteration: 1, status: "open" }), // age = 14, stale
      makeQuestion({ id: "Q002", iteration: 10, status: "open" }), // age = 5, not stale
      makeQuestion({ id: "Q003", iteration: 1, status: "resolved" }), // resolved, not flagged
    ];
    await writeFindings(projectDir, findings);
    await writeQuestions(projectDir, questions);

    const result = await runAudit(projectDir);
    expect(result.questionHealth.staleOpen).toEqual(["Q001"]);
    expect(result.questionHealth.totalOpen).toBe(2);
    expect(result.questionHealth.totalResolved).toBe(1);
  });

  it("computes open:resolved ratio", async () => {
    const questions = [
      makeQuestion({ id: "Q001", status: "open" }),
      makeQuestion({ id: "Q002", status: "open" }),
      makeQuestion({ id: "Q003", status: "resolved" }),
    ];
    await writeQuestions(projectDir, questions);

    const result = await runAudit(projectDir);
    expect(result.questionHealth.openResolvedRatio).toBe(2);
  });

  it("reports infinity ratio when no resolved questions", async () => {
    const questions = [makeQuestion({ id: "Q001", status: "open" })];
    await writeQuestions(projectDir, questions);

    const result = await runAudit(projectDir);
    expect(result.questionHealth.openResolvedRatio).toBe(Infinity);
  });

  it("computes dispatch efficiency", async () => {
    const metrics = Array.from({ length: 6 }, (_, i) =>
      makeMetric({ conductorIteration: i + 1, findingsAdded: 5 - i })
    );
    await writeMetrics(projectDir, metrics);

    const result = await runAudit(projectDir);
    expect(result.dispatchEfficiency.avgFindings).toBeGreaterThan(0);
    expect(["improving", "stable", "degrading"]).toContain(result.dispatchEfficiency.trend);
  });

  it("writes audit-report.md", async () => {
    const findings = [
      makeFinding({ id: "F001" }),
      makeFinding({ id: "F002", claim: "Another claim" }),
    ];
    const questions = [
      makeQuestion({ id: "Q001", status: "resolved" }),
    ];
    await writeFindings(projectDir, findings);
    await writeQuestions(projectDir, questions);

    await runAudit(projectDir);

    const report = await readFile(path.join(projectDir, "output", "audit-report.md"), "utf-8");
    expect(report).toContain("# Audit Report");
    expect(report).toContain("## Finding Integrity");
    expect(report).toContain("## Wiki Integrity");
    expect(report).toContain("## Question Health");
    expect(report).toContain("## Convergence");
    expect(report).toContain("## Dispatch Efficiency");
  });

  it("detects convergence signals when present", async () => {
    // 5 metrics with declining findings to trigger signals
    const metrics = [
      makeMetric({ conductorIteration: 1, findingsAdded: 10, expertStatus: "answered" }),
      makeMetric({ conductorIteration: 2, findingsAdded: 8, expertStatus: "answered" }),
      makeMetric({ conductorIteration: 3, findingsAdded: 0, expertStatus: "exhausted" }),
      makeMetric({ conductorIteration: 4, findingsAdded: 0, expertStatus: "exhausted" }),
      makeMetric({ conductorIteration: 5, findingsAdded: 0, expertStatus: "exhausted" }),
    ];
    const questions: Question[] = []; // no open questions → frontier closed signal
    await writeMetrics(projectDir, metrics);
    await writeQuestions(projectDir, questions);

    const result = await runAudit(projectDir);
    expect(result.convergence.isConverging).toBe(true);
    expect(result.convergence.signals.length).toBeGreaterThanOrEqual(2);
  });
});
