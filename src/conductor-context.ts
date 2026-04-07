import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { readSummary, readFindings, readQuestions, findingCounts } from "./knowledge.js";
import type { ExpertHandoff, Question, Finding, EngineeringType, Provider } from "./types.js";
import { conductorFile, conductorFileCandidates, ENGINEERING_TYPE_PRIORITY, QUESTION_TYPE_CONTEXT_FILTER } from "./types.js";

const SEA_ROOT = process.cwd();

// ── Utilities ──

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Read conductor playbook, trying provider's preferred file then falling back. */
async function readConductorPlaybook(provider?: Provider): Promise<string> {
  for (const name of conductorFileCandidates(provider)) {
    const content = await safeRead(path.join(SEA_ROOT, name));
    if (content) return content;
  }
  return "";
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

function extractHeadings(md: string): string {
  return md
    .split("\n")
    .filter((l) => /^#{1,3}\s/.test(l))
    .join("\n");
}

// ── Wiki Context ──

const TYPE_FOLDER_MAP: Record<EngineeringType, string> = {
  MEASUREMENT: "facts",
  STANDARD: "facts",
  DERIVED: "relationships",
  DESIGN: "decisions",
  ASSUMPTION: "assumptions",
  HYPOTHESIS: "assumptions",
};

/**
 * Select wiki nodes relevant to the given question type and domain,
 * respecting a character budget. Drops lower-priority types first.
 */
export async function selectWikiContext(
  projectDir: string,
  questionType: string,
  domain: string,
  charBudget: number = 3000
): Promise<string> {
  const wikiDir = path.join(projectDir, "wiki");
  if (!existsSync(wikiDir)) return "";

  // Read manifest to know what nodes exist
  let manifest: { entries: Array<{ findingId: string; wikiPath: string }> };
  try {
    const content = await readFile(path.join(wikiDir, "manifest.json"), "utf-8");
    manifest = JSON.parse(content);
  } catch {
    return "";
  }
  if (!manifest.entries || manifest.entries.length === 0) return "";

  const allowedTypes = QUESTION_TYPE_CONTEXT_FILTER[questionType] ??
    (["MEASUREMENT", "STANDARD", "DERIVED", "DESIGN", "ASSUMPTION"] as EngineeringType[]);

  // Read findings to get their engineering types and domains
  const findings = await readFindings(projectDir);
  const findingMap = new Map(findings.map((f) => [f.id, f]));

  const candidates: Array<{ priority: number; content: string }> = [];

  for (const entry of manifest.entries) {
    const finding = findingMap.get(entry.findingId);
    if (!finding) continue;

    const engType = finding.engineeringType ?? "ASSUMPTION";
    if (!allowedTypes.includes(engType as EngineeringType)) continue;

    // Domain relevance check — match if domain overlaps or is general
    if (domain && finding.domain && !finding.domain.toLowerCase().includes(domain.toLowerCase()) &&
        !domain.toLowerCase().includes(finding.domain.toLowerCase())) continue;

    try {
      const nodePath = path.join(projectDir, entry.wikiPath.replace(/\//g, path.sep));
      const content = await readFile(nodePath, "utf-8");
      candidates.push({
        priority: ENGINEERING_TYPE_PRIORITY[engType as EngineeringType] ?? 5,
        content,
      });
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) return "";

  // Sort by priority (lower = higher priority = include first)
  candidates.sort((a, b) => a.priority - b.priority);

  const selected: string[] = [];
  let used = 0;
  for (const c of candidates) {
    if (used + c.content.length > charBudget) break;
    selected.push(c.content);
    used += c.content.length;
  }

  if (selected.length === 0) return "";
  return `## Relevant Engineering Knowledge (${selected.length} nodes)\n\n${selected.join("\n---\n\n")}`;
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
  // "landscape" type = include all engineering types. The conductor needs a broad view
  // of all knowledge to decide which question to select next. Domain is empty = all domains.
  const wikiContext = await selectWikiContext(projectDir, "landscape", "", 3000);
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
${wikiContext ? `\n${wikiContext}` : ""}

## Project Statistics
${statsText}

## Open Questions
${questionsText}
${exhaustedText}

## Selection Criteria
Rank by: decision-relevance per research cost > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
Skip LOW feasibility questions (<30% chance answer exists in public sources — e.g., proprietary data, unpublished measurements). Flag them with a cost estimate instead of dispatching an expert.
Prefer data-dense domains (regulatory, published science) when information gain is similar. See CLAUDE.md for question type taxonomy and iteration caps.

${openQuestions.length === 0 ? `## No Open Questions Available
Generate 3-5 initial research questions from the project goal (specific, ordered fundamental→detailed, tagged with priority and domain).
Write to knowledge/questions.jsonl: {"id": "Q001", "question": "...", "priority": "high", "context": "...", "domain": "...", "iteration": ${conductorIteration}, "status": "open", "resolvedAt": null, "resolvedBy": null}
Then select the first one.` : ""}

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
  const counts = findingCounts(findings);
  const goal = await safeRead(path.join(projectDir, "goal.md"));

  const handoffJson = JSON.stringify(handoff, null, 2);

  // Exhaustion reason context
  const exhaustionContext = handoff.exhaustionReason
    ? `\nExhaustion reason: **${handoff.exhaustionReason}** (${
        handoff.exhaustionReason === "data-gap" ? "data genuinely doesn't exist in public sources" :
        handoff.exhaustionReason === "strategy-limit" ? "search strategy may need rethinking" :
        "infrastructure/timeout failure"
      })`
    : "";

  return `You are the SEA Conductor. Validate and integrate an expert's research handoff into the knowledge store.

Your working directory is: ${projectDir}

## Expert Handoff
\`\`\`json
${handoffJson}
\`\`\`
${exhaustionContext}

## Current Knowledge Store (computed from findings.jsonl)
- Findings: ${counts.total} total (${counts.verified} verified, ${counts.provisional} provisional, ${counts.refuted} refuted, ${counts.superseded} superseded)
- Questions: ${questions.length} total (${questions.filter((q) => q.status === "open").length} open, ${questions.filter((q) => q.status === "resolved").length} resolved)

## Instructions

### 1. Validate the handoff
Verify status "${handoff.status}" matches evidence. Check findings for plausibility, sources, and contradictions with existing verified findings.
${handoff.status === "crashed" ? `\n**Infrastructure crash** — do NOT create an exhaustion-as-finding. Question remains open for re-dispatch.\n` : ""}${handoff.status === "exhausted" ? `\n**Exhaustion-as-finding** — create synthetic DERIVED finding (F${String(counts.total + 1).padStart(3, "0")}, confidence 0.9) documenting the search space covered and data not found. This prevents re-investigation of the same gap.\n` : ""}
### 2. Integrate findings
Check existing findings.jsonl for duplicate claims BEFORE appending. New findings get sequential IDs after F${String(counts.total).padStart(3, "0")}. Confirm existing provisional → update to "verified". Contradictions → flag both.

### 3. Update questions
Apply question status changes from handoff. Set resolvedBy. New questions get sequential IDs after Q${String(questions.length).padStart(3, "0")}.

### 4. Update summary
Rewrite knowledge/summary.md (max 2KB). Read findings.jsonl to compute actual counts — do not use handoff counts.

### 5. Goal check
${truncate(goal, 1000)}
Add \`## Goal Progress\` to summary — for each criterion: MET (finding IDs), PARTIAL (what's missing), or NOT MET. If all MET: **PROJECT GOAL FULLY MET**.

### 6. Report
Output: findings added, confirmed existing, contradictions, questions resolved, new questions added.
`;
}

// ── Conductor Meta ──

/**
 * Assemble the prompt for conductor meta-evolution.
 */
export async function assembleConductorMetaPrompt(
  projectDir: string,
  conductorIteration: number,
  provider?: Provider
): Promise<string> {
  const filename = conductorFile(provider);
  const conductor = await readConductorPlaybook(provider);
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

  const conductorLines = conductor.split("\n").length;

  const conductorHeadings = extractHeadings(conductor);

  return `You are the SEA meta-evolution agent. Improve the SEA Conductor itself.

Your working directory is: ${SEA_ROOT}

## Current Conductor (${conductorLines} lines)
The conductor playbook (${filename}) is auto-loaded as project instructions — you already have its full content. Read it from disk when you need to modify it.

### Structure
${conductorHeadings}

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
5. Propose specific improvements to ${filename}
6. Do NOT modify the "Safety Rails" section — it is immutable
7. Write the updated ${filename} (the versioner will preserve the old one)

## CONDUCTOR SIZE BUDGET
${filename} is currently ${conductorLines} lines. The hard limit is 150 lines.
${conductorLines > 120 ? `\n⚠ CONSOLIDATION REQUIRED (${conductorLines} > 120 lines). Before adding ANY new content:\n- Remove resolved infrastructure debt items\n- Move dispatch pattern observations to a separate file (NOT loaded into agent context)\n- Merge overlapping rules\n- Remove pipeline-mode-only rules if no active pipeline-mode projects exist\n- Every line must earn its place — cut observational notes that don't change behavior` : ""}
${conductorLines > 150 ? `\n🛑 OVER LIMIT. You MUST reduce to ≤150 lines. No new content until consolidated.` : ""}
`;
}
