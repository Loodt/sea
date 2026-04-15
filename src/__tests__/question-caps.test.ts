import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  applyQuestionCaps,
  applyTypeQueueCap,
  applyIterBoundaryCap,
  applyPerDispatchCap,
  computeIterBoundaryCap,
} from "../question-caps.js";
import type { Question, ConductorMetric, QuestionType } from "../types.js";

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "Q001",
    question: "Default?",
    priority: "medium",
    context: "c",
    domain: "test",
    iteration: 1,
    status: "open",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function makeMetric(id: string, type: QuestionType): ConductorMetric {
  return {
    conductorIteration: 1,
    questionId: id,
    expertStatus: "answered",
    findingsAdded: 0,
    findingsPersisted: 0,
    attritionRate: 0,
    questionsResolved: 0,
    newQuestionsCreated: 0,
    innerIterationsRun: 0,
    timestamp: new Date().toISOString(),
    questionType: type,
  };
}

async function seedQuestions(projectDir: string, questions: Question[]) {
  await mkdir(path.join(projectDir, "knowledge"), { recursive: true });
  await writeFile(
    path.join(projectDir, "knowledge", "questions.jsonl"),
    questions.map((q) => JSON.stringify(q)).join("\n") + (questions.length ? "\n" : ""),
    "utf-8"
  );
}

async function readStoredQuestions(projectDir: string): Promise<Question[]> {
  const content = await readFile(
    path.join(projectDir, "knowledge", "questions.jsonl"),
    "utf-8"
  );
  if (!content.trim()) return [];
  return content.trim().split("\n").map((l) => JSON.parse(l));
}

describe("computeIterBoundaryCap", () => {
  it("returns Infinity before iter 12", () => {
    expect(computeIterBoundaryCap([], 5)).toBe(Infinity);
    expect(computeIterBoundaryCap([], 11)).toBe(Infinity);
  });

  it("caps at 1 when iter ≥12 and open >12", () => {
    const qs = Array.from({ length: 13 }, (_, i) =>
      makeQuestion({ id: `Q${i}`, status: "open" })
    );
    expect(computeIterBoundaryCap(qs, 12)).toBe(1);
  });

  it("does not cap at iter 12 if open ≤12", () => {
    const qs = Array.from({ length: 10 }, (_, i) =>
      makeQuestion({ id: `Q${i}`, status: "open" })
    );
    expect(computeIterBoundaryCap(qs, 12)).toBe(Infinity);
  });

  it("caps at 1 unconditionally from iter 15", () => {
    expect(computeIterBoundaryCap([], 15)).toBe(1);
    expect(computeIterBoundaryCap([], 16)).toBe(1);
    expect(computeIterBoundaryCap([], 17)).toBe(1);
  });

  it("caps at 0 when iter ≥18 and open >8", () => {
    const qs = Array.from({ length: 9 }, (_, i) =>
      makeQuestion({ id: `Q${i}`, status: "open" })
    );
    expect(computeIterBoundaryCap(qs, 18)).toBe(0);
  });

  it("caps at 0 when iter ≥20 and resolved >70%", () => {
    const qs = [
      ...Array.from({ length: 8 }, (_, i) => makeQuestion({ id: `R${i}`, status: "resolved" })),
      makeQuestion({ id: "O1", status: "open" }),
      makeQuestion({ id: "O2", status: "open" }),
    ];
    expect(computeIterBoundaryCap(qs, 20)).toBe(0);
  });
});

describe("applyIterBoundaryCap (pure)", () => {
  it("trims new-this-iter down to the cap", () => {
    const qs = [
      ...Array.from({ length: 13 }, (_, i) =>
        makeQuestion({ id: `O${i}`, iteration: 1, status: "open" })
      ),
      makeQuestion({ id: "NEW1", iteration: 12, status: "open", priority: "low" }),
      makeQuestion({ id: "NEW2", iteration: 12, status: "open", priority: "medium" }),
      makeQuestion({ id: "NEW3", iteration: 12, status: "open", priority: "high" }),
    ];

    const action = applyIterBoundaryCap(qs, 12);
    expect(action).not.toBeNull();
    expect(action!.effectiveCap).toBe(1);
    expect(action!.observedCount).toBe(3);
    expect(action!.removedQuestionIds).toHaveLength(2);
    // high-priority NEW3 should survive; low NEW1 should be first to go
    expect(action!.removedQuestionIds).toContain("NEW1");
    expect(action!.removedQuestionIds).not.toContain("NEW3");
  });

  it("returns null when new question count is under cap", () => {
    const qs = [makeQuestion({ id: "NEW1", iteration: 15, status: "open" })];
    const action = applyIterBoundaryCap(qs, 15);
    expect(action).toBeNull();
  });

  it("returns null when no cap applies at this iter", () => {
    const qs = Array.from({ length: 5 }, (_, i) =>
      makeQuestion({ id: `Q${i}`, iteration: 5, status: "open" })
    );
    expect(applyIterBoundaryCap(qs, 5)).toBeNull();
  });
});

