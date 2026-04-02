import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { runAndTrace } from "./runner.js";
import { readSummary, readFindings, queryFindings } from "./knowledge.js";
import { readLibrary, findMatchingExperts, hashPersona } from "./expert-library.js";
import type { ExpertConfig, QuestionSelection, Finding, Provider } from "./types.js";

const SEA_ROOT = process.cwd();

/** Reuse threshold: minimum library score to attempt adaptation instead of fresh creation. */
const REUSE_THRESHOLD = 2.0;

/**
 * Create an expert persona for a specific question using the expert creation framework.
 * This is the "80% investment" — the quality of the persona determines the quality of the research.
 *
 * Checks the expert library first: if a high-scoring persona exists for the same
 * question type and a similar domain, it adapts that persona instead of creating from scratch.
 */
export async function createExpert(
  selection: QuestionSelection,
  projectDir: string,
  conductorIteration: number,
  maxExpertIterations: number,
  provider?: Provider
): Promise<ExpertConfig> {
  const iterStr = String(conductorIteration).padStart(3, "0");
  const expertDir = path.join(projectDir, "experts", `Q${selection.questionId}-iter-${iterStr}`);
  await mkdir(expertDir, { recursive: true });

  // Check expert library for reusable personas
  const library = await readLibrary(projectDir);
  const candidates = findMatchingExperts(library, selection.questionType, selection.question, 3);

  let persona: string | null = null;
  let adaptedFromHash: string | undefined;

  if (candidates.length > 0 && candidates[0].score > REUSE_THRESHOLD) {
    const top = candidates[0];
    const basePath = path.join(projectDir, top.personaPath);
    const basePersona = await safeRead(basePath);
    if (basePersona) {
      console.log(`   \u267b Adapting existing expert (${top.expertType}, score: ${top.score.toFixed(1)})`);
      persona = await adaptExistingPersona(basePersona, selection, projectDir, maxExpertIterations, iterStr, provider);
      adaptedFromHash = top.personaHash;
    }
  }

  if (!persona) {
    persona = await createFreshPersona(selection, projectDir, maxExpertIterations, iterStr, provider);
  }

  // Save persona for auditing
  await writeFile(path.join(expertDir, "persona.md"), persona, "utf-8");
  console.log(`   \u2713 Expert persona ready (${persona.split("\n").length} lines)`);

  // Select relevant findings for the expert's context
  const relevantFindings = await selectRelevantFindings(projectDir, selection, 10);

  // Build convergence criteria from the question
  const convergenceCriteria = [
    `Answer question ${selection.questionId}: ${selection.question}`,
    `Return status "answered" when the question has a well-evidenced answer.`,
    `Return status "killed" if evidence shows the hypothesis/approach is non-viable.`,
    `Return status "narrowed" if you've made meaningful progress but can't fully answer.`,
    `Return status "exhausted" after ${maxExpertIterations} iterations with diminishing returns.`,
  ].join("\n");

  return {
    questionId: selection.questionId,
    question: selection.question,
    persona,
    relevantFindings,
    convergenceCriteria,
    maxIterations: maxExpertIterations,
    projectDir,
    expertDir,
    questionType: selection.questionType,
    adaptedFromHash,
    provider,
  };
}

/**
 * Create a fresh persona from scratch using the full creation framework.
 */
