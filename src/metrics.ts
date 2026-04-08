import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Score, Span, ConductorMetric, Finding, Question } from "./types.js";
import { atomicAppendJsonl } from "./file-lock.js";

/**
 * Updated overall score weights (v002 conductor added processCompliance).
 */
function computeOverall(scores: {
  accuracy?: number;
  coverage?: number;
  coherence?: number;
  insightQuality?: number;
  processCompliance?: number;
}, questionType?: string): number {
  const a = scores.accuracy ?? 0;
  const cov = scores.coverage ?? 0;
  const coh = scores.coherence ?? 0;
  const iq = scores.insightQuality ?? 0;
  const pc = scores.processCompliance ?? 0;
  // Reasoning types: boost insight quality, reduce coverage weight
  if (questionType === "first-principles" || questionType === "design-space") {
    return a * 0.25 + cov * 0.10 + coh * 0.15 + iq * 0.30 + pc * 0.20;
  }
  return a * 0.25 + cov * 0.20 + coh * 0.15 + iq * 0.20 + pc * 0.20;
}

/**
 * Parse scores from text. Tries multiple strategies:
 * 1. JSON code block with score fields
 * 2. Inline JSON object with score fields
 * 3. Field extraction from markdown (e.g., "Accuracy: 8/10" or "accuracy.*?(\d+)")
 */
export function parseScoresFromText(
  text: string,
  iteration: number,
  personaVersion: number,
  questionType?: string
): Score | null {
  if (!text) return null;

  // Strategy 1: JSON code block (relaxed — allows multiline and nested)
  const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    const parsed = tryParseScoreJson(jsonBlockMatch[1].trim());
    if (parsed) return buildScore(parsed, iteration, personaVersion, questionType);
  }

  // Strategy 2: Inline JSON with score fields (no code block)
  const inlineMatch = text.match(/\{[^{}]*"accuracy"\s*:\s*\d[\s\S]*?\}/);
  if (inlineMatch) {
    const parsed = tryParseScoreJson(inlineMatch[0]);
    if (parsed) return buildScore(parsed, iteration, personaVersion, questionType);
  }

  // Strategy 3: Field extraction from text patterns
  const fields = extractScoreFields(text);
  if (fields) return buildScore(fields, iteration, personaVersion, questionType);

  return null;
}

/** Backward-compat alias */
export const parseScoresFromReflection = parseScoresFromText;

function tryParseScoreJson(raw: string): Record<string, number> | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.accuracy === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

function extractScoreFields(text: string): Record<string, number> | null {
  const patterns: [string, RegExp][] = [
    ["accuracy", /accuracy[:\s]*(\d+(?:\.\d+)?)/i],
    ["coverage", /coverage[:\s]*(\d+(?:\.\d+)?)/i],
    ["coherence", /coherence[:\s]*(\d+(?:\.\d+)?)/i],
    ["insightQuality", /insight\s*quality[:\s]*(\d+(?:\.\d+)?)/i],
    ["processCompliance", /process\s*compliance[:\s]*(\d+(?:\.\d+)?)/i],
  ];

  const result: Record<string, number> = {};
  let found = 0;

  for (const [key, re] of patterns) {
    const match = text.match(re);
    if (match) {
      result[key] = parseFloat(match[1]);
      found++;
    }
  }

  // Need at least accuracy + one other field
  return found >= 2 ? result : null;
}

function buildScore(
  raw: Record<string, number>,
  iteration: number,
  personaVersion: number,
  questionType?: string
): Score {
  return {
    iteration,
    timestamp: new Date().toISOString(),
    personaVersion,
    accuracy: raw.accuracy ?? 0,
    coverage: raw.coverage ?? 0,
    coherence: raw.coherence ?? 0,
    insightQuality: raw.insightQuality ?? 0,
    processCompliance: raw.processCompliance ?? 0,
    overall: raw.overall ?? computeOverall(raw, questionType),
  };
}

