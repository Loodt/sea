import type {
  ConductorMetric,
  Finding,
  Question,
  QuestionSelection,
  QuestionType,
} from "./types.js";

/**
 * Type-debt mandate enforcement. Converts CLAUDE.md "boosted priors" into
 * code — prompt-only revisions v051-v056 failed to force FP/mechanism/
 * design-space creation+dispatch across 29 local-llm-stack iterations.
 *
 * Four mandate conditions from CLAUDE.md:
 *   1. FP-missing: iter ≥5 AND 0 FP ever AND verified ≥5
 *   2. mechanism-missing: iter ≥6 AND 0 mechanism ever AND ≥3 reasoning-type answers
 *   3. synthesis-missing: 0 synthesis ever AND findings ≥60
 *   4. synthesis-cadence: findings ≥100 AND ≥8 dispatches since last synthesis
 *      AND findings grew ≥30 since last synthesis
 *
 * Architecture mirrors selection-guards / question-caps: pure functions here,
 * side effects (store writes, span logging) in conductor.ts.
 *
 * Three enforcement layers, each gated by env var to allow staged rollout:
 *   - evaluateMandates (always on, read-only)
 *   - buildMandateQuestion (SEA_MANDATE_AUTOCREATE=1)
 *   - applyMandateHardBlock (SEA_MANDATE_HARDBLOCK=1)
 */

export type MandateType = "first-principles" | "mechanism" | "synthesis";
export type MandateReason =
  | "fp-missing"
  | "mechanism-missing"
  | "synthesis-missing"
  | "synthesis-cadence";

export interface MandateResult {
  eligible: boolean;
  type: MandateType | null;
  reason: MandateReason | null;
  hasOpenOfType: boolean;
  explanation: string; // for logs
}

const REASONING_TYPES: ReadonlySet<QuestionType> = new Set([
  "first-principles",
  "design-space",
  "mechanism",
]);

/**
 * Evaluate all four mandate conditions against current store/history state.
 * First-eligible wins. Returns a null mandate when nothing is eligible.
 *
 * Priority order when multiple conditions trigger: synthesis-missing >
 * synthesis-cadence > fp-missing > mechanism-missing. Synthesis comes first
 * because synthesis reduces open-question count, which unblocks other work.
 */
export function evaluateMandates(
  findings: Finding[],
  questions: Question[],
  priorMetrics: ConductorMetric[],
  iteration: number
): MandateResult {
  const verified = findings.filter((f) => f.status === "verified").length;
  const totalFindings = findings.length;

  const dispatchedTypes = new Map<QuestionType, number>();
  const reasoningAnswered = priorMetrics.filter(
    (m) =>
      m.questionType &&
      REASONING_TYPES.has(m.questionType) &&
      m.expertStatus === "answered"
  ).length;
  for (const m of priorMetrics) {
    if (!m.questionType) continue;
    dispatchedTypes.set(m.questionType, (dispatchedTypes.get(m.questionType) ?? 0) + 1);
  }
  const fpEver = (dispatchedTypes.get("first-principles") ?? 0) > 0;
  const mechanismEver = (dispatchedTypes.get("mechanism") ?? 0) > 0;
  const synthesisEver = (dispatchedTypes.get("synthesis") ?? 0) > 0;

  // Synthesis cadence: dispatches since last synthesis + store growth since then
  const synthIndexFromEnd = [...priorMetrics].reverse().findIndex(
    (m) => m.questionType === "synthesis"
  );
  const synthIdx =
    synthIndexFromEnd === -1 ? -1 : priorMetrics.length - 1 - synthIndexFromEnd;
  const dispatchesSinceSynthesis =
    synthIdx === -1 ? priorMetrics.length : priorMetrics.length - 1 - synthIdx;
  const findingsGrowthSinceSynthesis =
    synthIdx === -1
      ? totalFindings
      : totalFindings - findingsCountAtDispatch(priorMetrics, synthIdx);

  // --- Condition evaluation (priority order) ---

  // 1. synthesis-missing (0 synthesis ever AND findings ≥60)
  if (!synthesisEver && totalFindings >= 60) {
    return mkResult("synthesis", "synthesis-missing", questions,
      `0 synthesis ever + ${totalFindings} findings ≥60`);
  }

  // 2. synthesis-cadence
  if (
    synthesisEver &&
    totalFindings >= 100 &&
    dispatchesSinceSynthesis >= 8 &&
    findingsGrowthSinceSynthesis >= 30
  ) {
    return mkResult("synthesis", "synthesis-cadence", questions,
      `store ${totalFindings} ≥100 + ${dispatchesSinceSynthesis} dispatches since last synthesis + growth ${findingsGrowthSinceSynthesis} ≥30`);
  }

  // 3. fp-missing (iter ≥5 AND 0 FP ever AND verified ≥5)
  if (iteration >= 5 && !fpEver && verified >= 5) {
    return mkResult("first-principles", "fp-missing", questions,
      `iter ${iteration} ≥5 + 0 FP ever + ${verified} verified ≥5`);
  }

  // 4. mechanism-missing (iter ≥6 AND 0 mechanism ever AND ≥3 reasoning-type answers)
  if (iteration >= 6 && !mechanismEver && reasoningAnswered >= 3) {
    return mkResult("mechanism", "mechanism-missing", questions,
      `iter ${iteration} ≥6 + 0 mechanism ever + ${reasoningAnswered} reasoning-type answers ≥3`);
  }

  return {
    eligible: false,
    type: null,
    reason: null,
    hasOpenOfType: false,
    explanation: "no mandate conditions met",
  };
}

