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
  overall: number;
}

export interface LineageEntry {
  iteration: number;
  timestamp: string;
  target: "persona.md" | "CLAUDE.md";
  versionBefore: string;
  versionAfter: string;
  changeType: string;
  changeSummary: string;
  reasoning: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
}

export type StepType = "execute" | "reflect" | "evolve" | "meta";

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

export function padVersion(n: number): string {
  return `v${String(n).padStart(3, "0")}`;
}
