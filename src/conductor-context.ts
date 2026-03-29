import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readSummary, readFindings, readQuestions } from "./knowledge.js";
import type { ExpertHandoff, Question, Finding } from "./types.js";

const SEA_ROOT = process.cwd();

// ── Utilities ──

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

// ── Question Selection ──

/**
 * Assemble the prompt for the conductor to select the highest-value question.
 */
export async function assembleQuestionSelectionPrompt(
  projectDir: string,
  conductorIteration: number,
  exhaustedQuestionIds: string[]
): Promise<string> {
  const goal = await safeRead(path.join(projectDir, "goal.md"));
  const summary = await readSummary(projectDir);
  const questions = await readQuestions(projectDir);
  const findings = await readFindings(projectDir);

  const openQuestions = questions.filter(
    (q) => q.status === "open" && !exhaustedQuestionIds.includes(q.id)
  );

  const questionsText = openQuestions.length > 0
    ? openQuestions
        .map((q) => {
          const age = conductorIteration - q.iteration;
          return `- ${q.id} [${q.priority}] (age: ${age} iters, domain: ${q.domain}): ${q.question}${q.context ? `\n  Context: ${q.context}` : ""}`;
        })
        .join("\n")
    : "(No open questions — you may need to generate initial questions from the project goal)";

  const exhaustedText = exhaustedQuestionIds.length > 0
    ? `\nExhausted questions (do NOT select these): ${exhaustedQuestionIds.join(", ")}`
    : "";

  const resolvedQuestions = questions.filter((q) => q.status === "resolved");
  const openCount = openQuestions.length;
  const resolvedCount = resolvedQuestions.length;
  const exhaustedCount = exhaustedQuestionIds.length;
  const pruningMode = openCount > 15 || (resolvedCount > 0 && openCount / resolvedCount > 2);

  const statsText = [
    `Total findings: ${findings.length} (${findings.filter((f) => f.status === "verified").length} verified)`,
    `Open questions: ${openCount} | Resolved: ${resolvedCount} | Exhausted: ${exhaustedCount}`,
    `Open:Resolved ratio: ${resolvedCount > 0 ? (openCount / resolvedCount).toFixed(1) : "∞"}:1`,
    `Conductor iteration: ${conductorIteration}`,
    pruningMode ? `\n⚠ PRUNING MODE ACTIVE (${openCount} open questions exceeds threshold). Prioritize kill-check and synthesis questions to narrow the frontier below 15 open. Deprioritize mechanism questions. Before dispatching landscape questions, check if existing open questions overlap.` : "",
  ].filter(Boolean).join("\n");

  return `You are the SEA Conductor. Select the single highest-value question to investigate next.

Your working directory is: ${projectDir}

## Project Goal
${truncate(goal, 2000)}

## Current Knowledge Summary
${summary || "(No findings yet — first conductor iteration)"}

## Project Statistics
${statsText}

## Open Questions
${questionsText}
${exhaustedText}

## Selection Criteria
Rank questions by:
1. **Information gain potential** — Which question, if answered, would unlock the most progress?
2. **Priority** — HIGH > MEDIUM > LOW
3. **Feasibility** — Can this be answered through web research?
4. **Domain data density** — Well-documented domains (regulatory, published chemistry) yield 5-10x more findings per iteration than data-sparse domains (facility-specific costs, proprietary data). Prefer data-dense domains when information gain is similar.
5. **Staleness** — Older unanswered questions may indicate blocking gaps
6. **Dependencies** — Does answering this question enable answering others?

${openQuestions.length === 0 ? `## No Open Questions Available
Generate 3-5 initial research questions from the project goal. These should be:
- Specific enough for a single expert to investigate
- Ordered from most fundamental to most detailed
- Tagged with priority and domain

Write them to knowledge/questions.jsonl in this format (one per line):
{"id": "Q001", "question": "...", "priority": "high", "context": "...", "domain": "...", "iteration": ${conductorIteration}, "status": "open", "resolvedAt": null, "resolvedBy": null}

Then select the first one.` : ""}

## Question Type Taxonomy
Classify each question before dispatch:
- **landscape** — broad survey of a domain or option space. Standard budget (5 iterations).
- **kill-check** — hypothesis falsification. High information density. Prioritize when >3 open pathways exist.
- **data-hunt** — seeks specific numeric values/costs/thresholds. HIGH exhaustion risk. Capped at 3 iterations.
- **mechanism** — investigates how/why something works. Standard budget.
- **synthesis** — answerable by combining/re-analyzing existing knowledge store findings. Very high efficiency. Capped at 2 iterations.

## Instructions
1. Analyse the open questions against the selection criteria
2. Classify the question type (landscape, kill-check, data-hunt, or mechanism)
3. Select exactly ONE question
4. Output your selection as a JSON code block:

\`\`\`json
{
  "questionId": "Q___",
  "question": "the full question text",
  "questionType": "landscape|kill-check|data-hunt|mechanism|synthesis",
  "reasoning": "why this question has the highest value right now (2-3 sentences)",
  "relevantFindingIds": ["F001", "F003"],
  "suggestedExpertType": "descriptive label for the expert needed (e.g., 'chlorination process chemist')",
  "estimatedIterations": 3
}
\`\`\`
`;
}

