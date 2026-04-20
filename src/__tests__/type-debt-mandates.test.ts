import { describe, it, expect } from "vitest";
import {
  evaluateMandates,
  buildMandateQuestion,
  applyMandateHardBlock,
} from "../type-debt-mandates.js";
import type {
  ConductorMetric,
  Finding,
  Question,
  QuestionSelection,
  QuestionType,
} from "../types.js";

// ── factories ─────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F001",
    claim: "c",
    tag: "SOURCE",
    source: "https://x",
    confidence: 0.9,
    domain: "d",
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
    question: "q",
    priority: "medium",
    context: "",
    domain: "d",
    iteration: 1,
    status: "open",
    questionType: "landscape",
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
    findingsAdded: 5,
    findingsPersisted: 5,
    questionsResolved: 1,
    newQuestionsCreated: 0,
    innerIterationsRun: 3,
    timestamp: "2026-01-01T00:00:00Z",
    questionType: "landscape",
    ...overrides,
  };
}

function verifiedFindings(n: number): Finding[] {
  return Array.from({ length: n }, (_, i) =>
    makeFinding({ id: `F${String(i + 1).padStart(3, "0")}`, status: "verified" })
  );
}

// ── evaluateMandates ──────────────────────────────────────────────────────

describe("evaluateMandates", () => {
  it("no mandate when iteration < 5 and store empty", () => {
    const r = evaluateMandates([], [], [], 3);
    expect(r.eligible).toBe(false);
    expect(r.type).toBeNull();
  });

  it("fires fp-missing at iter 5 with 5 verified and 0 FP ever", () => {
    const findings = verifiedFindings(5);
    const metrics = [makeMetric({ questionType: "data-hunt" })];
    const r = evaluateMandates(findings, [], metrics, 5);
    expect(r.eligible).toBe(true);
    expect(r.type).toBe("first-principles");
    expect(r.reason).toBe("fp-missing");
  });

  it("does NOT fire fp-missing when FP was already dispatched", () => {
    const findings = verifiedFindings(5);
    const metrics = [makeMetric({ questionType: "first-principles" })];
    const r = evaluateMandates(findings, [], metrics, 5);
    expect(r.eligible).toBe(false);
  });

  it("does NOT fire fp-missing under 5 verified", () => {
    const findings = verifiedFindings(4);
    const r = evaluateMandates(findings, [], [], 5);
    expect(r.eligible).toBe(false);
  });

  it("fires mechanism-missing at iter 6 with 3 reasoning-type answers and 0 mechanism ever", () => {
    const metrics: ConductorMetric[] = [
      makeMetric({ questionType: "first-principles", expertStatus: "answered" }),
      makeMetric({ questionType: "design-space", expertStatus: "answered" }),
      makeMetric({ questionType: "first-principles", expertStatus: "answered" }),
    ];
    const r = evaluateMandates([], [], metrics, 6);
    expect(r.eligible).toBe(true);
    expect(r.type).toBe("mechanism");
    expect(r.reason).toBe("mechanism-missing");
  });

  it("does NOT fire mechanism-missing when mechanism was already dispatched", () => {
    const metrics: ConductorMetric[] = [
      makeMetric({ questionType: "mechanism" }),
      makeMetric({ questionType: "first-principles", expertStatus: "answered" }),
      makeMetric({ questionType: "first-principles", expertStatus: "answered" }),
      makeMetric({ questionType: "first-principles", expertStatus: "answered" }),
    ];
    const r = evaluateMandates([], [], metrics, 6);
    expect(r.eligible).toBe(false);
  });

  it("fires synthesis-missing at 60 findings with 0 synthesis ever", () => {
    const findings = Array.from({ length: 60 }, (_, i) =>
      makeFinding({ id: `F${i}`, status: "provisional" })
    );
    const r = evaluateMandates(findings, [], [], 10);
    expect(r.eligible).toBe(true);
    expect(r.type).toBe("synthesis");
    expect(r.reason).toBe("synthesis-missing");
  });

  it("fires synthesis-cadence at store ≥100, 8+ dispatches since last synthesis, grew ≥30", () => {
    // 100 findings, last synthesis at metric[0] with 65 findings at that time,
    // 8 subsequent dispatches each adding 5 findings → grew 35 since synthesis.
    const findings = Array.from({ length: 100 }, (_, i) =>
      makeFinding({ id: `F${i}`, status: "provisional" })
    );
    const metrics: ConductorMetric[] = [
      makeMetric({ questionType: "synthesis", findingsPersisted: 65 }),
      ...Array.from({ length: 8 }, () =>
        makeMetric({ questionType: "data-hunt", findingsPersisted: 5 })
      ),
    ];
    const r = evaluateMandates(findings, [], metrics, 10);
    expect(r.eligible).toBe(true);
    expect(r.type).toBe("synthesis");
    expect(r.reason).toBe("synthesis-cadence");
  });

  it("reports hasOpenOfType correctly", () => {
    const findings = verifiedFindings(5);
    const questions = [
      makeQuestion({ id: "Q010", questionType: "first-principles", status: "open" }),
    ];
    const metrics = [makeMetric({ questionType: "data-hunt" })];
    const r = evaluateMandates(findings, questions, metrics, 5);
    expect(r.eligible).toBe(true);
    expect(r.hasOpenOfType).toBe(true);
  });

  it("hasOpenOfType is false when mandated-type question is resolved", () => {
    const findings = verifiedFindings(5);
    const questions = [
      makeQuestion({ id: "Q010", questionType: "first-principles", status: "resolved" }),
    ];
    const metrics = [makeMetric({ questionType: "data-hunt" })];
    const r = evaluateMandates(findings, questions, metrics, 5);
    expect(r.hasOpenOfType).toBe(false);
  });

  it("synthesis-missing takes priority over fp-missing", () => {
    const findings: Finding[] = [
      ...verifiedFindings(5),
      ...Array.from({ length: 55 }, (_, i) =>
        makeFinding({ id: `F${i + 100}`, status: "provisional" })
      ),
    ];
    const metrics = [makeMetric({ questionType: "data-hunt" })];
    const r = evaluateMandates(findings, [], metrics, 5);
    // Both would fire; synthesis-missing wins
    expect(r.type).toBe("synthesis");
  });
});

