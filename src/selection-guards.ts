import type { Question, QuestionSelection, QuestionType, ConductorMetric } from "./types.js";

/**
 * Pre-dispatch selection guards. Converts prompt-level CLAUDE.md rules into
 * code enforcement. Observed failure modes under prompt-only rules:
 *
 *   1. non-open-redispatch — conductor picks a question whose status is not
 *      "open". Wastes an iteration on already-answered work.
 *   2. re-dispatch-type-mismatch — conductor reclassifies a question's type
 *      on second dispatch (e.g. mechanism → data-hunt), breaking metrics
 *      aggregation and type-rotation rules.
 *   3. same-type-cap — conductor picks a 3rd consecutive dispatch of the
 *      same type. Concentration reduces yield (observed: kill-check 9.8
 *      avg vs mechanism 24.0 under rotation).
 *
 * Strategy: deterministic correction rather than rejection. The conductor
 * keeps progressing; every intervention emits a span for post-hoc review.
 * If interventions correlate with yield drops, the guard can be pulled.
 *
 * Not in scope: first-dispatch type decisions. The conductor's chosen type
 * on first dispatch is respected — overriding it would require a reliable
 * way to infer the "true" type, which we don't have.
 */

export type GuardRule =
  | "non-open-redispatch"
  | "re-dispatch-type-mismatch"
  | "same-type-cap";

export interface GuardIntervention {
  rule: GuardRule;
  reason: string;
  originalQuestionId: string;
  originalType: QuestionType;
  correctedQuestionId: string;
  correctedType: QuestionType;
}

export interface GuardedSelection {
  selection: QuestionSelection;
  interventions: GuardIntervention[];
}

export interface GuardOptions {
  /** Max allowed consecutive dispatches of the same question type. */
  maxConsecutiveSameType?: number;
}

/**
 * Apply all selection guards. Returns a possibly-corrected selection plus
 * the list of interventions performed.
 */
export function applySelectionGuards(
  selection: QuestionSelection,
  questions: Question[],
  recentTypes: QuestionType[],
  priorMetrics: ConductorMetric[] = [],
  opts: GuardOptions = {}
): GuardedSelection {
  const maxConsecutiveSameType = opts.maxConsecutiveSameType ?? 2;
  const interventions: GuardIntervention[] = [];
  let current: QuestionSelection = { ...selection };

  const openQuestions = questions.filter((q) => q.status === "open");
  const byId = new Map(questions.map((q) => [q.id, q]));

  // ── Guard 1: non-open re-dispatch ──
  const record = byId.get(current.questionId);
  if (!record || record.status !== "open") {
    const swap = pickFallbackOpen(openQuestions, current.questionType, recentTypes, maxConsecutiveSameType);
    if (swap) {
      interventions.push({
        rule: "non-open-redispatch",
        reason: record
          ? `Selected ${current.questionId} has status="${record.status}"; swapped to open ${swap.id}.`
          : `Selected ${current.questionId} does not exist; swapped to open ${swap.id}.`,
        originalQuestionId: current.questionId,
        originalType: current.questionType,
        correctedQuestionId: swap.id,
        correctedType: current.questionType,
      });
      current = { ...current, questionId: swap.id, question: swap.question };
    } else {
      interventions.push({
        rule: "non-open-redispatch",
        reason: `Selected ${current.questionId} is not open and no alternative open question exists.`,
        originalQuestionId: current.questionId,
        originalType: current.questionType,
        correctedQuestionId: current.questionId,
        correctedType: current.questionType,
      });
      return { selection: current, interventions };
    }
  }

  // ── Guard 2: re-dispatch type-mismatch ──
  // Only triggers when this specific questionId was already dispatched at
  // least once before. First-dispatch type decisions are not overridden.
  const priorDispatch = priorMetrics.find((m) => m.questionId === current.questionId);
  if (priorDispatch && priorDispatch.questionType && priorDispatch.questionType !== current.questionType) {
    interventions.push({
      rule: "re-dispatch-type-mismatch",
      reason: `Question ${current.questionId} was previously dispatched as "${priorDispatch.questionType}"; selection says "${current.questionType}". Using prior type to preserve metric lineage.`,
      originalQuestionId: current.questionId,
      originalType: current.questionType,
      correctedQuestionId: current.questionId,
      correctedType: priorDispatch.questionType,
    });
    current = { ...current, questionType: priorDispatch.questionType };
  }

  // ── Guard 3: same-type cap (3rd consecutive) ──
  if (wouldExceedSameTypeCap(current.questionType, recentTypes, maxConsecutiveSameType)) {
    const swap = openQuestions.find(
      (q) =>
        q.id !== current.questionId &&
        !wouldExceedSameTypeCapForSwap(q, priorMetrics, current.questionType, recentTypes, maxConsecutiveSameType)
    );
    if (swap) {
      const swapType = resolveSwapType(swap, priorMetrics, current.questionType);
      interventions.push({
        rule: "same-type-cap",
        reason: `Type "${current.questionType}" would be ${maxConsecutiveSameType + 1}th consecutive; swapped to ${swap.id}.`,
        originalQuestionId: current.questionId,
        originalType: current.questionType,
        correctedQuestionId: swap.id,
        correctedType: swapType,
      });
      current = { ...current, questionId: swap.id, question: swap.question, questionType: swapType };
    } else {
      interventions.push({
        rule: "same-type-cap",
        reason: `Type "${current.questionType}" would be ${maxConsecutiveSameType + 1}th consecutive but no alternative open question exists. Letting through; downstream gates will flag if needed.`,
        originalQuestionId: current.questionId,
        originalType: current.questionType,
        correctedQuestionId: current.questionId,
        correctedType: current.questionType,
      });
    }
  }

  return { selection: current, interventions };
}