describe("applyPerDispatchCap", () => {
  it("caps non-landscape at 3 new", () => {
    const qs = Array.from({ length: 5 }, (_, i) =>
      makeQuestion({ id: `NEW${i}`, iteration: 3, status: "open" })
    );
    const action = applyPerDispatchCap(qs, { conductorIteration: 3, landscapeDispatch: false });
    expect(action!.effectiveCap).toBe(3);
    expect(action!.removedQuestionIds).toHaveLength(2);
  });

  it("caps landscape at 5 new", () => {
    const qs = Array.from({ length: 7 }, (_, i) =>
      makeQuestion({ id: `NEW${i}`, iteration: 3, status: "open" })
    );
    const action = applyPerDispatchCap(qs, { conductorIteration: 3, landscapeDispatch: true });
    expect(action!.effectiveCap).toBe(5);
    expect(action!.removedQuestionIds).toHaveLength(2);
  });

  it("returns null when under cap", () => {
    const qs = Array.from({ length: 2 }, (_, i) =>
      makeQuestion({ id: `NEW${i}`, iteration: 3 })
    );
    expect(applyPerDispatchCap(qs, { conductorIteration: 3, landscapeDispatch: false })).toBeNull();
  });

  it("ignores questions from other iterations", () => {
    const qs = [
      ...Array.from({ length: 10 }, (_, i) => makeQuestion({ id: `OLD${i}`, iteration: 1 })),
      ...Array.from({ length: 2 }, (_, i) => makeQuestion({ id: `NEW${i}`, iteration: 3 })),
    ];
    expect(applyPerDispatchCap(qs, { conductorIteration: 3, landscapeDispatch: false })).toBeNull();
  });
});

describe("applyTypeQueueCap (pure)", () => {
  it("trims new-this-iter of type exceeding its dispatch cap", () => {
    const qs = [
      // 3 existing open design-space (under cap of 4)
      ...Array.from({ length: 3 }, (_, i) =>
        makeQuestion({ id: `DS${i}`, iteration: 1, status: "open" })
      ),
      // 3 new design-space added this iter — would push to 6, cap is 4
      // overflow = 2 of 3 trimmable, so priority determines survivor
      makeQuestion({ id: "NEW_DS1", iteration: 5, status: "open", priority: "low" }),
      makeQuestion({ id: "NEW_DS2", iteration: 5, status: "open", priority: "medium" }),
      makeQuestion({ id: "NEW_DS3", iteration: 5, status: "open", priority: "high" }),
    ];
    const metrics: ConductorMetric[] = [
      makeMetric("DS0", "design-space"),
      makeMetric("DS1", "design-space"),
      makeMetric("DS2", "design-space"),
      makeMetric("NEW_DS1", "design-space"),
      makeMetric("NEW_DS2", "design-space"),
      makeMetric("NEW_DS3", "design-space"),
    ];

    const actions = applyTypeQueueCap(qs, 5, metrics);
    expect(actions).toHaveLength(1);
    expect(actions[0].rule).toBe("type-queue-cap");
    expect(actions[0].observedCount).toBe(6);
    expect(actions[0].effectiveCap).toBe(4);
    expect(actions[0].removedQuestionIds).toHaveLength(2);
    expect(actions[0].removedQuestionIds).toContain("NEW_DS1"); // low first
    expect(actions[0].removedQuestionIds).not.toContain("NEW_DS3"); // high survives
  });

  it("does not trim pre-existing overflow (only new-this-iter)", () => {
    // 15 pre-existing design-space, cap 4, but no new this iter
    const qs = Array.from({ length: 15 }, (_, i) =>
      makeQuestion({ id: `DS${i}`, iteration: 1, status: "open" })
    );
    const metrics: ConductorMetric[] = qs.map((q) => makeMetric(q.id, "design-space"));

    const actions = applyTypeQueueCap(qs, 5, metrics);
    expect(actions).toHaveLength(0);
  });

  it("returns empty when all types under cap", () => {
    const qs = [
      makeQuestion({ id: "NEW1", iteration: 3, status: "open" }),
      makeQuestion({ id: "NEW2", iteration: 3, status: "open" }),
    ];
    const metrics = [
      makeMetric("NEW1", "mechanism"),
      makeMetric("NEW2", "data-hunt"),
    ];
    expect(applyTypeQueueCap(qs, 3, metrics)).toHaveLength(0);
  });

  it("ignores questions with no known type (not yet dispatched)", () => {
    const qs = Array.from({ length: 10 }, (_, i) =>
      makeQuestion({ id: `Q${i}`, iteration: 1, status: "open" })
    );
    expect(applyTypeQueueCap(qs, 3, [])).toHaveLength(0);
  });
});

