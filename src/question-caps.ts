import path from "node:path";
import { atomicUpdateJsonl } from "./file-lock.js";
import type { Question, QuestionType, ConductorMetric } from "./types.js";
import { QUESTION_TYPE_DISPATCH_CAP, PER_DISPATCH_NEW_QUESTION_CAP } from "./types.js";

/**
 * Post-integration question-store trim.
 *
 * Integration frequently creates more questions than downstream rules permit.
 * Prompt-level caps (Iter 15+ → cap new at 1, type cap when open > dispatch cap,
 * non-landscape ≤3 per dispatch) have been repeatedly violated — observed in
 * CLAUDE.md Infrastructure Debt history: iters 12/15/19/20 convergence caps
 * violated, 15 open design-space vs 4 cap (3.75×) on jarvis-architecture.
 *
 * This module enforces the caps in code after integration runs:
 *   - per-type queue cap: if open[type] > dispatchCap[type], trim new-this-iter
 *     of that type until under cap.
 *   - iter-boundary new-question cap: at iter 12/15/18/20 thresholds, trim
 *     total new-this-iter to the allowed count.
 *   - per-dispatch cap: landscape ≤5, non-landscape ≤3 new per dispatch.
 *
 * Trim policy: drop lowest-priority questions first, tiebreak by file order
 * (last-added first). The intent is to preserve what the LLM prioritized.
 */

export type CapRule =
  | "per-dispatch-new"
  | "iter-boundary-new"
  | "type-queue-cap";

export interface CapTrimAction {
  rule: CapRule;
  reason: string;
  removedQuestionIds: string[];
  effectiveCap: number;
  observedCount: number;
}

export interface IterContext {
  conductorIteration: number;
  landscapeDispatch: boolean;
}

/**
 * Apply all caps to the questions store in a single atomic write.
 * Returns the list of actions taken so the caller can log them.
 */
export async function applyQuestionCaps(
  projectDir: string,
  ctx: IterContext,
  priorMetrics: ConductorMetric[] = []
): Promise<CapTrimAction[]> {
  const actions: CapTrimAction[] = [];

  await atomicUpdateJsonl<Question>(
    path.join(projectDir, "knowledge", "questions.jsonl"),
    (questions) => {
      let working = [...questions];

      const typeQueueActions = applyTypeQueueCap(working, ctx.conductorIteration, priorMetrics);
      if (typeQueueActions.length > 0) {
        working = removeByIds(working, typeQueueActions);
        actions.push(...typeQueueActions);
      }

      const iterBoundaryAction = applyIterBoundaryCap(working, ctx.conductorIteration);
      if (iterBoundaryAction) {
        working = removeByIds(working, [iterBoundaryAction]);
        actions.push(iterBoundaryAction);
      }

      const perDispatchAction = applyPerDispatchCap(working, ctx);
      if (perDispatchAction) {
        working = removeByIds(working, [perDispatchAction]);
        actions.push(perDispatchAction);
      }

      return working;
    }
  );

  return actions;
}

/**
 * Pure function: given a question list, compute which new-this-iter questions
 * would violate the per-type open-queue cap and should be removed.
 *
 * We need to know each question's type. Question records don't carry an
 * explicit type field today; we derive it from prior metrics where possible,
 * otherwise fall back to counting by question id cluster (not ideal — but
 * the design-space case we want to catch is exactly the one we CAN detect:
 * new questions from integration will get their type set on first dispatch,
 * so today we only trim when we can identify the type unambiguously).
 *
 * In practice: this function is called with the priorMetrics in
 * applyQuestionCapsWithMetrics; the simpler overload below is for tests that
 * stub the per-type count directly.
 */
export function applyTypeQueueCap(
  questions: Question[],
  iter: number,
  priorMetrics: ConductorMetric[] = []
): CapTrimAction[] {
  const actions: CapTrimAction[] = [];

  // Count open questions by type (using metrics to identify type; fall back
  // to "unknown" which can't be capped without a type label).
  const typeOfQuestion = buildTypeIndex(questions, priorMetrics);
  const openByType = new Map<QuestionType, Question[]>();
  for (const q of questions) {
    if (q.status !== "open") continue;
    const t = typeOfQuestion.get(q.id);
    if (!t) continue;
    if (!openByType.has(t)) openByType.set(t, []);
    openByType.get(t)!.push(q);
  }

  for (const [type, openList] of openByType) {
    const cap = QUESTION_TYPE_DISPATCH_CAP[type];
    if (openList.length <= cap) continue;

    const overflow = openList.length - cap;
    // Only trim NEW questions added this iteration; pre-existing overflow
    // is not our window to close (would delete user-prioritized questions).
    const trimmable = openList.filter((q) => q.iteration === iter);
    if (trimmable.length === 0) continue;

    const toRemove = selectForTrim(trimmable, Math.min(overflow, trimmable.length));
    if (toRemove.length === 0) continue;

    actions.push({
      rule: "type-queue-cap",
      reason: `Type "${type}" open count ${openList.length} exceeds dispatch cap ${cap}; trimmed ${toRemove.length} new-this-iter to reduce queue.`,
      removedQuestionIds: toRemove.map((q) => q.id),
      effectiveCap: cap,
      observedCount: openList.length,
    });
  }

  return actions;
}