async function createFreshPersona(
  selection: QuestionSelection,
  projectDir: string,
  maxExpertIterations: number,
  iterStr: string,
  provider?: Provider
): Promise<string> {
  const prompt = await assembleExpertCreationPrompt(selection, projectDir, maxExpertIterations);

  console.log("   Building expert persona from scratch...");
  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${iterStr}-create-expert`,
    provider ? { provider } : undefined
  );

  if (result.exitCode !== 0) {
    console.log(`   \u26a0 Expert creation exited with code ${result.exitCode}`);
  }

  const persona = extractPersonaFromOutput(result.stdout);
  if (!persona) {
    throw new Error("Failed to extract expert persona from creation session output");
  }
  return persona;
}

/**
 * Adapt an existing high-scoring persona for a new question.
 * This is cheaper than creating from scratch — the persona structure already exists.
 */
async function adaptExistingPersona(
  basePersona: string,
  selection: QuestionSelection,
  projectDir: string,
  maxExpertIterations: number,
  iterStr: string,
  provider?: Provider
): Promise<string> {
  const summary = await readSummary(projectDir);
  const prompt = `You are an expert persona adaptation agent. You have a proven expert persona that performed well on a similar question type. Adapt it for a new question.

## Base Persona (proven, high-scoring)
${basePersona}

## New Question
QUESTION: ${selection.question}
QUESTION_ID: ${selection.questionId}
QUESTION_TYPE: ${selection.questionType}
SUGGESTED_EXPERT_TYPE: ${selection.suggestedExpertType}
MAX_ITERATIONS: ${maxExpertIterations}

## Current Knowledge
${summary || "(No prior findings)"}

## Instructions
1. Keep the structural framework (6 sections) from the base persona
2. Adapt domain-specific knowledge, mental models, and convergence criteria to the new question
3. Preserve anti-hallucination rules and workflow stages
4. Update the identity to match the suggested expert type
5. Keep the persona under 60 lines

Wrap the adapted persona between ===PERSONA_START=== and ===PERSONA_END=== delimiters.
`;

  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${iterStr}-adapt-expert`,
    provider ? { provider } : undefined
  );

  const persona = extractPersonaFromOutput(result.stdout);
  if (!persona) {
    // Adaptation failed — fall back to fresh creation
    console.log("   \u26a0 Adaptation failed, falling back to fresh creation");
    return createFreshPersona(selection, projectDir, maxExpertIterations, iterStr, provider);
  }
  return persona;
}

/**
 * Assemble the prompt for the expert creation claude -p session.
 */
async function assembleExpertCreationPrompt(
  selection: QuestionSelection,
  projectDir: string,
  maxExpertIterations: number = 5
): Promise<string> {
  // Load the framework template
  const framework = await readFile(
    path.join(SEA_ROOT, "templates", "expert-creation-framework.md"),
    "utf-8"
  );

  // Load project context
  const goal = await safeRead(path.join(projectDir, "goal.md"));
  const summary = await readSummary(projectDir);

  // Load relevant findings
  const relevantFindings = await selectRelevantFindings(projectDir, selection, 15);
  const findingsText = relevantFindings.length > 0
    ? relevantFindings.map((f) => `- ${f.id}: [${f.tag}] ${f.claim} (confidence: ${f.confidence}, status: ${f.status})`).join("\n")
    : "(No directly relevant findings yet)";

  // Load failure and success patterns
  const failurePatterns = await loadFailurePatterns();
  const successPatterns = await loadSuccessPatterns();

  return `${framework}

---

## CREATE AN EXPERT FOR THIS QUESTION

QUESTION: ${selection.question}
QUESTION_ID: ${selection.questionId}
QUESTION_TYPE: ${selection.questionType}
SUGGESTED_EXPERT_TYPE: ${selection.suggestedExpertType}
${selection.questionType === "data-hunt" ? "\n⚠ DATA-HUNT QUESTION: If after 2 iterations you have found no concrete data, declare exhaustion in your next handoff rather than repeating similar searches. This question type has high exhaustion risk — do not burn iterations on empty search spaces.\n" : ""}

PROJECT GOAL:
${truncate(goal, 2000)}

CURRENT KNOWLEDGE:
${summary || "(No prior findings — first iteration)"}

RELEVANT FINDINGS:
${findingsText}

FAILURE PATTERNS:
${failurePatterns || "(None documented yet)"}

SUCCESS PATTERNS:
${successPatterns || "(None recorded yet)"}

MAX_ITERATIONS: ${maxExpertIterations}

Now produce the expert persona following the 6-section anatomy. Wrap it between ===PERSONA_START=== and ===PERSONA_END=== delimiters.
`;
}

