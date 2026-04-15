import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  snapshotStores,
  diffStores,
  detectClobber,
  restoreStores,
  DEFAULT_CLOBBER_THRESHOLDS,
} from "../store-snapshot.js";
import type { Finding, Question } from "../types.js";

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
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

async function seedProject(
  projectDir: string,
  findings: Finding[],
  questions: Question[]
): Promise<void> {
  const knowledgeDir = path.join(projectDir, "knowledge");
  await mkdir(knowledgeDir, { recursive: true });
  await writeFile(
    path.join(knowledgeDir, "findings.jsonl"),
    findings.map((f) => JSON.stringify(f)).join("\n") + (findings.length ? "\n" : ""),
    "utf-8"
  );
  await writeFile(
    path.join(knowledgeDir, "questions.jsonl"),
    questions.map((q) => JSON.stringify(q)).join("\n") + (questions.length ? "\n" : ""),
    "utf-8"
  );
}

async function mutateStore(
  projectDir: string,
  findings: Finding[],
  questions: Question[]
): Promise<void> {
  await writeFile(
    path.join(projectDir, "knowledge", "findings.jsonl"),
    findings.map((f) => JSON.stringify(f)).join("\n") + (findings.length ? "\n" : ""),
    "utf-8"
  );
  await writeFile(
    path.join(projectDir, "knowledge", "questions.jsonl"),
    questions.map((q) => JSON.stringify(q)).join("\n") + (questions.length ? "\n" : ""),
    "utf-8"
  );
}