/**
 * Pure function: compute the iter-boundary new-question cap based on the
 * convergence schedule in CLAUDE.md and return the trim action (if any).
 *
 * Thresholds (most-restrictive wins):
 *   iter ≥20 AND resolved >70% → 0 (for non-kill-check — approximated as 0 total here)
 *   iter ≥18 AND open >8       → 0
 *   iter ≥15                    → 1
 *   iter ≥12 AND open >12       → 1
 *   otherwise                   → no cap
 */
export function applyIterBoundaryCap(questions: Question[], iter: number): CapTrimAction | null {
  const cap = computeIterBoundaryCap(questions, iter);
  if (cap === Infinity) return null;

  const newThisIter = questions.filter((q) => q.iteration === iter);
  if (newThisIter.length <= cap) return null;

  const overflow = newThisIter.length - cap;
  const toRemove = selectForTrim(newThisIter, overflow);
  if (toRemove.length === 0) return null;

  return {
    rule: "iter-boundary-new",
    reason: `Iter ${iter} convergence cap = ${cap}; ${newThisIter.length} new questions created, trimmed ${toRemove.length}.`,
    removedQuestionIds: toRemove.map((q) => q.id),
    effectiveCap: cap,
    observedCount: newThisIter.length,
  };
}

export function computeIterBoundaryCap(questions: Question[], iter: number): number {
  const open = questions.filter((q) => q.status === "open").length;
  const resolved = questions.filter((q) => q.status === "resolved").length;
  const total = questions.length;
  const resolvedPct = total > 0 ? resolved / total : 0;

  if (iter >= 20 && resolvedPct > 0.7) return 0;
  if (iter >= 18 && open > 8) return 0;
  if (iter >= 15) return 1;
  if (iter >= 12 && open > 12) return 1;
  return Infinity;
}

/**
 * Per-dispatch new-question cap: landscape dispatches may create ≤5 new
 * questions; all other types ≤3. This is enforced as a ceiling on top of
 * any previous trims.
 */
export function applyPerDispatchCap(
  questions: Question[],
  ctx: IterContext
): CapTrimAction | null {
  const cap = ctx.landscapeDispatch
    ? PER_DISPATCH_NEW_QUESTION_CAP.landscape
    : PER_DISPATCH_NEW_QUESTION_CAP.other;

  const newThisIter = questions.filter((q) => q.iteration === ctx.conductorIteration);
  if (newThisIter.length <= cap) return null;

  const overflow = newThisIter.length - cap;
  const toRemove = selectForTrim(newThisIter, overflow);
  if (toRemove.length === 0) return null;

  return {
    rule: "per-dispatch-new",
    reason: `Per-dispatch cap = ${cap} (${ctx.landscapeDispatch ? "landscape" : "non-landscape"}); ${newThisIter.length} new questions created, trimmed ${toRemove.length}.`,
    removedQuestionIds: toRemove.map((q) => q.id),
    effectiveCap: cap,
    observedCount: newThisIter.length,
  };
}

/**
 * Sort candidates lowest-priority-first, then reverse file order (last-added
 * first) as tiebreaker. Take the first N. Preserves what the LLM flagged as
 * important and removes the tail/weakest.
 */
function selectForTrim(candidates: Question[], n: number): Question[] {
  const rank = { low: 0, medium: 1, high: 2 } as const; // lower rank trimmed first
  const sorted = [...candidates].sort((a, b) => {
    const priDelta = rank[a.priority] - rank[b.priority];
    if (priDelta !== 0) return priDelta;
    // tiebreak: later position (higher index) trimmed first
    return candidates.indexOf(b) - candidates.indexOf(a);
  });
  return sorted.slice(0, n);
}

function removeByIds(questions: Question[], actions: CapTrimAction[]): Question[] {
  const removed = new Set(actions.flatMap((a) => a.removedQuestionIds));
  if (removed.size === 0) return questions;
  return questions.filter((q) => !removed.has(q.id));
}

/**
 * Build a question-id → type index from conductor metrics. Questions not
 * in the metrics log have no known type; they cannot be per-type capped
 * until they're dispatched once (which is fine — the queue cap only
 * constrains creation, not existing inventory).
 */
function buildTypeIndex(
  questions: Question[],
  metrics: ConductorMetric[]
): Map<string, QuestionType> {
  const idx = new Map<string, QuestionType>();
  for (const m of metrics) {
    if (m.questionType) idx.set(m.questionId, m.questionType);
  }
  return idx;
}