// ── buildMandateQuestion ──────────────────────────────────────────────────

describe("buildMandateQuestion", () => {
  it("returns null when mandate is not eligible", () => {
    const q = buildMandateQuestion(
      { eligible: false, type: null, reason: null, hasOpenOfType: false, explanation: "" },
      [],
      [],
      5
    );
    expect(q).toBeNull();
  });

  it("builds an FP question with correct type and status", () => {
    const mandate = {
      eligible: true,
      type: "first-principles" as const,
      reason: "fp-missing" as const,
      hasOpenOfType: false,
      explanation: "test",
    };
    const findings = verifiedFindings(5);
    const existing = [makeQuestion({ id: "Q003" })];
    const q = buildMandateQuestion(mandate, findings, existing, 5);
    expect(q).not.toBeNull();
    expect(q!.questionType).toBe("first-principles");
    expect(q!.status).toBe("open");
    expect(q!.priority).toBe("high");
    expect(q!.iteration).toBe(5);
    expect(q!.id).toBe("Q004"); // next ID
    expect(q!.notes).toContain("fp-missing");
  });

  it("computes next ID from existing question prefix", () => {
    const mandate = {
      eligible: true,
      type: "synthesis" as const,
      reason: "synthesis-missing" as const,
      hasOpenOfType: false,
      explanation: "test",
    };
    const existing = [
      makeQuestion({ id: "LQ012" }),
      makeQuestion({ id: "LQ007" }),
    ];
    const q = buildMandateQuestion(mandate, [], existing, 10);
    expect(q!.id).toBe("LQ013");
  });

  it("picks the top-count domain as the question domain", () => {
    const mandate = {
      eligible: true,
      type: "synthesis" as const,
      reason: "synthesis-missing" as const,
      hasOpenOfType: false,
      explanation: "test",
    };
    const findings: Finding[] = [
      makeFinding({ id: "F1", domain: "domain-a" }),
      makeFinding({ id: "F2", domain: "domain-a" }),
      makeFinding({ id: "F3", domain: "domain-a" }),
      makeFinding({ id: "F4", domain: "domain-b" }),
    ];
    const q = buildMandateQuestion(mandate, findings, [makeQuestion()], 5);
    expect(q!.domain).toBe("domain-a");
  });
});

// ── applyMandateHardBlock ─────────────────────────────────────────────────

function makeSelection(overrides: Partial<QuestionSelection> = {}): QuestionSelection {
  return {
    questionId: "Q001",
    question: "q",
    reasoning: "r",
    relevantFindingIds: [],
    suggestedExpertType: "generic",
    estimatedIterations: 3,
    questionType: "data-hunt",
    ...overrides,
  };
}

describe("applyMandateHardBlock", () => {
  const mandate = {
    eligible: true,
    type: "first-principles" as const,
    reason: "fp-missing" as const,
    hasOpenOfType: true,
    explanation: "test",
  };

  it("returns null when mandate not eligible", () => {
    const r = applyMandateHardBlock(
      { eligible: false, type: null, reason: null, hasOpenOfType: false, explanation: "" },
      makeSelection(),
      [],
      []
    );
    expect(r).toBeNull();
  });

  it("returns null when selector already picked the mandated type", () => {
    const r = applyMandateHardBlock(
      mandate,
      makeSelection({ questionType: "first-principles" }),
      [makeQuestion({ id: "Q010", questionType: "first-principles" })],
      []
    );
    expect(r).toBeNull();
  });

  it("returns null when no open question of mandated type exists", () => {
    const noOpenMandate = { ...mandate, hasOpenOfType: false };
    const r = applyMandateHardBlock(
      noOpenMandate,
      makeSelection(),
      [],
      []
    );
    expect(r).toBeNull();
  });

  it("overrides selection when mandated type is available and selector picked otherwise", () => {
    const questions = [
      makeQuestion({ id: "Q010", questionType: "first-principles", status: "open" }),
      makeQuestion({ id: "Q001", questionType: "data-hunt", status: "open" }),
    ];
    const r = applyMandateHardBlock(
      mandate,
      makeSelection({ questionId: "Q001", questionType: "data-hunt" }),
      questions,
      []
    );
    expect(r).not.toBeNull();
    expect(r!.correctedQuestionId).toBe("Q010");
    expect(r!.correctedType).toBe("first-principles");
    expect(r!.originalType).toBe("data-hunt");
  });

  it("does NOT override when last 2 dispatches were mandated type (same-type-cap defence)", () => {
    const questions = [
      makeQuestion({ id: "Q010", questionType: "first-principles", status: "open" }),
      makeQuestion({ id: "Q001", questionType: "data-hunt", status: "open" }),
    ];
    const recentTypes: QuestionType[] = ["first-principles", "first-principles"];
    const r = applyMandateHardBlock(
      mandate,
      makeSelection({ questionId: "Q001", questionType: "data-hunt" }),
      questions,
      recentTypes
    );
    expect(r).toBeNull();
  });
});