function mkResult(
  type: MandateType,
  reason: MandateReason,
  questions: Question[],
  explanation: string
): MandateResult {
  const hasOpenOfType = questions.some(
    (q) => q.status === "open" && q.questionType === type
  );
  return { eligible: true, type, reason, hasOpenOfType, explanation };
}

/**
 * Reconstruct total finding count at the moment a past dispatch was recorded.
 * Approximate: uses cumulative findingsPersisted (or findingsAdded as fallback).
 */
function findingsCountAtDispatch(metrics: ConductorMetric[], idx: number): number {
  let total = 0;
  for (let i = 0; i <= idx; i++) {
    total += metrics[i].findingsPersisted ?? metrics[i].findingsAdded ?? 0;
  }
  return total;
}

// ── Auto-create ───────────────────────────────────────────────────────────

/**
 * Generate a template question for a mandate. Template-driven (no LLM) so
 * this is deterministic and cheap to test. The LLM-driven variant can be
 * swapped in later if template quality proves insufficient.
 *
 * Returns null when the mandate type has no reasonable template (should
 * never happen for the three mandate types we enforce).
 */
export function buildMandateQuestion(
  mandate: MandateResult,
  findings: Finding[],
  existingQuestions: Question[],
  iteration: number
): Question | null {
  if (!mandate.eligible || !mandate.type) return null;

  const topDomains = pickTopDomains(findings, 3);
  const domainTag = topDomains[0] ?? "general";
  const nextId = computeNextQuestionId(existingQuestions);

  const { question, context, priority } = templateFor(mandate, topDomains, findings);

  return {
    id: nextId,
    question,
    priority,
    context,
    domain: domainTag,
    iteration,
    status: "open",
    questionType: mandate.type,
    resolvedAt: null,
    resolvedBy: null,
    notes: `auto-created by mandate ${mandate.reason} at iter ${iteration}`,
  };
}

function templateFor(
  mandate: MandateResult,
  topDomains: string[],
  findings: Finding[]
): { question: string; context: string; priority: "high" | "medium" | "low" } {
  const verifiedCount = findings.filter((f) => f.status === "verified").length;
  const sourceCount = findings.filter(
    (f) => f.status === "provisional" && f.tag?.startsWith("SOURCE")
  ).length;
  const domainsText = topDomains.length > 0 ? topDomains.join(", ") : "the store";

  switch (mandate.reason) {
    case "fp-missing":
      return {
        question: `From the ${verifiedCount} verified (and ${sourceCount} SOURCE-tagged) findings in ${domainsText}, derive the governing first principles / axioms that constrain the solution space. What conclusions follow deductively that cannot be found by search?`,
        context: `Auto-created: FP mandate (iter ≥5, 0 FP ever, ${verifiedCount} verified ≥5). Focus on deduction from existing findings, not new landscape work.`,
        priority: "high",
      };
    case "mechanism-missing":
      return {
        question: `Explain the causal mechanism(s) linking the resolved reasoning-type findings in ${domainsText}. What "how/why" chain connects the verified claims? Cite finding IDs.`,
        context: `Auto-created: mechanism mandate (iter ≥6, 0 mechanism ever, ≥3 reasoning-type answers).`,
        priority: "high",
      };
    case "synthesis-missing":
      return {
        question: `Synthesise the ${findings.length} findings into a structured comparison across ${domainsText}. Build a matrix of entities × dimensions with finding-ID backed cells. Surface the load-bearing tensions and gaps.`,
        context: `Auto-created: synthesis mandate (0 synthesis ever, ${findings.length} findings ≥60). Must net-reduce open question count.`,
        priority: "high",
      };
    case "synthesis-cadence":
      return {
        question: `Consolidate recent growth in ${domainsText}. Summarise the net new claims since the last synthesis, reconcile contradictions, and drop what's superseded. Target: close ≥1 open question.`,
        context: `Auto-created: synthesis-cadence mandate (store ≥100, ≥8 dispatches since last synthesis, grew ≥30 since). Scope to recent findings.`,
        priority: "high",
      };
    default:
      return {
        question: `Follow up on the current knowledge store with a ${mandate.type} investigation.`,
        context: `Auto-created: ${mandate.reason}`,
        priority: "medium",
      };
  }
}