/**
 * Try to parse scores from a reflection file on disk.
 * Fallback when stdout parsing fails.
 */
export async function parseScoresFromFile(
  filePath: string,
  iteration: number,
  personaVersion: number,
  questionType?: string
): Promise<Score | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseScoresFromText(content, iteration, personaVersion, questionType);
  } catch {
    return null;
  }
}

/**
 * Append a score to the project's scores.jsonl file.
 * Deduplicates by iteration number — skips if already present.
 */
export async function appendScore(
  projectDir: string,
  score: Score
): Promise<void> {
  const metricsDir = path.join(projectDir, "metrics");
  await mkdir(metricsDir, { recursive: true });
  const filePath = path.join(metricsDir, "scores.jsonl");

  // Deduplication: read existing scores, skip if iteration already logged
  try {
    const existing = await readFile(filePath, "utf-8");
    const alreadyLogged = existing.trim().split("\n").filter(Boolean).some((line) => {
      try { return JSON.parse(line).iteration === score.iteration; } catch { return false; }
    });
    if (alreadyLogged) return;
  } catch {
    // File doesn't exist yet — proceed to append
  }
  await atomicAppendJsonl(filePath, score);
}

/**
 * Read all scores for a project.
 */
export async function readScores(projectDir: string): Promise<Score[]> {
  const filePath = path.join(projectDir, "metrics", "scores.jsonl");
  try {
    const content = await readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Score);
  } catch {
    return [];
  }
}

/**
 * Check if scores are regressing.
 * Returns true if the last `window` scores average is >threshold% below the rolling average.
 */
export function isRegressing(
  scores: Score[],
  window: number = 3,
  threshold: number = 0.15
): boolean {
  if (scores.length < window + 1) return false;

  const recent = scores.slice(-window).map((s) => s.overall);
  const prior = scores.slice(0, -window).map((s) => s.overall);

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;

  if (priorAvg === 0) return false;
  return (priorAvg - recentAvg) / priorAvg > threshold;
}

// ── Spans ──

/**
 * Append a structured span to metrics/spans.jsonl.
 */
export async function appendSpan(projectDir: string, span: Span): Promise<void> {
  const metricsDir = path.join(projectDir, "metrics");
  await mkdir(metricsDir, { recursive: true });
  await atomicAppendJsonl(path.join(metricsDir, "spans.jsonl"), span);
}

/**
 * Read all spans for a project.
 */
export async function readSpans(projectDir: string): Promise<Span[]> {
  const filePath = path.join(projectDir, "metrics", "spans.jsonl");
  try {
    const content = await readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Span);
  } catch {
    return [];
  }
}

// ── Conductor Metrics ──

export async function readConductorMetrics(projectDir: string): Promise<ConductorMetric[]> {
  const filePath = path.join(projectDir, "metrics", "conductor-metrics.jsonl");
  try {
    const content = await readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ConductorMetric);
  } catch {
    return [];
  }
}

// ── Convergence Detection ──

export interface DispatchEfficiency {
  avgFindings: number;
  trend: "improving" | "stable" | "degrading";
  recentAvg: number;
  priorAvg: number;
}

/**
 * Compute dispatch efficiency from conductor metrics.
 * Compares the last `window` dispatches against the prior `window` to detect trend.
 */
export function computeDispatchEfficiency(
  metrics: ConductorMetric[],
  window: number = 5
): DispatchEfficiency {
  if (metrics.length === 0) {
    return { avgFindings: 0, trend: "stable", recentAvg: 0, priorAvg: 0 };
  }

  const totalFindings = metrics.reduce((sum, m) => sum + m.findingsAdded, 0);
  const avgFindings = totalFindings / metrics.length;

  if (metrics.length < window + 1) {
    return { avgFindings, trend: "stable", recentAvg: avgFindings, priorAvg: avgFindings };
  }

  const recent = metrics.slice(-window);
  const prior = metrics.slice(0, -window);

  const recentAvg = recent.reduce((s, m) => s + m.findingsAdded, 0) / recent.length;
  const priorAvg = prior.reduce((s, m) => s + m.findingsAdded, 0) / prior.length;

  // >30% improvement or degradation counts as a trend change
  const ratio = priorAvg > 0 ? (recentAvg - priorAvg) / priorAvg : 0;
  const trend = ratio > 0.3 ? "improving" : ratio < -0.3 ? "degrading" : "stable";

  return { avgFindings, trend, recentAvg, priorAvg };
}

