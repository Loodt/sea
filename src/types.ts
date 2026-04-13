// ── Provider Layer ──

export type Provider = "claude" | "codex";

/**
 * Auto-detect which LLM harness is running this process.
 * Checks environment variables set by each harness:
 * - Claude Code sets CLAUDECODE=1
 * - Codex sets CODEX_CLI=1
 * Falls back to SEA_PROVIDER env var, then "claude" default.
 *
 * This ensures subagents use the same provider as the parent harness
 * without requiring explicit --provider flags.
 */
export function detectProvider(): Provider {
  // Explicit env var takes priority
  if (process.env.SEA_PROVIDER && process.env.SEA_PROVIDER in PROVIDERS) {
    return process.env.SEA_PROVIDER as Provider;
  }
  // Auto-detect from harness environment
  if (process.env.CODEX_CLI === "1" || process.env.CODEX === "1") return "codex";
  if (process.env.CLAUDECODE === "1") return "claude";
  // Default
  return "claude";
}

export interface ProviderConfig {
  binary: string;
  baseArgs: string[];
  modelFlag: string;
  instructionFile: string; // Auto-discovered by the CLI: CLAUDE.md vs AGENTS.md
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  claude: {
    binary: "claude",
    baseArgs: ["-p", "--output-format", "text", "--dangerously-skip-permissions"],
    modelFlag: "--model",
    instructionFile: "CLAUDE.md",
  },
  codex: {
    binary: process.platform === "win32" ? "codex.cmd" : "codex",
    baseArgs: ["-a", "never", "--search", "exec", "-", "--color", "never"],
    modelFlag: "--model",
    instructionFile: "AGENTS.md",
  },
};

/** The preferred conductor filename for a given provider. */
export function conductorFile(provider?: Provider): string {
  return PROVIDERS[provider ?? "claude"].instructionFile;
}

/** All known conductor filenames, provider-preferred first. */
export function conductorFileCandidates(provider?: Provider): string[] {
  const preferred = conductorFile(provider);
  const all = Object.values(PROVIDERS).map((p) => p.instructionFile);
  return [preferred, ...all.filter((f) => f !== preferred)];
}

export interface ProjectState {
  name: string;
  iteration: number;
  status: "active" | "paused" | "completed";
  personaVersion: number;
  conductorVersionAtCreation: number;
  currentTask: string | null;
  createdAt: string;
  updatedAt: string;
  scores: number[];
}

export interface Score {
  iteration: number;
  timestamp: string;
  personaVersion: number;
  accuracy: number;
  coverage: number;
  coherence: number;
  insightQuality: number;
  processCompliance: number;
  overall: number;
}

export interface LineageEntry {
  iteration: number;
  timestamp: string;
  target: "persona.md" | "CLAUDE.md" | "AGENTS.md" | "pipeline.json";
  versionBefore: string;
  versionAfter: string;
  changeType: string;
  changeSummary: string;
  reasoning: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
}

// ── Knowledge Layer ──

export type EpistemicTag = "SOURCE" | "DERIVED" | "ESTIMATED" | "ASSUMED" | "UNKNOWN";
export type FindingStatus = "provisional" | "verified" | "refuted" | "superseded";
export type QuestionStatus = "open" | "resolved" | "deferred" | "empirical-gate";

export type EngineeringType =
  | "MEASUREMENT"
  | "STANDARD"
  | "DERIVED"
  | "DESIGN"
  | "ASSUMPTION"
  | "HYPOTHESIS";

export const ENGINEERING_TYPE_PRIORITY: Record<EngineeringType, number> = {
  MEASUREMENT: 1,
  STANDARD: 1,
  DERIVED: 2,
  DESIGN: 3,
  ASSUMPTION: 4,
  HYPOTHESIS: 5,
};

// QUESTION_TYPE_CONTEXT_FILTER removed — never imported or used anywhere in codebase.

export interface Finding {
  id: string;
  claim: string;
  tag: EpistemicTag;
  source: string | null;
  confidence: number;
  domain: string;
  iteration: number;
  status: FindingStatus;
  verifiedAt: number | null;
  supersededBy: string | null;

