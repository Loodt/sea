import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Score } from "./types.js";

/**
 * Parse scores from a reflection .md file.
 * Looks for a JSON block at the end with score fields.
 */
export function parseScoresFromReflection(
  reflection: string,
  iteration: number,
  personaVersion: number
): Score | null {
  // Look for JSON block with scores
  const jsonMatch = reflection.match(
    /```json\s*\n\s*\{[^}]*"accuracy"\s*:\s*[\d.]+[^}]*\}\s*\n\s*```/
  );

  if (!jsonMatch) return null;

  try {
    const raw = jsonMatch[0].replace(/```json\s*\n?/, "").replace(/\n?\s*```/, "");
    const parsed = JSON.parse(raw);

    return {
      iteration,
      timestamp: new Date().toISOString(),
      personaVersion,
      accuracy: parsed.accuracy ?? 0,
      coverage: parsed.coverage ?? 0,
      coherence: parsed.coherence ?? 0,
      insightQuality: parsed.insightQuality ?? 0,
      overall: parsed.overall ?? computeOverall(parsed),
    };
  } catch {
    return null;
  }
}

function computeOverall(scores: Partial<Score>): number {
  const a = scores.accuracy ?? 0;
  const cov = scores.coverage ?? 0;
  const coh = scores.coherence ?? 0;
  const iq = scores.insightQuality ?? 0;
  return a * 0.3 + cov * 0.25 + coh * 0.2 + iq * 0.25;
}

/**
 * Append a score to the project's scores.jsonl file.
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