export interface ConvergenceAssessment {
  isConverging: boolean;
  signals: string[];
  recommendation: "continue" | "review" | "stop";
}

/**
 * Detect convergence signals from findings, questions, and conductor metrics.
 * Returns advisory assessment — never auto-stops the conductor.
 *
 * Signals (need 3+ for convergence):
 * 1. Knowledge saturation: last 3 dispatches averaged < 1 new finding
 * 2. Question frontier closed: no open questions remaining
 * 3. Diminishing returns: dispatch efficiency trend is "degrading"
 * 4. Domain saturation: last 5 findings all in already-covered domains
 * 5. High exhaustion rate: >50% of last 5 dispatches ended in exhaustion
 */
export function detectConvergenceSignals(
  findings: Finding[],
  questions: Question[],
  metrics: ConductorMetric[]
): ConvergenceAssessment {
  const signals: string[] = [];

  // Need at least 3 dispatches to assess anything
  if (metrics.length < 3) {
    return { isConverging: false, signals: [], recommendation: "continue" };
  }

  // Signal 1: Knowledge saturation — last 3 dispatches averaged < 1 finding
  const last3 = metrics.slice(-3);
  const avgLast3 = last3.reduce((s, m) => s + m.findingsAdded, 0) / last3.length;
  if (avgLast3 < 1) {
    signals.push(`Knowledge saturation: last 3 dispatches averaged ${avgLast3.toFixed(1)} findings`);
  }

  // Signal 2: Question frontier closed — no open questions
  const openQuestions = questions.filter((q) => q.status === "open");
  if (openQuestions.length === 0) {
    signals.push("Question frontier closed: no open questions remaining");
  }

  // Signal 3: Diminishing returns — dispatch efficiency degrading
  const efficiency = computeDispatchEfficiency(metrics);
  if (efficiency.trend === "degrading") {
    signals.push(
      `Diminishing returns: recent avg ${efficiency.recentAvg.toFixed(1)} findings/dispatch vs prior ${efficiency.priorAvg.toFixed(1)}`
    );
  }

  // Signal 4: Domain saturation — last 5 findings all in previously-covered domains
  if (findings.length >= 10) {
    const last5Findings = findings.slice(-5);
    const olderDomains = new Set(findings.slice(0, -5).map((f) => f.domain));
    const allInOldDomains = last5Findings.every((f) => olderDomains.has(f.domain));
    if (allInOldDomains) {
      signals.push("Domain saturation: last 5 findings all in previously-covered domains");
    }
  }

  // Signal 5: High exhaustion rate — >50% of last 5 dispatches exhausted or crashed
  if (metrics.length >= 5) {
    const last5 = metrics.slice(-5);
    const exhaustedOrCrashed = last5.filter(
      (m) => m.expertStatus === "exhausted" || m.expertStatus === "crashed"
    ).length;
    if (exhaustedOrCrashed > last5.length / 2) {
      signals.push(
        `High exhaustion rate: ${exhaustedOrCrashed}/${last5.length} recent dispatches exhausted/crashed`
      );
    }
  }

  const signalCount = signals.length;
  const recommendation =
    signalCount >= 3 ? "stop" : signalCount >= 2 ? "review" : "continue";

  return {
    isConverging: signalCount >= 2,
    signals,
    recommendation,
  };
}
