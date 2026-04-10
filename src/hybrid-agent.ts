import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runAndTrace } from "./runner.js";
import { readSummary, readFindings, readQuestions } from "./knowledge.js";
import { selectWikiContext } from "./conductor-context.js";
import { appendSpan } from "./metrics.js";
import type { QuestionSelection, Finding, Question, HybridResult, ConductorConfig, ExhaustionReason, QuestionType } from "./types.js";
import { QUESTION_TYPE_SEARCH_BUDGET } from "./types.js";

/**
 * HYBRID RESEARCH AGENT (v035)
 *
 * Single LLM call that replaces three separate calls:
 * - Expert persona creation (eliminated — no persona needed)
 * - Expert research loop (1-5 inner iterations → 1 unified call)
 * - Handoff integration (eliminated — agent writes directly to knowledge store)
 *
 * The conductor's question selection (Call 1) remains separate —
 * it drives exploration breadth that a single agent doesn't replicate.
 *
 * Based on EXP-013 findings: SAS is 3.5x more efficient per-call.
 * Conductor's strategic question selection is the genuine MAS advantage.
 */

// ── Context Formatting ──

function compressFindings(findings: Finding[], maxChars: number = 12000): string {
  if (findings.length === 0) return "(No findings in knowledge store yet)";

  const sorted = [...findings].sort((a, b) => {
    if (a.status === "verified" && b.status !== "verified") return -1;
    if (b.status === "verified" && a.status !== "verified") return 1;
    return b.confidence - a.confidence;
  });

  const lines = sorted.map(
    (f) =>
      `- ${f.id}: [${f.tag}${f.source ? `: ${f.source}` : ""}] ${f.claim.length > 140 ? f.claim.slice(0, 137) + "..." : f.claim} (${f.status}, conf: ${f.confidence})`
  );
  const raw = lines.join("\n");
  if (raw.length <= maxChars) return raw;

  const truncated = raw.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf("\n");
  return (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated)
    + `\n...(${findings.length} total findings — truncated, highest-confidence shown first)`;
}

function formatQuestions(questions: Question[]): string {
  if (questions.length === 0) return "(No questions yet)";

  const open = questions.filter((q) => q.status === "open");
  const resolved = questions.filter((q) => q.status === "resolved");
  const gated = questions.filter((q) => q.status === "empirical-gate");

  const lines: string[] = [];

  if (open.length > 0) {
    lines.push(`### Open (${open.length})`);
    for (const q of open) {
      lines.push(`- ${q.id} [${q.priority}]: ${q.question} (domain: ${q.domain})`);
      if (q.context) lines.push(`  Context: ${q.context}`);
    }
  }
  if (resolved.length > 0) {
    lines.push(`\n### Resolved (${resolved.length})`);
    for (const q of resolved.slice(-15)) {
      lines.push(`- ${q.id}: ${q.question} → resolved by ${q.resolvedBy || "unknown"}`);
    }
    if (resolved.length > 15) lines.push(`  ...(${resolved.length - 15} more)`);
  }
  if (gated.length > 0) {
    lines.push(`\n### Empirical-Gated (${gated.length} — need real-world data, do not re-investigate)`);
    for (const q of gated) {
      lines.push(`- ${q.id}: ${q.question}`);
    }
  }
  return lines.join("\n");
}

// ── Core Function ──

/**
 * Run a single hybrid research iteration.
 * Receives the question from the conductor's dedicated selection call.
 * Does research + knowledge store writes in one LLM call.
 */
