import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Finding, Question } from "./types.js";
import { atomicAppendJsonl, atomicUpdateJsonl } from "./file-lock.js";

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
  await atomicAppendJsonl(filePath, entry);
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
  await atomicUpdateJsonl<Finding>(findingsPath(projectDir), (findings) => {
    const idx = findings.findIndex((f) => f.id === id);
    if (idx === -1) return findings;
    findings[idx] = { ...findings[idx], ...update };
    return findings;
  });
}

export async function batchUpdateFindings(
  projectDir: string,
  updateFn: (findings: Finding[]) => Finding[]
): Promise<void> {
  await atomicUpdateJsonl<Finding>(findingsPath(projectDir), updateFn);
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
  await atomicUpdateJsonl<Question>(questionsPath(projectDir), (questions) => {
    const idx = questions.findIndex((q) => q.id === id);
    if (idx === -1) return questions;
    questions[idx] = { ...questions[idx], ...update };
    return questions;
  });
}

// ── Summary ──

export async function readSummary(projectDir: string): Promise<string> {
  try {
    return await readFile(summaryPath(projectDir), "utf-8");
  } catch {
    return "";
  }
}

const SUMMARY_MAX_BYTES = 2048;

/**
 * Enforce the 2KB summary.md size limit. If over, regenerate from findings/questions.
 */
export async function enforceSummarySize(projectDir: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(summaryPath(projectDir), "utf-8");
  } catch {
    return false; // no summary yet
  }

  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes <= SUMMARY_MAX_BYTES) return false;

  console.log(`   \u26a0 summary.md is ${(bytes / 1024).toFixed(1)}KB — regenerating (max 2KB)`);

  const findings = await readFindings(projectDir);
  const questions = await readQuestions(projectDir);
  const fallback = generateFallbackSummary(findings, questions);

  const fallbackBytes = Buffer.byteLength(fallback, "utf-8");
  const final = fallbackBytes <= SUMMARY_MAX_BYTES
    ? fallback
    : fallback.slice(0, SUMMARY_MAX_BYTES - 20) + "\n\n_(truncated)_";

  await writeFile(summaryPath(projectDir), final, "utf-8");
  return true;
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

// ── Provisional Finding Graduation ──

/**
 * Auto-graduate provisional findings that meet all criteria:
 * - confidence >= 0.85
 * - tag === "SOURCE" and source URL is non-null
 * - created >= staleAfter iterations ago
 * - not contradicted by any refuted finding
 * Returns count of graduated findings.
 */
export async function graduateFindings(
  projectDir: string,
  currentIteration: number,
  staleAfter: number = 3
): Promise<number> {
  let graduated = 0;

  await atomicUpdateJsonl<Finding>(findingsPath(projectDir), (findings) => {
    const refutedClaims = new Set(
      findings.filter((f) => f.status === "refuted").map((f) => f.supersededBy)
    );

    for (const f of findings) {
      // SOURCE graduation: confidence >= 0.85, has URL, aged, not refuted
      if (
        f.status === "provisional" &&
        f.confidence >= 0.85 &&
        f.tag === "SOURCE" &&
        f.source &&
        f.source !== "null" &&
        (currentIteration - f.iteration) >= staleAfter &&
        !refutedClaims.has(f.id)
      ) {
        f.status = "verified";
        f.verifiedAt = currentIteration;
        graduated++;
      }

      // DERIVED graduation (first-principles reasoning): stricter criteria.
      // Requires: confidence >= 0.90, derivationChain present with ≥2 premises,
      // all finding-ID premises must themselves be verified (trust cascade).
      if (
        f.status === "provisional" &&
        f.tag === "DERIVED" &&
        f.confidence >= 0.90 &&
        f.derivationChain &&
        Array.isArray(f.derivationChain.premises) &&
        f.derivationChain.premises.length >= 2 &&
        f.derivationChain.premises.every((premiseId) => {
          if (!premiseId.startsWith("F")) return true; // axiom string, not finding ID
          const premise = findings.find((p) => p.id === premiseId);
          return premise && premise.status === "verified";
        }) &&
        (currentIteration - f.iteration) >= staleAfter &&
        !refutedClaims.has(f.id)
      ) {
        f.status = "verified";
        f.verifiedAt = currentIteration;
        graduated++;
      }
    }

    return findings;
  });

  return graduated;
}

/**
 * Deduplicate findings.jsonl by claim text and fix duplicate IDs.
 * Keeps the first occurrence of each claim (case-insensitive, trimmed).
 * Reassigns IDs sequentially when duplicates are found to fix ID collisions.
 * Returns count of removed duplicates.
 */
export async function deduplicateFindings(projectDir: string): Promise<number> {
  let removed = 0;
  await atomicUpdateJsonl<Finding>(findingsPath(projectDir), (findings) => {
    // Step 1: Remove claim-text duplicates
    const seen = new Set<string>();
    const deduped: Finding[] = [];
    for (const f of findings) {
      const key = f.claim.trim().toLowerCase();
      if (seen.has(key)) {
        removed++;
        continue;
      }
      seen.add(key);
      deduped.push(f);
    }

    // Step 2: Fix duplicate IDs by reassigning sequentially
    const idCounts = new Map<string, number>();
    for (const f of deduped) {
      idCounts.set(f.id, (idCounts.get(f.id) ?? 0) + 1);
    }
    const hasDupeIds = [...idCounts.values()].some((c) => c > 1);
    if (hasDupeIds) {
      // Find the highest non-F9XX ID to continue from
      let maxNum = 0;
      for (const f of deduped) {
        const m = f.id.match(/^F(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n < 900 && n > maxNum) maxNum = n;
        }
      }
      // Reassign all IDs sequentially
      let nextId = maxNum + 1;
      for (const f of deduped) {
        f.id = `F${String(nextId).padStart(3, "0")}`;
        nextId++;
      }
    }

    return deduped;
  });
  return removed;
}

/**
 * Aggregate all source URLs from findings.jsonl into references/links.md.
 * Overwrites links.md with deduplicated, sorted URL list.
 * Returns count of unique URLs written.
 */
export async function aggregateReferences(projectDir: string): Promise<number> {
  const findings = await readFindings(projectDir);
  const urls = new Set<string>();
  for (const f of findings) {
    if (f.source && f.source !== "null" && f.source.startsWith("http")) {
      urls.add(f.source);
    }
  }

  const refsDir = path.join(projectDir, "references");
  await mkdir(refsDir, { recursive: true });
  const linksFile = path.join(refsDir, "links.md");
  const content = `# References\n\n${[...urls].sort().map((u) => `- ${u}`).join("\n")}\n`;
  await writeFile(linksFile, content, "utf-8");
  return urls.size;
}

/**
 * Compute accurate counts from findings.jsonl (not from summary.md).
 */
export function findingCounts(findings: Finding[]): {
  total: number;
  verified: number;
  provisional: number;
  refuted: number;
  superseded: number;
} {
  return {
    total: findings.length,
    verified: findings.filter((f) => f.status === "verified").length,
    provisional: findings.filter((f) => f.status === "provisional").length,
    refuted: findings.filter((f) => f.status === "refuted").length,
    superseded: findings.filter((f) => f.status === "superseded").length,
  };
}
