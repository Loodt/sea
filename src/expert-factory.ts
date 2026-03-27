import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { runAndTrace } from "./runner.js";
import { readSummary, readFindings, queryFindings } from "./knowledge.js";
import type { ExpertConfig, QuestionSelection, Finding } from "./types.js";

const SEA_ROOT = process.cwd();

/**
 * Create an expert persona for a specific question using the expert creation framework.
 * This is the "80% investment" — the quality of the persona determines the quality of the research.
 */
export async function createExpert(
  selection: QuestionSelection,
  projectDir: string,
  conductorIteration: number,
  maxExpertIterations: number
): Promise<ExpertConfig> {
  const iterStr = String(conductorIteration).padStart(3, "0");
  const expertDir = path.join(projectDir, "experts", `Q${selection.questionId}-iter-${iterStr}`);
  await mkdir(expertDir, { recursive: true });

  // Assemble the expert creation prompt
  const prompt = await assembleExpertCreationPrompt(selection, projectDir);

  console.log("   Building expert persona...");

  // Run the creation session
  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${iterStr}-create-expert`
  );

  if (result.exitCode !== 0) {
    console.log(`   ⚠ Expert creation exited with code ${result.exitCode}`);
  }

  // Extract the persona from the output
  const persona = extractPersonaFromOutput(result.stdout);

  if (!persona) {
    throw new Error("Failed to extract expert persona from creation session output");
  }

  // Save persona for auditing
  await writeFile(path.join(expertDir, "persona.md"), persona, "utf-8");
  console.log(`   ✓ Expert persona created (${persona.split("\n").length} lines)`);

  // Select relevant findings for the expert's context
  const relevantFindings = await selectRelevantFindings(projectDir, selection, 20);

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
  };
}

/**
 * Assemble the prompt for the expert creation claude -p session.
 */
async function assembleExpertCreationPrompt(
  selection: QuestionSelection,
  projectDir: string
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

  // Load failure patterns
  const failurePatterns = await loadFailurePatterns();

  return `${framework}

---

## CREATE AN EXPERT FOR THIS QUESTION

QUESTION: ${selection.question}
QUESTION_ID: ${selection.questionId}
SUGGESTED_EXPERT_TYPE: ${selection.suggestedExpertType}

PROJECT GOAL:
${truncate(goal, 2000)}

CURRENT KNOWLEDGE:
${summary || "(No prior findings — first iteration)"}

RELEVANT FINDINGS:
${findingsText}

FAILURE PATTERNS:
${failurePatterns || "(None documented yet)"}

MAX_ITERATIONS: ${5}

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
 */
async function selectRelevantFindings(
  projectDir: string,
  selection: QuestionSelection,
  maxFindings: number
): Promise<Finding[]> {
  const allFindings = await readFindings(projectDir);

  // Start with explicitly referenced findings
  const byId = allFindings.filter((f) => selection.relevantFindingIds.includes(f.id));

  // Add verified/provisional findings (most useful for context)
  const active = allFindings.filter(
    (f) =>
      (f.status === "verified" || f.status === "provisional") &&
      !selection.relevantFindingIds.includes(f.id)
  );

  // Combine, deduplicate, cap
  const combined = [...byId, ...active];
  const seen = new Set<string>();
  const deduped = combined.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  return deduped.slice(0, maxFindings);
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

async function loadFailurePatterns(): Promise<string> {
  const dir = path.join(SEA_ROOT, "failure-patterns");
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return "";

    const patterns: string[] = [];
    for (const file of mdFiles.slice(0, 5)) {
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