describe("applyQuestionCaps (integration)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-caps-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("no-ops when no caps would trigger", async () => {
    const qs = [
      makeQuestion({ id: "Q1", iteration: 3, status: "open" }),
      makeQuestion({ id: "Q2", iteration: 3, status: "open" }),
    ];
    await seedQuestions(tmpDir, qs);

    const actions = await applyQuestionCaps(tmpDir, { conductorIteration: 3, landscapeDispatch: false });
    expect(actions).toHaveLength(0);

    const after = await readStoredQuestions(tmpDir);
    expect(after).toHaveLength(2);
  });

  it("iter-15 regression: prior state has 13 open, dispatch creates 5 new → cap to 1", async () => {
    const qs = [
      ...Array.from({ length: 13 }, (_, i) =>
        makeQuestion({ id: `OLD${i}`, iteration: 14, status: "open" })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeQuestion({
          id: `NEW${i}`,
          iteration: 15,
          status: "open",
          priority: i === 0 ? "high" : "low",
        })
      ),
    ];
    await seedQuestions(tmpDir, qs);

    const actions = await applyQuestionCaps(tmpDir, { conductorIteration: 15, landscapeDispatch: false });
    const after = await readStoredQuestions(tmpDir);

    // Iter-15 cap is 1. Started with 5 new. The per-dispatch cap (3) fires
    // first in pure form, but applyQuestionCaps composes: type-queue
    // (none), iter-boundary (cap 1, trims 4), per-dispatch (cap 3,
    // already under). Net: 1 new remains.
    const newAfter = after.filter((q) => q.iteration === 15);
    expect(newAfter.length).toBeLessThanOrEqual(1);
    // The high-priority one should survive
    expect(newAfter.every((q) => q.priority === "high")).toBe(true);
    expect(actions.some((a) => a.rule === "iter-boundary-new")).toBe(true);
  });

  it("design-space accumulation regression (15 open vs 4 cap, 3 new this iter)", async () => {
    const qs = [
      // 4 pre-existing design-space (at cap already)
      ...Array.from({ length: 4 }, (_, i) =>
        makeQuestion({ id: `DS${i}`, iteration: 3, status: "open" })
      ),
      // 3 new design-space added this iter — would push to 7
      ...Array.from({ length: 3 }, (_, i) =>
        makeQuestion({
          id: `NEW_DS${i}`,
          iteration: 6,
          status: "open",
          priority: i === 0 ? "high" : "low",
        })
      ),
    ];
    await seedQuestions(tmpDir, qs);

    const metrics: ConductorMetric[] = [
      ...Array.from({ length: 4 }, (_, i) => makeMetric(`DS${i}`, "design-space")),
      ...Array.from({ length: 3 }, (_, i) => makeMetric(`NEW_DS${i}`, "design-space")),
    ];

    const actions = await applyQuestionCaps(
      tmpDir,
      { conductorIteration: 6, landscapeDispatch: false },
      metrics
    );
    const after = await readStoredQuestions(tmpDir);

    expect(actions.some((a) => a.rule === "type-queue-cap")).toBe(true);
    // All 3 new should be trimmed (type already at cap)
    const newAfter = after.filter((q) => q.iteration === 6);
    expect(newAfter).toHaveLength(0);
    // Pre-existing 4 untouched
    expect(after.filter((q) => q.iteration === 3)).toHaveLength(4);
  });

  it("composes all three rules without double-counting a removal", async () => {
    // Scenario: 7 new data-hunt at iter 15. Iter cap = 1. Per-dispatch cap = 3.
    // Type cap: data-hunt capped at 5.
    const qs = Array.from({ length: 7 }, (_, i) =>
      makeQuestion({
        id: `NEW${i}`,
        iteration: 15,
        status: "open",
        priority: i === 0 ? "high" : "low",
      })
    );
    await seedQuestions(tmpDir, qs);
    const metrics = qs.map((q) => makeMetric(q.id, "data-hunt"));

    const actions = await applyQuestionCaps(
      tmpDir,
      { conductorIteration: 15, landscapeDispatch: false },
      metrics
    );
    const after = await readStoredQuestions(tmpDir);

    // Iter-15 caps total new to 1. Regardless of composition, at most 1 new remains.
    expect(after.filter((q) => q.iteration === 15).length).toBeLessThanOrEqual(1);
    // No question should appear in multiple removedQuestionIds across actions
    const allRemoved = actions.flatMap((a) => a.removedQuestionIds);
    expect(new Set(allRemoved).size).toBe(allRemoved.length);
  });
});