// ── Handoff Integration ──

/**
 * Assemble the prompt for the conductor to validate and integrate an expert's handoff.
 */
export async function assembleHandoffIntegrationPrompt(
  projectDir: string,
  handoff: ExpertHandoff
): Promise<string> {
  const findings = await readFindings(projectDir);
  const questions = await readQuestions(projectDir);

  const handoffJson = JSON.stringify(handoff, null, 2);

  return `You are the SEA Conductor. Validate and integrate an expert's research handoff into the knowledge store.

Your working directory is: ${projectDir}

## Expert Handoff
\`\`\`json
${handoffJson}
\`\`\`

## Current Knowledge Store
- Findings: ${findings.length} total (${findings.filter((f) => f.status === "verified").length} verified, ${findings.filter((f) => f.status === "provisional").length} provisional)
- Questions: ${questions.length} total (${questions.filter((q) => q.status === "open").length} open)

## Instructions

### 1. Validate the handoff
- Does the status ("${handoff.status}") match the evidence in the summary and findings?
- Are the findings plausible? Do they have sources or derivation methods?
- Do any findings contradict existing verified findings? If so, flag the contradiction.

${handoff.status === "crashed" ? `### 1b. Infrastructure Crash
This dispatch crashed (all inner iterations failed with non-zero exit codes). This is an infrastructure failure, NOT a content signal. Do NOT create an exhaustion-as-finding. The question remains open for re-dispatch once the infrastructure issue is resolved.
` : ""}${handoff.status === "exhausted" ? `### 1b. Exhaustion-as-Finding
This dispatch exhausted — the negative result IS knowledge. Create a synthetic finding:
- ID: F${String(findings.length + 1).padStart(3, "0")}
- tag: "DERIVED"
- claim: Describe what search space was covered and what specific data was sought but not found
- source: null
- confidence: 0.9 (high confidence that the data doesn't exist in searched sources)
- Add context about the implication for the research frontier
- This prevents future dispatches from re-investigating the same gap
` : ""}### 2. Integrate findings into the knowledge store
For each finding in the handoff:
- Assign a proper sequential ID (next after F${String(findings.length).padStart(3, "0")})
- Append to knowledge/findings.jsonl
- If a finding confirms an existing provisional finding, update the existing one to "verified"
- If a finding contradicts an existing finding, flag both

### 3. Update question statuses
For each question update in the handoff:
- Update the question's status in knowledge/questions.jsonl
- Set resolvedBy to the finding that resolved it

### 4. Add new questions
For each new question discovered:
- Assign a sequential ID (next after Q${String(questions.length).padStart(3, "0")})
- Append to knowledge/questions.jsonl with status "open"

### 5. Update summary
- Rewrite knowledge/summary.md (max 2KB) to reflect the new state

### 6. Report
After integration, output a brief integration report:
- Findings added: N
- Findings that confirmed existing: N
- Contradictions detected: N
- Questions resolved: N
- New questions added: N
`;
}

// ── Conductor Meta ──

/**
 * Assemble the prompt for conductor meta-evolution.
 */
export async function assembleConductorMetaPrompt(
  projectDir: string,
  conductorIteration: number
): Promise<string> {
  const conductor = await safeRead(path.join(SEA_ROOT, "CLAUDE.md"));
  const integrity = await safeRead(path.join(SEA_ROOT, "eval", "integrity.md"));

  // Read conductor metrics if they exist
  const metricsRaw = await safeRead(path.join(projectDir, "metrics", "conductor-metrics.jsonl"));
  const metricsLines = metricsRaw.trim() ? metricsRaw.trim().split("\n").slice(-10) : [];

  // Read lineage across projects
  const projectsDir = path.join(SEA_ROOT, "projects");
  const allLineage: string[] = [];
  try {
    const projectNames = await readdir(projectsDir);
    for (const name of projectNames) {
      const lineageRaw = await safeRead(
        path.join(projectsDir, name, "lineage", "changes.jsonl")
      );
      if (lineageRaw.trim()) {
        const entries = lineageRaw.trim().split("\n").slice(-5);
        allLineage.push(`### ${name}\n${entries.join("\n")}`);
      }
    }
  } catch {
    // no projects dir
  }

  return `You are the SEA meta-evolution agent. Improve the SEA Conductor itself.

Your working directory is: ${SEA_ROOT}

## Current Conductor
${conductor}

## Integrity Principles
${truncate(integrity, 3000)}

## Recent Conductor Metrics
${metricsLines.length > 0 ? metricsLines.join("\n") : "No conductor metrics yet."}

## Project Lineage
${allLineage.length > 0 ? allLineage.join("\n\n") : "No lineage yet."}

## Conductor Iteration: ${conductorIteration}

## Instructions
1. Analyse patterns across recent conductor dispatches
2. What expert types are producing high-value results?
3. Are questions being selected well? Any patterns of exhausted dispatches?
4. Is the knowledge store growing effectively?
5. Propose specific improvements to CLAUDE.md
6. Do NOT modify the "Safety Rails" section — it is immutable
7. Write the updated CLAUDE.md (the versioner will preserve the old one)
`;
}
