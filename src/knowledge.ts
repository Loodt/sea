import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Finding, Question } from "./types.js";

// ── Paths ──

function knowledgeDir(projectDir: string): string {
  return path.join(projectDir, "knowledge");
}
function findingsPath(projectDir: string): string {
  return path.join(knowledgeDir(projectDir), "findings.jsonl");
}
function questionsPath(projectDir: string): string {
  return path.join(knowledgeDir(projectDir), "questions.jsonl");
}
function summaryPath(projectDir: string): string {
  return path.join(knowledgeDir(projectDir), "summary.md");
}

// ── Generic JSONL helpers ──

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (!content.trim()) return [];
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

async function appendJsonl<T>(filePath: string, entry: T): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  try {
    const existing = await readFile(filePath, "utf-8");
    await writeFile(filePath, existing + JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    await writeFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }
}

async function writeJsonl<T>(filePath: string, entries: T[]): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  await writeFile(filePath, content, "utf-8");
}

// ── Findings ──

export async function readFindings(projectDir: string): Promise<Finding[]> {
  return readJsonl<Finding>(findingsPath(projectDir));
}

export async function appendFinding(projectDir: string, finding: Finding): Promise<void> {
  await appendJsonl(findingsPath(projectDir), finding);
}

export async function updateFinding(
  projectDir: string,
  id: string,
  update: Partial<Finding>
): Promise<void> {
  const findings = await readFindings(projectDir);
  const idx = findings.findIndex((f) => f.id === id);
  if (idx === -1) return;
  findings[idx] = { ...findings[idx], ...update };
  await writeJsonl(findingsPath(projectDir), findings);
}

export function queryFindings(
  findings: Finding[],
  opts: {
    domain?: string;
    status?: Finding["status"];
    tag?: Finding["tag"];
    minConfidence?: number;
  }
): Finding[] {
  return findings.filter((f) => {
    if (opts.domain && f.domain !== opts.domain) return false;
    if (opts.status && f.status !== opts.status) return false;
    if (opts.tag && f.tag !== opts.tag) return false;
    if (opts.minConfidence !== undefined && f.confidence < opts.minConfidence) return false;
    return true;
  });
}

// ── Questions ──

export async function readQuestions(projectDir: string): Promise<Question[]> {
  return readJsonl<Question>(questionsPath(projectDir));
}

export async function appendQuestion(projectDir: string, question: Question): Promise<void> {
  await appendJsonl(questionsPath(projectDir), question);
}

export async function updateQuestion(
  projectDir: string,
  id: string,
  update: Partial<Question>
): Promise<void> {
  const questions = await readQuestions(projectDir);
  const idx = questions.findIndex((q) => q.id === id);
  if (idx === -1) return;
  questions[idx] = { ...questions[idx], ...update };
  await writeJsonl(questionsPath(projectDir), questions);
}

// ── Summary ──

export async function readSummary(projectDir: string): Promise<string> {
  try {
    return await readFile(summaryPath(projectDir), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Generate a compressed summary from findings + questions for agent context.
 * Target: <2KB. Called by the summarize agent, but also available as a fallback.
 */
export function generateFallbackSummary(
  findings: Finding[],
  questions: Question[]
): string {
  const verified = findings.filter((f) => f.status === "verified");
  const provisional = findings.filter((f) => f.status === "provisional");
  const refuted = findings.filter((f) => f.status === "refuted");
  const openQs = questions.filter((q) => q.status === "open");

  const lines: string[] = ["# Knowledge Summary\n"];

  if (verified.length > 0) {
    lines.push("## Verified Findings");
    for (const f of verified.slice(0, 20)) {
      lines.push(`- [${f.tag}] ${f.claim} (confidence: ${f.confidence})`);
    }
    if (verified.length > 20) lines.push(`- ... and ${verified.length - 20} more`);
    lines.push("");
  }

  if (provisional.length > 0) {
    lines.push("## Provisional (unverified)");
    for (const f of provisional.slice(0, 10)) {
      lines.push(`- [${f.tag}] ${f.claim}`);
    }
    if (provisional.length > 10) lines.push(`- ... and ${provisional.length - 10} more`);
    lines.push("");
  }

  if (refuted.length > 0) {
    lines.push("## Refuted");
    for (const f of refuted.slice(0, 5)) {
      lines.push(`- ~~${f.claim}~~`);
    }
    lines.push("");
  }

  if (openQs.length > 0) {
    lines.push("## Open Questions");
    const high = openQs.filter((q) => q.priority === "high");
    const medium = openQs.filter((q) => q.priority === "medium");
    for (const q of high) {
      lines.push(`- **[HIGH]** ${q.question}`);
    }
    for (const q of medium.slice(0, 5)) {
      lines.push(`- [medium] ${q.question}`);
    }
    lines.push("");
  }

  lines.push(`\n_${findings.length} findings, ${openQs.length} open questions_`);

  return lines.join("\n");
}

// ── Initialization ──

export async function initKnowledge(projectDir: string): Promise<void> {
  const dir = knowledgeDir(projectDir);
  await mkdir(dir, { recursive: true });

  const summary = summaryPath(projectDir);
  try {
    await readFile(summary, "utf-8");
  } catch {
    await writeFile(
      summary,
      "# Knowledge Summary\n\n(No findings yet — updated after each iteration)\n",
      "utf-8"
    );
  }
}

// ── Metrics derived from knowledge ──

export function informationGain(
  findings: Finding[],
  questions: Question[],
  iteration: number
): { newFindings: number; resolvedQuestions: number; contradictions: number } {
  const newFindings = findings.filter((f) => f.iteration === iteration).length;
  const resolvedQuestions = questions.filter(
    (q) => q.status === "resolved" && q.resolvedAt === iteration
  ).length;
  const contradictions = findings.filter(
    (f) => f.status === "refuted" && f.verifiedAt === iteration
  ).length;
  return { newFindings, resolvedQuestions, contradictions };
}