/**
 * Extract the persona markdown from between the delimiter markers.
 */
function extractPersonaFromOutput(output: string): string | null {
  const startMarker = "===PERSONA_START===";
  const endMarker = "===PERSONA_END===";

  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return output.slice(startIdx + startMarker.length, endIdx).trim();
  }

  // Fallback: if no markers, try to extract everything after "# " (first heading)
  const headingIdx = output.indexOf("\n# ");
  if (headingIdx !== -1) {
    return output.slice(headingIdx).trim();
  }

  return null;
}

/**
 * Select findings relevant to the expert's question.
 * Uses domain matching and explicit ID references from the selection.
 * When the store is large, prioritizes domain-relevant findings over random ones.
 */
async function selectRelevantFindings(
  projectDir: string,
  selection: QuestionSelection,
  maxFindings: number
): Promise<Finding[]> {
  const allFindings = await readFindings(projectDir);

  // Tier 1: Explicitly referenced findings
  const byId = allFindings.filter((f) => selection.relevantFindingIds.includes(f.id));
  const remaining = maxFindings - byId.length;

  // Active findings not already selected by ID
  const active = allFindings.filter(
    (f) =>
      (f.status === "verified" || f.status === "provisional") &&
      !selection.relevantFindingIds.includes(f.id)
  );

  // Tier 2: When the store is large, prioritize domain-relevant findings
  let prioritized: Finding[];
  if (active.length > remaining * 2) {
    const keywords = extractDomainKeywords(selection.question);
    const scored = active.map((f) => ({
      finding: f,
      relevance: keywords.filter((kw) =>
        (f.domain || "").toLowerCase().includes(kw) ||
        f.claim.toLowerCase().includes(kw)
      ).length,
    }));
    scored.sort((a, b) =>
      b.relevance - a.relevance ||
      (b.finding.status === "verified" ? 1 : 0) - (a.finding.status === "verified" ? 1 : 0)
    );
    prioritized = scored.map((s) => s.finding);
  } else {
    prioritized = active;
  }

  // Combine, deduplicate, cap
  const combined = [...byId, ...prioritized];
  const seen = new Set<string>();
  const deduped = combined.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  return deduped.slice(0, maxFindings);
}

/**
 * Extract meaningful domain keywords from question text for relevance matching.
 */
function extractDomainKeywords(text: string): string[] {
  const stops = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "was", "has", "how", "its", "may", "what", "when", "where", "which", "with", "would", "could", "should", "about", "from", "into", "does", "have", "been", "that", "them", "then", "these", "they", "this", "those", "will", "more", "also"]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stops.has(w));
}

// ── Helpers ──

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

async function loadSuccessPatterns(): Promise<string> {
  const dir = path.join(SEA_ROOT, "success-patterns");
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return "";

    const patterns: string[] = [];
    for (const file of mdFiles) {
      const content = await safeRead(path.join(dir, file));
      const stratMatch = content.match(/## Strategy\n+([\s\S]*?)(?=\n##)/);
      if (stratMatch) {
        const strat = stratMatch[1].trim().split("\n")[0];
        patterns.push(`- **${file.replace(".md", "")}:** ${strat}`);
      }
    }
    return patterns.join("\n");
  } catch {
    return "";
  }
}

async function loadFailurePatterns(): Promise<string> {
  const dir = path.join(SEA_ROOT, "failure-patterns");
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return "";

    const patterns: string[] = [];
    for (const file of mdFiles) {
      const content = await safeRead(path.join(dir, file));
      const descMatch = content.match(/## Description\n+([\s\S]*?)(?=\n##|\n$)/);
      if (descMatch) {
        const desc = descMatch[1].trim().split("\n")[0];
        patterns.push(`- **${file.replace(".md", "")}:** ${desc}`);
      }
    }
    return patterns.join("\n");
  } catch {
    return "";
  }
}