export async function runHybridResearch(
  projectDir: string,
  selection: QuestionSelection,
  conductorIteration: number,
  config?: ConductorConfig
): Promise<HybridResult> {
  const iterStr = String(conductorIteration).padStart(3, "0");
  const researchDir = path.join(projectDir, "experts", `hybrid-${iterStr}-${selection.questionId}`);
  await mkdir(researchDir, { recursive: true });

  // Snapshot knowledge store BEFORE the agent runs
  const findingsBefore = await readFindings(projectDir);
  const questionsBefore = await readQuestions(projectDir);

  // Read full context
  const goal = await safeRead(path.join(projectDir, "goal.md"));
  const summary = await readSummary(projectDir);
  const activeFindings = findingsBefore.filter(
    (f) => f.status === "verified" || f.status === "provisional"
  );
  const wikiContext = await selectWikiContext(
    projectDir,
    selection.questionType,
    extractDomain(selection.question),
    3000
  );

  // Build prompt
  const prompt = assembleHybridPrompt(
    goal, summary, activeFindings, questionsBefore, selection,
    projectDir, conductorIteration, wikiContext
  );

  // Single LLM call
  const startTime = Date.now();
  const result = await runAndTrace(
    prompt,
    projectDir,
    researchDir,
    `hybrid-${iterStr}`,
    config?.provider ? { provider: config.provider } : undefined
  );

  // Emit span
  const findingsInOutput = (result.stdout.match(/\[(SOURCE|DERIVED|ESTIMATED)/g) || []).length;
  await appendSpan(projectDir, {
    id: `hybrid-${iterStr}`,
    step: "hybrid-research",
    parentId: `conductor-${iterStr}`,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    promptChars: prompt.length,
    outputChars: result.stdout.length,
    promptTokensEst: Math.ceil(prompt.length / 4),
    outputTokensEst: Math.ceil(result.stdout.length / 4),
    exitCode: result.exitCode,
    findingsProduced: findingsInOutput,
  });

  // Save raw output
  await writeFile(path.join(researchDir, "output.md"), result.stdout, "utf-8");

  if (result.exitCode !== 0) {
    console.log(`   ⚠ Hybrid research exited with code ${result.exitCode}`);
    return buildCrashResult(selection);
  }

  // Measure actual deltas
  const findingsAfter = await readFindings(projectDir);
  const questionsAfter = await readQuestions(projectDir);

  // Parse structured report
  const report = parseHybridReport(result.stdout, selection);
  report.measuredFindingsDelta = findingsAfter.length - findingsBefore.length;
  report.measuredQuestionsDelta = questionsAfter.length - questionsBefore.length;

  // Brief console output
  const brief = extractBrief(result.stdout);
  if (brief) console.log(`   → ${brief}`);

  return report;
}

// ── Prompt Assembly ──

function assembleHybridPrompt(
  goal: string,
  summary: string,
  findings: Finding[],
  questions: Question[],
  selection: QuestionSelection,
  projectDir: string,
  conductorIteration: number,
  wikiContext: string
): string {
  const findingsContext = compressFindings(findings);
  const questionsContext = formatQuestions(questions);
  const searchBudget = QUESTION_TYPE_SEARCH_BUDGET[selection.questionType] ?? 5;
  const isReasoningType = selection.questionType === "first-principles" || selection.questionType === "design-space";

  const pacingConstraint = isReasoningType
    ? `You may make at most ${searchBudget} web searches, ONLY to verify specific values needed for your derivation. Your primary tool is REASONING from the findings and axioms below.`
    : `You may make at most ${searchBudget + 2} web searches. Distribute across discovery and verification. After searching, synthesize findings from what you discovered.`;

  const approach = isReasoningType
    ? `## APPROACH — REASONING TYPE (${selection.questionType})
1. Study the goal, existing findings, and open questions carefully.
2. State your premises: list each verified finding and domain axiom you will reason from. Cite finding IDs.
3. Perform your derivation with ALL working shown — every logical step, every calculation, every assumption.
4. For each conclusion, produce a derivation chain:
   - PREMISES: [list of finding IDs and/or stated axioms]
   - METHOD: [deduction | calculation | constraint-analysis | analogy]
   - ASSUMPTIONS: [list each assumption explicitly]
   - UNCERTAINTY: [what could invalidate this conclusion]
5. Tag findings as [DERIVED: first-principles] or [DERIVED: design-analysis].
6. Write findings to knowledge/findings.jsonl (append, don't overwrite).
7. Update knowledge/questions.jsonl if any open questions are resolved.
8. Check convergence. If your derivation needs empirical data, converge as "narrowed".`
    : `## APPROACH — RESEARCH TYPE (${selection.questionType})
1. Study the goal, existing findings, and open questions. Identify what's already known and what gaps remain for this specific question.
2. Plan your research strategy. Consider what's been found — don't duplicate existing work.
3. Use web search and web fetch to gather evidence. Tag every claim with its epistemic basis.
4. After researching, CHECK your findings:
   - Does each finding have a source URL or derivation method?
   - Could any finding be wrong? What would that mean?
   - Are there contradictions with existing knowledge?
5. Write findings to knowledge/findings.jsonl (append, don't overwrite).
6. Update knowledge/questions.jsonl if any open questions are resolved.
7. Check convergence against the criteria below.`;

  return `You are a research agent investigating a specific question for a larger research project.
Your working directory is: ${projectDir}

## YOUR ASSIGNED QUESTION
**${selection.questionId}**: ${selection.question}
Question type: ${selection.questionType}
Reasoning: ${selection.reasoning}
${selection.relevantFindingIds.length > 0 ? `Relevant findings to build on: ${selection.relevantFindingIds.join(", ")}` : ""}

## PACING
${pacingConstraint}

## PROJECT GOAL
${goal || "(No goal file found)"}

## KNOWLEDGE SUMMARY
${summary || "(No prior knowledge in the store)"}
${wikiContext ? `\n## WIKI CONTEXT (domain-relevant)\n${wikiContext}` : ""}

## ALL FINDINGS (${findings.length} active)
${findingsContext}

## QUESTION LANDSCAPE
${questionsContext}

${approach}

## EPISTEMIC DISCIPLINE
- Tag EVERY claim: [SOURCE: url], [DERIVED: method], [ESTIMATED: basis], [ASSUMED], [UNKNOWN]
- [UNKNOWN] is always better than an untagged guess
- Anchor comparisons: state baseline, magnitude, and conditions
- Do not fabricate data — if you can't find it, say [UNKNOWN]
- Check if your findings contradict anything in the existing knowledge store
- For [DERIVED] findings, include derivationChain: premises, method, assumptions, uncertainty

## FILE FORMATS

### knowledge/findings.jsonl (append new lines)
{"id": "F9XX", "claim": "...", "tag": "SOURCE", "source": "https://...", "confidence": 0.85, "domain": "...", "iteration": ${conductorIteration}, "status": "provisional", "verifiedAt": null, "supersededBy": null}

For derived findings add: "derivationChain": {"premises": ["F001", "axiom: ..."], "method": "deduction", "assumptions": ["..."], "uncertaintyNote": "..."}

Use IDs starting from F901 to avoid collision (conductor will reassign).

### knowledge/questions.jsonl (update status for resolved, append new)
To resolve: update the question's status to "resolved" and set resolvedBy to the finding ID.
New questions: {"id": "Q0XX", "question": "...", "priority": "high|medium|low", "context": "...", "domain": "...", "iteration": ${conductorIteration}, "status": "open", "resolvedAt": null, "resolvedBy": null}

### knowledge/summary.md
Update with a concise (<2KB) summary of the project's current knowledge state after your research.

## FOLLOW-ON QUESTIONS — CRITICAL
After completing your research, identify 1-3 NEW questions that your findings reveal as important but unanswered. These should be specific, actionable questions that emerged from what you discovered — gaps, contradictions, implications, or deeper investigations that the project goal requires but the current question set does not cover.

Write these as new open questions to knowledge/questions.jsonl. Good follow-on questions:
- Build on findings you just produced (cite the finding ID in context)
- Address a different aspect of the project goal than the question you just answered
- Are specific enough to be answerable in one research dispatch

Do NOT generate follow-ons that duplicate existing open or resolved questions. Check the question landscape above first.

If your research genuinely closes all remaining gaps for the project goal, you may generate zero follow-ons — but this should be rare before the project has 100+ findings.

## CONVERGENCE CRITERIA
- **answered** — question resolved with well-evidenced findings
- **killed** — hypothesis/approach shown non-viable (equally valuable as answered)
- **narrowed** — meaningful progress but not fully answered
- **exhausted** — diminishing returns, move on

## REPORT FORMAT (output at the end)
\`\`\`json
{
  "questionId": "${selection.questionId}",
  "questionText": "${selection.question.slice(0, 100)}",
  "questionType": "${selection.questionType}",
  "status": "answered|killed|narrowed|exhausted",
  "exhaustionReason": "data-gap|strategy-limit (only if exhausted)",
  "findingsAdded": 5,
  "questionsResolved": ["${selection.questionId}"],
  "newQuestionsCreated": 0,
  "summary": "2-4 sentence summary of what you found and its significance"
}
\`\`\`
`;
}

// ── Output Parsing ──

function parseHybridReport(output: string, selection: QuestionSelection): HybridResult {
  // Strategy 1: JSON code block
  const jsonBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    const parsed = tryParseReport(jsonBlockMatch[1].trim(), selection);
    if (parsed) return parsed;
  }

  // Strategy 2: Inline JSON with report fields
  const inlineMatch = output.match(/\{[^{}]*"questionId"\s*:[\s\S]*?"summary"\s*:[\s\S]*?\}/);
  if (inlineMatch) {
    const parsed = tryParseReport(inlineMatch[0], selection);
    if (parsed) return parsed;
  }

  // Fallback
  const findingsCount = (output.match(/\[(SOURCE|DERIVED|ESTIMATED)/g) || []).length;
  return {
    questionId: selection.questionId,
    questionText: selection.question,
    questionType: selection.questionType,
    status: findingsCount > 0 ? "narrowed" : "exhausted",
    findingsAddedByAgent: findingsCount,
    questionsResolvedByAgent: [],
    newQuestionsCreatedByAgent: 0,
    summary: "Agent produced output but no parseable structured report.",
    measuredFindingsDelta: 0,
    measuredQuestionsDelta: 0,
  };
}

function tryParseReport(raw: string, selection: QuestionSelection): HybridResult | null {
  try {
    const p = JSON.parse(raw);
    if (!p.status) return null;

    const VALID_TYPES: QuestionType[] = ["landscape", "kill-check", "data-hunt", "mechanism", "synthesis", "first-principles", "design-space"];
    const qt = VALID_TYPES.includes(p.questionType) ? p.questionType : selection.questionType;

    return {
      questionId: p.questionId ?? selection.questionId,
      questionText: p.questionText ?? selection.question,
      questionType: qt,
      status: p.status,
      findingsAddedByAgent: p.findingsAdded ?? 0,
      questionsResolvedByAgent: Array.isArray(p.questionsResolved) ? p.questionsResolved : [],
      newQuestionsCreatedByAgent: p.newQuestionsCreated ?? 0,
      summary: p.summary ?? "",
      exhaustionReason: p.exhaustionReason,
      measuredFindingsDelta: 0,
      measuredQuestionsDelta: 0,
    };
  } catch {
    return null;
  }
}

function buildCrashResult(selection: QuestionSelection): HybridResult {
  return {
    questionId: selection.questionId,
    questionText: selection.question,
    questionType: selection.questionType,
    status: "crashed",
    findingsAddedByAgent: 0,
    questionsResolvedByAgent: [],
    newQuestionsCreatedByAgent: 0,
    summary: "Hybrid research iteration crashed — infrastructure failure.",
    exhaustionReason: "infrastructure",
    measuredFindingsDelta: 0,
    measuredQuestionsDelta: 0,
  };
}

// ── Helpers ──

function extractBrief(output: string): string {
  if (!output) return "";
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (/key\s+find|main\s+(result|find)|conclusion|verdict|bottom\s+line/i.test(trimmed)) {
      const content = trimmed
        .replace(/^[-*#>\d.]+\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/^(key finding|main result|conclusion|verdict|bottom line)[:\s]*/i, "")
        .trim();
      if (content.length > 20) return content.slice(0, 120);
    }
  }

  const taggedLines = lines.filter((l) =>
    /\[(SOURCE|DERIVED|ESTIMATED)/.test(l) && l.trim().length > 30
  );
  if (taggedLines.length > 0) {
    return `${taggedLines.length} tagged findings produced`;
  }

  const searchCount = (output.match(/web_search|WebSearch|searching for/gi) || []).length;
  if (searchCount > 0) return `${searchCount} web searches executed`;

  return "";
}

function extractDomain(questionText: string): string {
  const stops = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "was", "has", "how", "its", "may", "what", "when", "where", "which", "with"]);
  const words = questionText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !stops.has(w));
  return words.slice(0, 3).join(" ");
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
