import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { readFindings, readQuestions } from "./knowledge.js";
import type { Finding, Question } from "./types.js";

/**
 * Pre-integration snapshot of the knowledge store.
 *
 * Guards against task-8 (integration) clobber: the LLM rewrites findings.jsonl
 * and questions.jsonl based on its handoff prompt. If it emits a destructive
 * output (empty file, over-aggressive dedup, malformed JSON truncation) the
 * prior store is lost. Iter-18 lost 224 findings this way.
 *
 * Contract: snapshot before integration, diff after, auto-restore if clobber.
 * Snapshots persist indefinitely (audit trail, fits never-delete principle).
 */

export interface StoreSnapshot {
  dir: string;
  iteration: number;
  timestamp: string;
  findingsCount: number;
  questionsCount: number;
  verifiedFindingIds: string[];
  nonOpenQuestionIds: string[];
}

export interface StoreDiff {
  findingsBefore: number;
  findingsAfter: number;
  findingsAdded: number;
  findingsRemoved: number;
  verifiedRemoved: string[];
  questionsBefore: number;
  questionsAfter: number;
  questionsAdded: number;
  questionsRemoved: number;
  nonOpenReopened: string[];
}

export interface ClobberThresholds {
  findingsRatioLoss: number;
  questionsRatioLoss: number;
  blockVerifiedRemoval: boolean;
  blockZeroOutWithPriorData: boolean;
  blockNonOpenReopened: boolean;
}

export const DEFAULT_CLOBBER_THRESHOLDS: ClobberThresholds = {
  findingsRatioLoss: 0.5,
  questionsRatioLoss: 0.5,
  blockVerifiedRemoval: true,
  blockZeroOutWithPriorData: true,
  blockNonOpenReopened: true,
};

export interface ClobberVerdict {
  isClobber: boolean;
  severity: "none" | "warning" | "critical";
  reasons: string[];
}

function snapshotRoot(projectDir: string): string {
  return path.join(projectDir, "knowledge-snapshots");
}

function snapshotPath(projectDir: string, iteration: number, tag: string): string {
  const iterStr = String(iteration).padStart(3, "0");
  return path.join(snapshotRoot(projectDir), `iter-${iterStr}-${tag}`);
}

function knowledgeFile(projectDir: string, name: "findings.jsonl" | "questions.jsonl"): string {
  return path.join(projectDir, "knowledge", name);
}

/**
 * Copy findings.jsonl and questions.jsonl to a versioned snapshot directory.
 * Tag distinguishes multiple snapshots in the same iteration (e.g. "pre-integration").
 * Returns the snapshot descriptor for later diff/restore.
 */
export async function snapshotStores(
  projectDir: string,
  iteration: number,
  tag: string = "pre-integration"
): Promise<StoreSnapshot> {
  const dir = snapshotPath(projectDir, iteration, tag);
  await mkdir(dir, { recursive: true });

  const [findings, questions] = await Promise.all([
    readFindings(projectDir),
    readQuestions(projectDir),
  ]);

  await Promise.all([
    copyFileIfExists(knowledgeFile(projectDir, "findings.jsonl"), path.join(dir, "findings.jsonl")),
    copyFileIfExists(knowledgeFile(projectDir, "questions.jsonl"), path.join(dir, "questions.jsonl")),
  ]);

  const snapshot: StoreSnapshot = {
    dir,
    iteration,
    timestamp: new Date().toISOString(),
    findingsCount: findings.length,
    questionsCount: questions.length,
    verifiedFindingIds: findings.filter((f) => f.status === "verified").map((f) => f.id),
    nonOpenQuestionIds: questions.filter((q) => q.status !== "open").map((q) => q.id),
  };

  await writeFile(path.join(dir, "meta.json"), JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}

async function copyFileIfExists(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) {
    // Empty store → write empty file so restore target exists
    await writeFile(dest, "", "utf-8");
    return;
  }
  await copyFile(src, dest);
}

/**
 * Compare current store state against a snapshot.
 * Removal detection uses finding/question IDs, not counts — catches
 * the case where integration added N and silently removed N others.
 */
