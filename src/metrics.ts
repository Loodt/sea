import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { Score, Span } from "./types.js";

/**
 * Updated overall score weights (v002 conductor added processCompliance).
 */
function computeOverall(scores: {
  accuracy?: number;
  coverage?: number;
  coherence?: number;
  insightQuality?: number;
  processCompliance?: number;
}): number {
  const a = scores.accuracy ?? 0;
  const cov = scores.coverage ?? 0;
  const coh = scores.coherence ?? 0;
  const iq = scores.insightQuality ?? 0;
  const pc = scores.processCompliance ?? 0;
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
  personaVersion: number
): Score | null {
  if (!text) return null;

  // Strategy 1: JSON code block (relaxed — allows multiline and nested)
  const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    const parsed = tryParseScoreJson(jsonBlockMatch[1].trim());
    if (parsed) return buildScore(parsed, iteration, personaVersion);
  }

  // Strategy 2: Inline JSON with score fields (no code block)
  const inlineMatch = text.match(/\{[^{}]*"accuracy"\s*:\s*\d[\s\S]*?\}/);
  if (inlineMatch) {
    const parsed = tryParseScoreJson(inlineMatch[0]);
    if (parsed) return buildScore(parsed, iteration, personaVersion);
  }

  // Strategy 3: Field extraction from text patterns
  const fields = extractScoreFields(text);
  if (fields) return buildScore(fields, iteration, personaVersion);

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
  personaVersion: number
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
    overall: raw.overall ?? computeOverall(raw),
  };
}

/**
 * Try to parse scores from a reflection file on disk.
 * Fallback when stdout parsing fails.
 */
export async function parseScoresFromFile(
  filePath: string,
  iteration: number,
  personaVersion: number
): Promise<Score | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return parseScoresFromText(content, iteration, personaVersion);
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

  try {
    const existing = await readFile(filePath, "utf-8");
    // Deduplication: skip if this iteration already has a score
    const lines = existing.trim().split("\n").filter(Boolean);
    const alreadyLogged = lines.some((line) => {
      try {
        const entry = JSON.parse(line);
        return entry.iteration === score.iteration;
      } catch {
        return false;
      }
    });
    if (alreadyLogged) return;
    await writeFile(filePath, existing + JSON.stringify(score) + "\n", "utf-8");
  } catch {
    await writeFile(filePath, JSON.stringify(score) + "\n", "utf-8");
  }
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
  await appendFile(path.join(metricsDir, "spans.jsonl"), JSON.stringify(span) + "\n", "utf-8");
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
