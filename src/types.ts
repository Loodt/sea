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
  target: "persona.md" | "CLAUDE.md" | "pipeline.json";
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
export type QuestionStatus = "open" | "resolved" | "deferred";

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
    { id: "synthesize", type: "synthesize" },
    { id: "evaluate", type: "evaluate" },
    { id: "evolve", type: "evolve" },
    { id: "summarize", type: "summarize" },
  ],
};

// ── Loop Config ──

export interface LoopConfig {
  cooldownMs: number;
  maxIterations: number;
  metaEveryN: number;
  regressionThreshold: number;
  regressionWindow: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  cooldownMs: 30_000,
  maxIterations: Infinity,
  metaEveryN: 5,
  regressionThreshold: 0.15,
  regressionWindow: 3,
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
  research: 16_000,
  synthesize: 32_000,
  evaluate: 48_000,
  evolve: 40_000,
  summarize: 32_000,
  meta: 48_000,
};

// ── Conductor Layer ──

export type ConductorStepType =
  | "select-question"
  | "create-expert"
  | "integrate-handoff"
  | "conductor-meta";

export type ExpertStepType =
  | "expert-plan"
  | "expert-research"
  | "expert-synthesize"
  | "expert-converge";

export type AllStepType = StepType | ConductorStepType | ExpertStepType;

export interface ExpertHandoff {
  questionId: string;
  status: "answered" | "killed" | "narrowed" | "exhausted";
  findings: Finding[];
  questionUpdates: { id: string; status: QuestionStatus; resolvedBy?: string }[];
  newQuestions: Omit<Question, "id" | "iteration" | "resolvedAt" | "resolvedBy">[];
  summary: string;
  iterationsRun: number;
  convergenceAchieved: boolean;
}

export interface ExpertConfig {
  questionId: string;
  question: string;
  persona: string;
  relevantFindings: Finding[];
  convergenceCriteria: string;
  maxIterations: number;
  projectDir: string;
  expertDir: string;
}

export interface QuestionSelection {
  questionId: string;
  question: string;
  reasoning: string;
  relevantFindingIds: string[];
  suggestedExpertType: string;
  estimatedIterations: number;
}

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
  findingsAdded: number;
  questionsResolved: number;
  newQuestionsCreated: number;
  innerIterationsRun: number;
  timestamp: string;
}

/** Hard limits per conductor/expert step type — chars, not tokens. */
export const CONDUCTOR_CONTEXT_BUDGETS: Record<ConductorStepType | ExpertStepType, number> = {
  "select-question": 32_000,
  "create-expert": 48_000,
  "integrate-handoff": 32_000,
  "conductor-meta": 48_000,
  "expert-plan": 24_000,
  "expert-research": 16_000,
  "expert-synthesize": 32_000,
  "expert-converge": 16_000,
};

// ── Utilities ──

export function padVersion(n: number | undefined): string {
  if (n === undefined || n === null) return "v???";
  return `v${String(n).padStart(3, "0")}`;
}