function pickTopDomains(findings: Finding[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const f of findings) {
    if (!f.domain) continue;
    counts.set(f.domain, (counts.get(f.domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([d]) => d);
}

function computeNextQuestionId(existing: Question[]): string {
  // Match the project's existing ID scheme by inspecting the first ID's prefix.
  // Default to "Q" if no questions exist yet (shouldn't happen at mandate time
  // but handle defensively).
  const sample = existing[0]?.id ?? "Q000";
  const prefixMatch = sample.match(/^([A-Za-z]+)(\d+)/);
  const prefix = prefixMatch?.[1] ?? "Q";
  let maxNum = 0;
  for (const q of existing) {
    const m = q.id.match(new RegExp(`^${prefix}(\\d+)`));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const nextNum = maxNum + 1;
  const pad = sample.length - prefix.length;
  return `${prefix}${String(nextNum).padStart(pad, "0")}`;
}

// ── Hard-block ────────────────────────────────────────────────────────────

export interface MandateIntervention {
  reason: "hard-block-override";
  mandateType: MandateType;
  mandateReason: MandateReason;
  originalQuestionId: string;
  originalType: QuestionType;
  correctedQuestionId: string;
  correctedType: QuestionType;
  explanation: string;
}

/**
 * If the mandate is eligible, open questions of the mandated type exist, and
 * the selector picked a different type — swap the selection to a mandated-type
 * question. Respects same-type-cap (won't force a 3rd-consecutive dispatch of
 * the mandated type).
 *
 * Returns null if no intervention is needed.
 */
export function applyMandateHardBlock(
  mandate: MandateResult,
  selection: QuestionSelection,
  questions: Question[],
  recentTypes: QuestionType[],
  maxConsecutiveSameType = 2
): MandateIntervention | null {
  if (!mandate.eligible || !mandate.type) return null;
  if (!mandate.hasOpenOfType) return null;
  if (selection.questionType === mandate.type) return null;

  // Same-type-cap defense: if recent N dispatches were all the mandated
  // type, don't force a (N+1)th consecutive.
  const wouldExceed =
    recentTypes.length >= maxConsecutiveSameType &&
    recentTypes
      .slice(0, maxConsecutiveSameType)
      .every((t) => t === mandate.type);
  if (wouldExceed) return null;

  const candidate = questions.find(
    (q) => q.status === "open" && q.questionType === mandate.type
  );
  if (!candidate) return null;

  return {
    reason: "hard-block-override",
    mandateType: mandate.type,
    mandateReason: mandate.reason ?? "fp-missing",
    originalQuestionId: selection.questionId,
    originalType: selection.questionType,
    correctedQuestionId: candidate.id,
    correctedType: mandate.type,
    explanation: `Mandate ${mandate.reason} requires ${mandate.type}; selector picked ${selection.questionType}. Swapping to ${candidate.id}.`,
  };
}

// ── Env-flag helpers ──────────────────────────────────────────────────────

export function mandateAutocreateEnabled(): boolean {
  return process.env.SEA_MANDATE_AUTOCREATE === "1";
}

export function mandateHardBlockEnabled(): boolean {
  return process.env.SEA_MANDATE_HARDBLOCK === "1";
}
