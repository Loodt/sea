import { describe, it, expect } from "vitest";
import { applySelectionGuards } from "../selection-guards.js";
import type {
  Question,
  QuestionSelection,
  QuestionType,
  ConductorMetric,
} from "../types.js";

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "Q001",
    question: "Default question?",
    priority: "medium",
    context: "default context",
    domain: "test",
    iteration: 1,
    status: "open",
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

function makeSelection(overrides: Partial<QuestionSelection> = {}): QuestionSelection {
  return {
    questionId: "Q001",
    question: "Default question?",
    reasoning: "test",
    relevantFindingIds: [],
    suggestedExpertType: "general researcher",
    estimatedIterations: 3,
    questionType: "mechanism",
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
    attritionRate: 0,
    questionsResolved: 1,
    newQuestionsCreated: 0,
    innerIterationsRun: 3,
    timestamp: new Date().toISOString(),
    questionType: "mechanism",
    ...overrides,
  };
}

describe("applySelectionGuards", () => {
  describe("non-open re-dispatch", () => {
    it("swaps selection when target question is not open", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "resolved" }),
        makeQuestion({ id: "Q002", status: "open", priority: "high", question: "Open Q?" }),
      ];
      const selection = makeSelection({ questionId: "Q001", questionType: "mechanism" });

      const { selection: corrected, interventions } = applySelectionGuards(
        selection,
        questions,
        ["mechanism"]
      );

      expect(interventions).toHaveLength(1);
      expect(interventions[0].rule).toBe("non-open-redispatch");
      expect(corrected.questionId).toBe("Q002");
      expect(corrected.question).toBe("Open Q?");
    });

    it("swaps when target does not exist at all", () => {
      const questions = [makeQuestion({ id: "Q002", status: "open", priority: "high" })];
      const selection = makeSelection({ questionId: "QXYZ" });

      const { selection: corrected, interventions } = applySelectionGuards(
        selection,
        questions,
        []
      );

      expect(interventions[0].rule).toBe("non-open-redispatch");
      expect(interventions[0].reason).toContain("does not exist");
      expect(corrected.questionId).toBe("Q002");
    });

    it("prefers high-priority open question as fallback", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "deferred" }),
        makeQuestion({ id: "Q002", status: "open", priority: "low" }),
        makeQuestion({ id: "Q003", status: "open", priority: "high" }),
        makeQuestion({ id: "Q004", status: "open", priority: "medium" }),
      ];
      const selection = makeSelection({ questionId: "Q001" });

      const { selection: corrected } = applySelectionGuards(selection, questions, []);
      expect(corrected.questionId).toBe("Q003");
    });

    it("returns unchanged with intervention note when no open questions exist", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "resolved" }),
        makeQuestion({ id: "Q002", status: "deferred" }),
      ];
      const selection = makeSelection({ questionId: "Q001" });

      const { selection: corrected, interventions } = applySelectionGuards(
        selection,
        questions,
        []
      );

      expect(corrected.questionId).toBe("Q001");
      expect(interventions[0].rule).toBe("non-open-redispatch");
      expect(interventions[0].reason).toContain("no alternative");
    });

    it("treats empirical-gate as non-open", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "empirical-gate" }),
        makeQuestion({ id: "Q002", status: "open", priority: "high" }),
      ];
      const selection = makeSelection({ questionId: "Q001" });

      const { interventions } = applySelectionGuards(selection, questions, []);
      expect(interventions[0].rule).toBe("non-open-redispatch");
    });
  });

  describe("re-dispatch type-mismatch", () => {
    it("corrects type when question was previously dispatched as different type", () => {
      const questions = [makeQuestion({ id: "Q001", status: "open" })];
      const priorMetrics = [makeMetric({ questionId: "Q001", questionType: "mechanism" })];
      const selection = makeSelection({ questionId: "Q001", questionType: "data-hunt" });

      const { selection: corrected, interventions } = applySelectionGuards(
        selection,
        questions,
        [],
        priorMetrics
      );

      expect(interventions).toHaveLength(1);
      expect(interventions[0].rule).toBe("re-dispatch-type-mismatch");
      expect(corrected.questionType).toBe("mechanism");
    });

    it("does not trigger on first dispatch (no prior metric)", () => {
      const questions = [makeQuestion({ id: "Q001", status: "open" })];
      const selection = makeSelection({ questionId: "Q001", questionType: "mechanism" });

      const { interventions } = applySelectionGuards(selection, questions, [], []);
      expect(interventions.filter((i) => i.rule === "re-dispatch-type-mismatch")).toHaveLength(0);
    });

    it("does not trigger when re-dispatch uses same type as prior", () => {
      const questions = [makeQuestion({ id: "Q001", status: "open" })];
      const priorMetrics = [makeMetric({ questionId: "Q001", questionType: "mechanism" })];
      const selection = makeSelection({ questionId: "Q001", questionType: "mechanism" });

      const { interventions } = applySelectionGuards(selection, questions, [], priorMetrics);
      expect(interventions.filter((i) => i.rule === "re-dispatch-type-mismatch")).toHaveLength(0);
    });
  });

  describe("same-type cap (3rd consecutive)", () => {
    it("swaps when type would be 3rd consecutive", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "open" }),
        makeQuestion({ id: "Q002", status: "open", priority: "high" }),
      ];
      const selection = makeSelection({ questionId: "Q001", questionType: "kill-check" });
      const recentTypes: QuestionType[] = ["kill-check", "kill-check"];

      const { selection: corrected, interventions } = applySelectionGuards(
        selection,
        questions,
        recentTypes
      );

      const cap = interventions.find((i) => i.rule === "same-type-cap");
      expect(cap).toBeDefined();
      expect(corrected.questionId).toBe("Q002");
    });

    it("respects custom maxConsecutiveSameType", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "open" }),
        makeQuestion({ id: "Q002", status: "open", priority: "high" }),
      ];
      const selection = makeSelection({ questionId: "Q001", questionType: "mechanism" });

      const { interventions } = applySelectionGuards(
        selection,
        questions,
        ["mechanism"],
        [],
        { maxConsecutiveSameType: 1 }
      );

      expect(interventions.some((i) => i.rule === "same-type-cap")).toBe(true);
    });

    it("does not trigger when recent types are mixed", () => {
      const questions = [makeQuestion({ id: "Q001", status: "open" })];
      const selection = makeSelection({ questionId: "Q001", questionType: "mechanism" });

      const { interventions } = applySelectionGuards(
        selection,
        questions,
        ["data-hunt", "mechanism"]
      );

      expect(interventions.filter((i) => i.rule === "same-type-cap")).toHaveLength(0);
    });

    it("lets through with warning when no alternative open question exists", () => {
      const questions = [makeQuestion({ id: "Q001", status: "open" })];
      const selection = makeSelection({ questionId: "Q001", questionType: "kill-check" });

      const { selection: corrected, interventions } = applySelectionGuards(
        selection,
        questions,
        ["kill-check", "kill-check"]
      );

      expect(corrected.questionId).toBe("Q001");
      const cap = interventions.find((i) => i.rule === "same-type-cap");
      expect(cap).toBeDefined();
      expect(cap!.reason).toContain("no alternative");
    });
  });

  describe("clean paths", () => {
    it("returns zero interventions when selection is valid", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "open" }),
        makeQuestion({ id: "Q002", status: "open" }),
      ];
      const selection = makeSelection({ questionId: "Q001", questionType: "mechanism" });

      const { interventions } = applySelectionGuards(
        selection,
        questions,
        ["data-hunt", "synthesis"]
      );

      expect(interventions).toHaveLength(0);
    });
  });

  describe("combined guard interactions", () => {
    it("chains non-open-redispatch and same-type-cap if both would trigger", () => {
      const questions = [
        makeQuestion({ id: "Q001", status: "deferred" }),
        makeQuestion({ id: "Q002", status: "open", priority: "high" }),
      ];
      const selection = makeSelection({ questionId: "Q001", questionType: "kill-check" });
      const recentTypes: QuestionType[] = ["kill-check", "kill-check"];

      const { interventions } = applySelectionGuards(selection, questions, recentTypes);
      // At minimum the first intervention should fire
      expect(interventions.length).toBeGreaterThanOrEqual(1);
      expect(interventions[0].rule).toBe("non-open-redispatch");
    });
  });
});