describe("store-snapshot", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-snapshot-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── snapshotStores ──

  describe("snapshotStores", () => {
    it("captures current findings and questions to versioned dir", async () => {
      const findings = [makeFinding({ id: "F001" }), makeFinding({ id: "F002", status: "verified" })];
      const questions = [makeQuestion({ id: "Q001" }), makeQuestion({ id: "Q002", status: "resolved" })];
      await seedProject(tmpDir, findings, questions);

      const snap = await snapshotStores(tmpDir, 5);

      expect(snap.iteration).toBe(5);
      expect(snap.findingsCount).toBe(2);
      expect(snap.questionsCount).toBe(2);
      expect(snap.verifiedFindingIds).toEqual(["F002"]);
      expect(snap.nonOpenQuestionIds).toEqual(["Q002"]);
      expect(existsSync(path.join(snap.dir, "findings.jsonl"))).toBe(true);
      expect(existsSync(path.join(snap.dir, "questions.jsonl"))).toBe(true);
      expect(existsSync(path.join(snap.dir, "meta.json"))).toBe(true);
    });

    it("handles empty store without crashing", async () => {
      await seedProject(tmpDir, [], []);
      const snap = await snapshotStores(tmpDir, 1);
      expect(snap.findingsCount).toBe(0);
      expect(snap.questionsCount).toBe(0);
    });

    it("tags distinguish multiple snapshots in same iteration", async () => {
      await seedProject(tmpDir, [makeFinding()], [makeQuestion()]);
      const s1 = await snapshotStores(tmpDir, 3, "pre-integration");
      const s2 = await snapshotStores(tmpDir, 3, "post-integration");
      expect(s1.dir).not.toBe(s2.dir);
    });
  });

  // ── diffStores ──

  describe("diffStores", () => {
    it("reports zero change when store is untouched", async () => {
      const findings = [makeFinding({ id: "F001" }), makeFinding({ id: "F002" })];
      const questions = [makeQuestion({ id: "Q001" })];
      await seedProject(tmpDir, findings, questions);

      const snap = await snapshotStores(tmpDir, 1);
      const diff = await diffStores(tmpDir, snap);

      expect(diff.findingsAdded).toBe(0);
      expect(diff.findingsRemoved).toBe(0);
      expect(diff.questionsAdded).toBe(0);
      expect(diff.questionsRemoved).toBe(0);
      expect(diff.verifiedRemoved).toEqual([]);
      expect(diff.nonOpenReopened).toEqual([]);
    });

    it("detects removal by ID even when total count is preserved", async () => {
      const before = [makeFinding({ id: "F001" }), makeFinding({ id: "F002" })];
      await seedProject(tmpDir, before, []);
      const snap = await snapshotStores(tmpDir, 1);

      // Replace F002 with F003 — same count, but F002 is gone
      const after = [makeFinding({ id: "F001" }), makeFinding({ id: "F003" })];
      await mutateStore(tmpDir, after, []);

      const diff = await diffStores(tmpDir, snap);
      expect(diff.findingsAdded).toBe(1);
      expect(diff.findingsRemoved).toBe(1);
      expect(diff.findingsAfter).toBe(diff.findingsBefore);
    });

    it("flags verified findings that disappear", async () => {
      const before = [
        makeFinding({ id: "F001", status: "verified" }),
        makeFinding({ id: "F002", status: "provisional" }),
      ];
      await seedProject(tmpDir, before, []);
      const snap = await snapshotStores(tmpDir, 1);

      await mutateStore(tmpDir, [makeFinding({ id: "F002", status: "provisional" })], []);
      const diff = await diffStores(tmpDir, snap);
      expect(diff.verifiedRemoved).toEqual(["F001"]);
    });

    it("flags non-open questions reopened as corruption", async () => {
      const before = [
        makeQuestion({ id: "Q001", status: "resolved" }),
        makeQuestion({ id: "Q002", status: "open" }),
      ];
      await seedProject(tmpDir, [], before);
      const snap = await snapshotStores(tmpDir, 1);

      const after = [
        makeQuestion({ id: "Q001", status: "open" }),
        makeQuestion({ id: "Q002", status: "open" }),
      ];
      await mutateStore(tmpDir, [], after);

      const diff = await diffStores(tmpDir, snap);
      expect(diff.nonOpenReopened).toEqual(["Q001"]);
    });
  });

  // ── detectClobber ──

  describe("detectClobber", () => {
    it("returns no clobber for clean integration", () => {
      const verdict = detectClobber({
        findingsBefore: 10,
        findingsAfter: 13,
        findingsAdded: 3,
        findingsRemoved: 0,
        verifiedRemoved: [],
        questionsBefore: 5,
        questionsAfter: 6,
        questionsAdded: 1,
        questionsRemoved: 0,
        nonOpenReopened: [],
      });
      expect(verdict.isClobber).toBe(false);
      expect(verdict.severity).toBe("none");
    });

    it("flags whole-store wipe as critical", () => {
      const verdict = detectClobber({
        findingsBefore: 224,
        findingsAfter: 0,
        findingsAdded: 0,
        findingsRemoved: 224,
        verifiedRemoved: [],
        questionsBefore: 10,
        questionsAfter: 10,
        questionsAdded: 0,
        questionsRemoved: 0,
        nonOpenReopened: [],
      });
      expect(verdict.isClobber).toBe(true);
      expect(verdict.severity).toBe("critical");
      expect(verdict.reasons.some((r) => r.includes("FINDINGS_STORE_WIPE"))).toBe(true);
    });

    it("flags any verified finding removed as critical", () => {
      const verdict = detectClobber({
        findingsBefore: 10,
        findingsAfter: 9,
        findingsAdded: 0,
        findingsRemoved: 1,
        verifiedRemoved: ["F007"],
        questionsBefore: 5,
        questionsAfter: 5,
        questionsAdded: 0,
        questionsRemoved: 0,
        nonOpenReopened: [],
      });
      expect(verdict.isClobber).toBe(true);
      expect(verdict.severity).toBe("critical");
      expect(verdict.reasons.some((r) => r.includes("VERIFIED_FINDING_REMOVED"))).toBe(true);
    });

    it("flags >50% finding loss as critical", () => {
      const verdict = detectClobber({
        findingsBefore: 100,
        findingsAfter: 40,
        findingsAdded: 0,
        findingsRemoved: 60,
        verifiedRemoved: [],
        questionsBefore: 5,
        questionsAfter: 5,
        questionsAdded: 0,
        questionsRemoved: 0,
        nonOpenReopened: [],
      });
      expect(verdict.isClobber).toBe(true);
      expect(verdict.reasons.some((r) => r.includes("FINDINGS_RATIO_LOSS"))).toBe(true);
    });

    it("allows small legitimate rewrites (minor loss under threshold)", () => {
      const verdict = detectClobber({
        findingsBefore: 100,
        findingsAfter: 95,
        findingsAdded: 2,
        findingsRemoved: 7,
        verifiedRemoved: [],
        questionsBefore: 10,
        questionsAfter: 10,
        questionsAdded: 0,
        questionsRemoved: 0,
        nonOpenReopened: [],
      });
      expect(verdict.isClobber).toBe(false);
    });

    it("flags non-open reopened as warning (non-blocking)", () => {
      const verdict = detectClobber({
        findingsBefore: 10,
        findingsAfter: 10,
        findingsAdded: 0,
        findingsRemoved: 0,
        verifiedRemoved: [],
        questionsBefore: 5,
        questionsAfter: 5,
        questionsAdded: 0,
        questionsRemoved: 0,
        nonOpenReopened: ["Q003"],
      });
      expect(verdict.severity).toBe("warning");
      expect(verdict.isClobber).toBe(false);
    });

    it("respects custom thresholds", () => {
      const strict = { ...DEFAULT_CLOBBER_THRESHOLDS, findingsRatioLoss: 0.9 };
      const verdict = detectClobber(
        {
          findingsBefore: 100,
          findingsAfter: 85,
          findingsAdded: 0,
          findingsRemoved: 15,
          verifiedRemoved: [],
          questionsBefore: 5,
          questionsAfter: 5,
          questionsAdded: 0,
          questionsRemoved: 0,
          nonOpenReopened: [],
        },
        strict
      );
      expect(verdict.isClobber).toBe(true);
    });
  });

  // ── restoreStores ──

  describe("restoreStores", () => {
    it("restores findings and questions from snapshot", async () => {
      const originalFindings = [
        makeFinding({ id: "F001", claim: "A" }),
        makeFinding({ id: "F002", claim: "B", status: "verified" }),
      ];
      const originalQuestions = [makeQuestion({ id: "Q001", status: "resolved" })];
      await seedProject(tmpDir, originalFindings, originalQuestions);

      const snap = await snapshotStores(tmpDir, 1);

      // Simulate integration clobber — wipe everything
      await mutateStore(tmpDir, [], []);

      await restoreStores(tmpDir, snap);

      const findingsBack = (
        await readFile(path.join(tmpDir, "knowledge", "findings.jsonl"), "utf-8")
      )
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const questionsBack = (
        await readFile(path.join(tmpDir, "knowledge", "questions.jsonl"), "utf-8")
      )
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(findingsBack).toHaveLength(2);
      expect(findingsBack[0].claim).toBe("A");
      expect(findingsBack[1].claim).toBe("B");
      expect(questionsBack).toHaveLength(1);
      expect(questionsBack[0].id).toBe("Q001");
    });

    it("round-trips: snapshot → clobber → restore → diff is clean", async () => {
      const findings = [makeFinding({ id: "F001" }), makeFinding({ id: "F002" })];
      const questions = [makeQuestion({ id: "Q001" })];
      await seedProject(tmpDir, findings, questions);

      const snap = await snapshotStores(tmpDir, 1);
      await mutateStore(tmpDir, [], []); // clobber

      const clobberDiff = await diffStores(tmpDir, snap);
      expect(detectClobber(clobberDiff).isClobber).toBe(true);

      await restoreStores(tmpDir, snap);
      const postRestoreDiff = await diffStores(tmpDir, snap);
      expect(detectClobber(postRestoreDiff).isClobber).toBe(false);
      expect(postRestoreDiff.findingsAdded).toBe(0);
      expect(postRestoreDiff.findingsRemoved).toBe(0);
    });
  });

  // ── The iter-18 scenario (end-to-end regression) ──

  describe("iter-18 regression", () => {
    it("catches and restores from integration wiping 224 findings", async () => {
      const findings = Array.from({ length: 224 }, (_, i) =>
        makeFinding({
          id: `F${String(i + 1).padStart(3, "0")}`,
          status: i < 30 ? "verified" : "provisional",
        })
      );
      const questions = Array.from({ length: 24 }, (_, i) =>
        makeQuestion({ id: `Q${String(i + 1).padStart(3, "0")}` })
      );
      await seedProject(tmpDir, findings, questions);

      const snap = await snapshotStores(tmpDir, 18);
      expect(snap.findingsCount).toBe(224);
      expect(snap.verifiedFindingIds).toHaveLength(30);

      // Simulate the iter-18 clobber
      await mutateStore(tmpDir, [], questions);

      const diff = await diffStores(tmpDir, snap);
      const verdict = detectClobber(diff);
      expect(verdict.isClobber).toBe(true);
      expect(verdict.severity).toBe("critical");
      expect(diff.findingsRemoved).toBe(224);
      expect(diff.verifiedRemoved).toHaveLength(30);

      await restoreStores(tmpDir, snap);
      const recoveredDiff = await diffStores(tmpDir, snap);
      expect(recoveredDiff.findingsAfter).toBe(224);
      expect(recoveredDiff.verifiedRemoved).toEqual([]);
    });
  });
});