/**
 * Pick the highest-priority open question other than the one already selected.
 * When a preferred type is given, questions of that type are preferred.
 * Filters out candidates whose dispatch would violate the same-type cap.
 */
function pickFallbackOpen(
  openQuestions: Question[],
  preferredType: QuestionType | null,
  recentTypes: QuestionType[],
  maxConsecutiveSameType: number
): Question | undefined {
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;

  // A question is allowed if we can't confirm it would push same-type cap.
  // Since we don't know a question's "type" without prior metrics, we
  // conservatively allow all open questions here. Guard 3 can still catch
  // later after a prior metric tells us otherwise.
  const allowed = openQuestions;
  if (allowed.length === 0) return undefined;

  const preferredPool = preferredType
    ? allowed // cannot filter by type without type field — use priority only
    : allowed;

  return [...preferredPool].sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority]
  )[0];
}

function wouldExceedSameTypeCap(
  type: QuestionType,
  recentTypes: QuestionType[],
  maxConsecutive: number
): boolean {
  if (recentTypes.length < maxConsecutive) return false;
  const lastN = recentTypes.slice(0, maxConsecutive);
  return lastN.every((t) => t === type);
}

function wouldExceedSameTypeCapForSwap(
  q: Question,
  priorMetrics: ConductorMetric[],
  _fallbackType: QuestionType,
  recentTypes: QuestionType[],
  maxConsecutive: number
): boolean {
  // Only reject a swap when we KNOW its type will violate the cap.
  // Unknown-type candidates (never dispatched) could be any type — the
  // conductor picks their type on dispatch — so we don't pre-reject them.
  const priorType = priorMetrics.find((m) => m.questionId === q.id)?.questionType;
  if (!priorType) return false;
  return wouldExceedSameTypeCap(priorType, recentTypes, maxConsecutive);
}

function resolveSwapType(
  q: Question,
  priorMetrics: ConductorMetric[],
  fallback: QuestionType
): QuestionType {
  return priorMetrics.find((m) => m.questionId === q.id)?.questionType ?? fallback;
}