  // Engineering knowledge classification (optional, backward-compatible)
  engineeringType?: EngineeringType;
  // Structured derivation chain — required for DERIVED findings, optional otherwise
  derivationChain?: {
    premises: string[];      // Finding IDs or stated axioms
    method: string;          // "deduction" | "calculation" | "constraint-analysis" | "analogy"
    assumptions: string[];   // Explicitly stated assumptions
    uncertaintyNote?: string; // What could invalidate this
  };
  // Removed: quantitative (never populated across 9 projects)
  // Removed: linkedFindings (never populated; wiki relationships serve this function)
  // Removed: humanReviewRequired (never set or checked)
}

export interface Question {
  id: string;
  question: string;
  priority: "high" | "medium" | "low";
  context: string;
  domain: string;
  iteration: number;
  status: QuestionStatus;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

// ── Pipeline Layer ──

export type StepType =
  | "plan"
  | "research"
  | "synthesize"
  | "evaluate"
  | "evolve"
  | "summarize"
  | "meta";

export interface PipelineStep {
  id: string;
  type: StepType;
  enabled?: boolean;
}

export interface PipelineConfig {
  steps: PipelineStep[];
}

export const DEFAULT_PIPELINE: PipelineConfig = {
  steps: [
    { id: "plan", type: "plan" },
    { id: "research", type: "research" },
    { id: "summarize", type: "summarize" },
    { id: "synthesize", type: "synthesize" },
    { id: "evaluate", type: "evaluate" },
    { id: "evolve", type: "evolve" },
  ],
};

// ── Loop Config ──

export interface LoopConfig {
  cooldownMs: number;
  maxIterations: number;
  metaEveryN: number;
  regressionThreshold: number;
  regressionWindow: number;
  evaluateModel?: string; // Use a different model for evaluate step (Axiom 1 separation)
  provider?: Provider;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  cooldownMs: 30_000,
  maxIterations: Infinity,
  metaEveryN: 5,
  regressionThreshold: 0.15,
  regressionWindow: 3,
  evaluateModel: "sonnet", // Axiom 1: different model for evaluate step
};

// ── Context Monitoring ──

export interface PromptMetrics {
  step: StepType;
  iteration: number;
  charCount: number;
  estimatedTokens: number;
  timestamp: string;
}

/** Hard limits per step type — chars, not tokens (~4 chars/token). */
export const CONTEXT_BUDGETS: Record<StepType, number> = {
  plan: 40_000,
  research: 40_000,
  synthesize: 48_000,
  evaluate: 48_000,
  evolve: 40_000,
  summarize: 32_000,
  meta: 48_000,
};

// ── Conductor Layer ──

export type ConductorStepType =
  | "select-question"
  | "hybrid-research"
  | "conductor-meta"
  // Legacy (pre-v035 hybrid architecture)
  | "create-expert"
  | "integrate-handoff";

export type ExpertStepType =
  | "expert-plan"
  | "expert-research"
  | "expert-synthesize"
  | "expert-converge";

export type AllStepType = StepType | ConductorStepType | ExpertStepType;

export type ExhaustionReason = "data-gap" | "strategy-limit" | "infrastructure";

export interface ExpertHandoff {
  questionId: string;
  status: "answered" | "killed" | "narrowed" | "exhausted" | "crashed";
  findings: Finding[];
  questionUpdates: { id: string; status: QuestionStatus; resolvedBy?: string }[];
  newQuestions: Omit<Question, "id" | "iteration" | "resolvedAt" | "resolvedBy">[];
  summary: string;
  iterationsRun: number;
  convergenceAchieved: boolean;
  exhaustionReason?: ExhaustionReason;
}

/** Result from a single hybrid research call (v035+). Replaces ExpertHandoff for new pipeline. */
export interface HybridResult {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  status: ExpertHandoff["status"];
  findingsAddedByAgent: number;
  questionsResolvedByAgent: string[];
  newQuestionsCreatedByAgent: number;
  summary: string;
  exhaustionReason?: ExhaustionReason;
  measuredFindingsDelta: number;
  measuredQuestionsDelta: number;
}

/** @deprecated Use hybrid-agent.ts instead. Retained for backward compatibility. */
export interface ExpertConfig {
  questionId: string;
  question: string;
  persona: string;
  relevantFindings: Finding[];
  convergenceCriteria: string;
  maxIterations: number;
  projectDir: string;
  expertDir: string;
  questionType: QuestionType;
  adaptedFromHash?: string;
  provider?: Provider;
}

export type QuestionType = "landscape" | "kill-check" | "data-hunt" | "mechanism" | "synthesis" | "first-principles" | "design-space";

export interface QuestionSelection {
  questionId: string;
  question: string;
  reasoning: string;
  relevantFindingIds: string[];
  suggestedExpertType: string;
  estimatedIterations: number;
  questionType: QuestionType;
}

/** Max inner iterations per question type. */
export const QUESTION_TYPE_ITERATION_CAP: Record<QuestionType, number> = {
  landscape: 5,
  "kill-check": 5,
  "data-hunt": 5,
  mechanism: 5,
  synthesis: 5,
  "first-principles": 3,
  "design-space": 4,
};

/** Max web searches per inner iteration, by question type. */
export const QUESTION_TYPE_SEARCH_BUDGET: Record<QuestionType, number> = {
  landscape: 7,
  "data-hunt": 5,
  "kill-check": 5,
  mechanism: 6,
  synthesis: 3,
  "first-principles": 1,
  "design-space": 2,
};

export interface ConductorState extends ProjectState {
  mode: "conductor";
  conductorIteration: number;
  totalExpertDispatches: number;
  activeQuestionId: string | null;
  questionsExhausted: string[];
}

export interface ConductorConfig {
  cooldownMs: number;
  maxConductorIterations: number;
  maxExpertIterations: number;
  metaEveryN: number;
  evaluateModel?: string; // Use a different model for evaluate step (Axiom 1 separation)
  provider?: Provider;
}

export const DEFAULT_CONDUCTOR_CONFIG: ConductorConfig = {
  cooldownMs: 30_000,
  maxConductorIterations: Infinity,
  maxExpertIterations: 5,
  metaEveryN: 3,
};

export interface ConductorMetric {
  conductorIteration: number;
  questionId: string;
  expertStatus: ExpertHandoff["status"];
  findingsAdded: number;            // reported by expert handoff (what the agent produced)
  findingsPersisted?: number;       // actual store delta after integration (findingsAfter - findingsBefore)
  attritionRate?: number;           // (findingsAdded - findingsPersisted) / findingsAdded, [0,1]
  questionsResolved: number;
  newQuestionsCreated: number;
  innerIterationsRun: number;
  timestamp: string;
  exhaustionReason?: ExhaustionReason;
  questionType?: QuestionType;
}

/** Hard limits per conductor/expert step type — chars, not tokens. */
export const CONDUCTOR_CONTEXT_BUDGETS: Record<ConductorStepType | ExpertStepType, number> = {
  "select-question": 40_000,
  "hybrid-research": 64_000,
  "conductor-meta": 48_000,
  // Legacy (pre-v035)
  "create-expert": 64_000,
  "integrate-handoff": 40_000,
  "expert-plan": 40_000,
  "expert-research": 48_000,
  "expert-synthesize": 48_000,
  "expert-converge": 24_000,
};

// ── Observability ──

export interface Span {
  id: string;
  step: string;
  parentId?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  promptChars: number;
  outputChars: number;
  promptTokensEst: number;
  outputTokensEst: number;
  exitCode: number;
  findingsProduced: number;
  metadata?: Record<string, unknown>;
}

// ── Evolution ──

export interface EvolutionCandidate {
  id: number;
  changeType: "behavioral" | "strategic" | "no-change" | "exploratory";
  description: string;
  hypothesis: string;
  noveltyScore: number;
  performanceScore: number;
  compositeScore: number;
}

// ── Expert Library ──

export interface LibraryEntry {
  personaHash: string;
  questionType: QuestionType;
  domain: string;
  expertType: string;
  avgIG: number;
  dispatches: number;
  lastUsed: string;
  personaPath: string;
  score: number;
  status: "active" | "retired";
  adaptedFrom?: string;
}

// ── Global Expert Library ──

export const EXPERT_GLOBAL_PROMOTE_THRESHOLD = 2.0;
export const EXPERT_GLOBAL_MIN_DISPATCHES = 2;

export interface GlobalExpertEntry {
  globalPersonaId: string; // projectName--personaHash
  personaHash: string;
  projectName: string;
  questionType: QuestionType;
  domain: string;
  expertType: string;
  avgIG: number;
  dispatches: number;
  score: number;
  personaPath: string; // relative to project dir
  promotedAt: string;
  revokedAt: string | null;
}

// ── Utilities ──

export function padVersion(n: number | undefined): string {
  if (n === undefined || n === null) return "v???";
  return `v${String(n).padStart(3, "0")}`;
}