export async function diffStores(
  projectDir: string,
  snapshot: StoreSnapshot
): Promise<StoreDiff> {
  const [currentFindings, currentQuestions] = await Promise.all([
    readFindings(projectDir),
    readQuestions(projectDir),
  ]);

  const snapFindings = await readSnapshotFindings(snapshot);
  const snapQuestions = await readSnapshotQuestions(snapshot);

  const currentFindingIds = new Set(currentFindings.map((f) => f.id));
  const currentQuestionIds = new Set(currentQuestions.map((q) => q.id));
  const snapFindingIds = new Set(snapFindings.map((f) => f.id));
  const snapQuestionIds = new Set(snapQuestions.map((q) => q.id));

  const findingsRemoved = [...snapFindingIds].filter((id) => !currentFindingIds.has(id));
  const findingsAdded = [...currentFindingIds].filter((id) => !snapFindingIds.has(id));
  const questionsRemoved = [...snapQuestionIds].filter((id) => !currentQuestionIds.has(id));
  const questionsAdded = [...currentQuestionIds].filter((id) => !snapQuestionIds.has(id));

  const verifiedRemoved = snapshot.verifiedFindingIds.filter((id) => !currentFindingIds.has(id));

  // Non-open questions (resolved/killed/exhausted) that reappear as open — structural corruption
  const currentQById = new Map(currentQuestions.map((q) => [q.id, q]));
  const nonOpenReopened: string[] = [];
  for (const id of snapshot.nonOpenQuestionIds) {
    const now = currentQById.get(id);
    if (now && now.status === "open") {
      nonOpenReopened.push(id);
    }
  }

  return {
    findingsBefore: snapshot.findingsCount,
    findingsAfter: currentFindings.length,
    findingsAdded: findingsAdded.length,
    findingsRemoved: findingsRemoved.length,
    verifiedRemoved,
    questionsBefore: snapshot.questionsCount,
    questionsAfter: currentQuestions.length,
    questionsAdded: questionsAdded.length,
    questionsRemoved: questionsRemoved.length,
    nonOpenReopened,
  };
}

async function readSnapshotFindings(snapshot: StoreSnapshot): Promise<Finding[]> {
  return readJsonlFile<Finding>(path.join(snapshot.dir, "findings.jsonl"));
}

async function readSnapshotQuestions(snapshot: StoreSnapshot): Promise<Question[]> {
  return readJsonlFile<Question>(path.join(snapshot.dir, "questions.jsonl"));
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.trim()) return [];
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

/**
 * Classify a diff as a clobber or not, with reasons.
 * Ordering reflects severity: whole-store wipe > verified loss > ratio loss > structural reopen.
 */
export function detectClobber(
  diff: StoreDiff,
  thresholds: ClobberThresholds = DEFAULT_CLOBBER_THRESHOLDS
): ClobberVerdict {
  const reasons: string[] = [];
  let severity: "none" | "warning" | "critical" = "none";

  if (thresholds.blockZeroOutWithPriorData) {
    if (diff.findingsBefore > 0 && diff.findingsAfter === 0) {
      reasons.push(`FINDINGS_STORE_WIPE: ${diff.findingsBefore} → 0`);
      severity = "critical";
    }
    if (diff.questionsBefore > 0 && diff.questionsAfter === 0) {
      reasons.push(`QUESTION_STORE_WIPE: ${diff.questionsBefore} → 0`);
      severity = "critical";
    }
  }

  if (thresholds.blockVerifiedRemoval && diff.verifiedRemoved.length > 0) {
    reasons.push(
      `VERIFIED_FINDING_REMOVED: ${diff.verifiedRemoved.length} verified finding(s) missing — ${diff.verifiedRemoved.slice(0, 5).join(", ")}${diff.verifiedRemoved.length > 5 ? "…" : ""}`
    );
    severity = "critical";
  }

  if (
    diff.findingsBefore > 0 &&
    diff.findingsAfter < diff.findingsBefore * thresholds.findingsRatioLoss
  ) {
    reasons.push(
      `FINDINGS_RATIO_LOSS: ${diff.findingsAfter}/${diff.findingsBefore} = ${((diff.findingsAfter / diff.findingsBefore) * 100).toFixed(1)}% (threshold ${thresholds.findingsRatioLoss * 100}%)`
    );
    if (severity === "none") severity = "critical";
  }

  if (
    diff.questionsBefore > 0 &&
    diff.questionsAfter < diff.questionsBefore * thresholds.questionsRatioLoss
  ) {
    reasons.push(
      `QUESTIONS_RATIO_LOSS: ${diff.questionsAfter}/${diff.questionsBefore} = ${((diff.questionsAfter / diff.questionsBefore) * 100).toFixed(1)}% (threshold ${thresholds.questionsRatioLoss * 100}%)`
    );
    if (severity === "none") severity = "critical";
  }

  if (thresholds.blockNonOpenReopened && diff.nonOpenReopened.length > 0) {
    reasons.push(
      `NON_OPEN_REOPENED: ${diff.nonOpenReopened.length} resolved/killed/exhausted question(s) reopened — ${diff.nonOpenReopened.slice(0, 5).join(", ")}${diff.nonOpenReopened.length > 5 ? "…" : ""}`
    );
    if (severity === "none") severity = "warning";
  }

  return {
    isClobber: severity === "critical",
    severity,
    reasons,
  };
}

/**
 * Overwrite the live knowledge store with the snapshot.
 * Used when detectClobber returns isClobber=true.
 *
 * Note: this is destructive of whatever integration produced. That's the point —
 * integration output was worse than the pre-integration state, so we roll back.
 */
export async function restoreStores(
  projectDir: string,
  snapshot: StoreSnapshot
): Promise<void> {
  await Promise.all([
    copyFile(
      path.join(snapshot.dir, "findings.jsonl"),
      knowledgeFile(projectDir, "findings.jsonl")
    ),
    copyFile(
      path.join(snapshot.dir, "questions.jsonl"),
      knowledgeFile(projectDir, "questions.jsonl")
    ),
  ]);
}
