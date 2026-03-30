import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runAndTrace } from "./runner.js";
import { appendSpan } from "./metrics.js";
import { readSummary, readFindings, readQuestions } from "./knowledge.js";
import type { ExpertConfig, ExpertHandoff, Finding, Question } from "./types.js";

/** Structured state passed between inner iterations (replaces crude 3KB truncation). */
interface IterationState {
  findingsSoFar: string[];
  searchesCompleted: string[];
  currentHypothesis: string;
  blockers: string[];
  progressSummary: string;
}

/**
 * Run the expert inner loop: iterate on a single question until convergence.
 * Each inner iteration is a single claude -p session that plans, researches, and synthesizes.
 * The persona encodes the workflow stages internally.
 */
export async function runExpertLoop(config: ExpertConfig): Promise<ExpertHandoff> {
  await mkdir(config.expertDir, { recursive: true });

  let priorOutput = "";
  let priorState: IterationState | null = null;
  let lastHandoff: ExpertHandoff | null = null;
  let bestSuccessfulOutput = "";
  let bestSuccessfulLength = 0;
  let successfulIterCount = 0;
  let consecutiveCrashes = 0;

  for (let innerIter = 1; innerIter <= config.maxIterations; innerIter++) {
    const iterStr = String(innerIter).padStart(2, "0");
    console.log(`      Inner iteration ${innerIter}/${config.maxIterations}...`);

    // Crash circuit-breaker: stop after 2 consecutive crashes
    if (consecutiveCrashes >= 2 && innerIter > 2) {
      console.log(`      ⚠ ${consecutiveCrashes} consecutive crashes — stopping early`);
      return buildForcedHandoff(config, bestSuccessfulOutput, innerIter - 1, successfulIterCount === 0);
    }

    // Assemble and run
    const prompt = await assembleExpertPrompt(config, innerIter, priorOutput, priorState);
    const result = await runAndTrace(
      prompt,
      config.projectDir,
      config.expertDir,
      `expert-iter-${iterStr}`
    );

    // Emit structured span
    const findingsInOutput = (result.stdout.match(/\[(SOURCE|DERIVED|ESTIMATED)/g) || []).length;
    await appendSpan(config.projectDir, {
      id: `expert-${config.questionId}-iter-${iterStr}`,
      step: "expert-research",
      parentId: `dispatch-${config.questionId}`,
      startTime: result.startTime,
      endTime: result.endTime,
      durationMs: result.durationMs,
      promptChars: prompt.length,
      outputChars: result.stdout.length,
      promptTokensEst: Math.ceil(prompt.length / 4),
      outputTokensEst: Math.ceil(result.stdout.length / 4),
      exitCode: result.exitCode,
      findingsProduced: findingsInOutput,
    });

    const isCrash = result.exitCode !== 0;

    if (isCrash) {
      consecutiveCrashes++;
      const stderrSnippet = result.stderr ? result.stderr.trim().slice(-200) : "";
      console.log(`      ⚠ Expert iteration ${innerIter} exited with code ${result.exitCode}${stderrSnippet ? ` — ${stderrSnippet.split("\n").pop()}` : ""}`);
    } else {
      consecutiveCrashes = 0;
      successfulIterCount++;
      // Track best successful output for forced handoff (use highest-content iteration)
      if (result.stdout.length > bestSuccessfulLength) {
        bestSuccessfulOutput = result.stdout;
        bestSuccessfulLength = result.stdout.length;
      }
    }

    // Save the raw output
    await writeFile(
      path.join(config.expertDir, `output-iter-${iterStr}.md`),
      result.stdout,
      "utf-8"
    );

    // Print a brief summary of what the expert found
    const brief = extractBriefSummary(result.stdout);
    if (brief) {
      console.log(`      → ${brief}`);
    }

    // Check for convergence / handoff
    const parsed = parseExpertOutput(result.stdout, config.questionId, innerIter);

    if (parsed.handoff) {
      lastHandoff = parsed.handoff;
      lastHandoff.findings = validateFindingSources(lastHandoff.findings);

      if (parsed.converged) {
        console.log(`      ✓ Expert converged: ${parsed.handoff.status}`);
        if (parsed.handoff.summary) {
          console.log(`      ${parsed.handoff.summary.split("\n")[0].slice(0, 100)}`);
        }
        return parsed.handoff;
      }
    }

    // Extract structured state for next iteration (replaces crude truncation)
    priorState = extractIterationState(result.stdout);
    priorOutput = truncate(result.stdout, 3000);
  }

  // Max iterations reached — classify the outcome
  const allCrashed = successfulIterCount === 0;

  if (lastHandoff) {
    lastHandoff.status = allCrashed ? "crashed" : "exhausted";
    lastHandoff.iterationsRun = config.maxIterations;
    lastHandoff.convergenceAchieved = false;
    console.log(`      ⚠ Expert ${lastHandoff.status} after ${config.maxIterations} iterations (${successfulIterCount} successful)`);
    return lastHandoff;
  }

  // No handoff parsed — use best successful output for forced handoff
  if (allCrashed) {
    console.log(`      ⚠ All ${config.maxIterations} iterations crashed — infrastructure failure`);
    return buildForcedHandoff(config, "", config.maxIterations, true);
  }

  console.log(`      ⚠ Expert produced no parseable handoff (${successfulIterCount}/${config.maxIterations} succeeded)`);
  return buildForcedHandoff(config, bestSuccessfulOutput, config.maxIterations, false);
}

/**
 * Validate finding sources: [SOURCE] findings without URLs get downgraded to [ESTIMATED].
 */
function validateFindingSources(findings: Finding[]): Finding[] {
  let downgraded = 0;
  const validated = findings.map((f) => {
    if (f.tag === "SOURCE" && (!f.source || f.source === "null")) {
      downgraded++;
      return { ...f, tag: "ESTIMATED" as Finding["tag"] };
    }
    return f;
  });
  if (downgraded > 0) {
    console.log(`      ℹ Downgraded ${downgraded} [SOURCE] findings to [ESTIMATED] (missing URL)`);
  }
  return validated;
}

/**
 * Assemble the expert's iteration prompt.
 */
async function assembleExpertPrompt(
  config: ExpertConfig,
  innerIter: number,
  priorOutput: string,
  priorState: IterationState | null
): Promise<string> {
  const isFirstIter = innerIter === 1;
  const isFinalIter = innerIter === config.maxIterations;

  // First iteration: full context. Later iterations: structured state + delta only.
  if (isFirstIter) {
    const summary = await readSummary(config.projectDir);
    const findingsContext = config.relevantFindings.length > 0
      ? config.relevantFindings
          .map((f) => `- ${f.id}: [${f.tag}] ${f.claim} (${f.status}, confidence: ${f.confidence})`)
          .join("\n")
      : "(No relevant findings provided)";

    return `You are a research expert. Follow your persona instructions precisely.

Your working directory is: ${config.projectDir}

## YOUR PERSONA
${config.persona}

## YOUR QUESTION
${config.question}
Question ID: ${config.questionId}

## ITERATION 1 of ${config.maxIterations}
This is your FIRST iteration. Start with Stage 1 of your workflow (fast-kill check).

## CURRENT KNOWLEDGE SUMMARY
${summary || "(No prior knowledge in the store)"}

## RELEVANT FINDINGS
${findingsContext}

## CONVERGENCE CRITERIA
${config.convergenceCriteria}

## INSTRUCTIONS
1. Follow your persona's staged workflow. Begin with the fast-kill check.
2. Use web search and web fetch to gather evidence. Tag every claim with its epistemic basis.
3. After synthesizing, CHECK your key findings:
   - Does each finding have a source URL or derivation method?
   - Could any finding be wrong? What would that mean?
   - Are there contradictions with existing knowledge?
4. Write findings incrementally to knowledge/findings.jsonl (append, don't overwrite):
   Each line: {"id": "F{NNN}", "claim": "...", "tag": "SOURCE|DERIVED|ESTIMATED|ASSUMED|UNKNOWN", "source": "url or null", "confidence": 0.0-1.0, "domain": "...", "iteration": 1, "status": "provisional", "verifiedAt": null, "supersededBy": null}
   Use IDs starting from F901 to avoid collision with existing findings (the conductor will reassign IDs).
5. Update knowledge/questions.jsonl if any open questions are resolved by your findings.
6. Check convergence against your criteria. If you can determine a status (answered/killed/narrowed), include the HANDOFF block.
7. If not converged and more iterations remain, end with a brief 'NEXT ITERATION PLAN' section.

## HANDOFF FORMAT (include when converged or on final iteration)
\`\`\`json
{
  "questionId": "${config.questionId}",
  "status": "answered|killed|narrowed|exhausted",
  "exhaustionReason": "data-gap|strategy-limit|infrastructure (only if status is exhausted)",
  "findings": [{"id": "F9XX", "claim": "...", "tag": "SOURCE", "source": "url", "confidence": 0.8, "domain": "..."}],
  "questionUpdates": [{"id": "QXXX", "status": "resolved", "resolvedBy": "F9XX"}],
  "newQuestions": [{"question": "...", "priority": "high", "domain": "...", "context": "..."}],
  "summary": "3-5 sentence summary",
  "iterationsRun": 1,
  "convergenceAchieved": true
}
\`\`\`
`;
  }

  // Subsequent iterations: leaner prompt with structured state
  const stateSection = priorState
    ? `## STATE FROM PRIOR ITERATION
- **Progress:** ${priorState.progressSummary}
- **Findings so far:** ${priorState.findingsSoFar.length > 0 ? priorState.findingsSoFar.join("; ") : "none yet"}
- **Searches completed:** ${priorState.searchesCompleted.length > 0 ? priorState.searchesCompleted.join("; ") : "none"}
- **Current hypothesis:** ${priorState.currentHypothesis || "none formed"}
- **Blockers:** ${priorState.blockers.length > 0 ? priorState.blockers.join("; ") : "none"}`
    : `## PRIOR ITERATION OUTPUT (truncated)\n${priorOutput}`;

  return `You are a research expert. Continue your investigation.

Your working directory is: ${config.projectDir}

## YOUR PERSONA (refer to full persona from iteration 1 — same question, same workflow)
Question: ${config.question}
Question ID: ${config.questionId}

## ITERATION ${innerIter} of ${config.maxIterations}
${isFinalIter ? "This is your FINAL iteration. You MUST produce a HANDOFF block regardless of convergence." : "Continue from where the prior iteration left off."}

${stateSection}

## CONVERGENCE CRITERIA
${config.convergenceCriteria}

## INSTRUCTIONS
1. Continue your persona's staged workflow from where the prior iteration stopped.
2. Use web search and web fetch to gather evidence. Tag every claim: [SOURCE: url], [DERIVED: method], [ESTIMATED: basis], [ASSUMED], [UNKNOWN].
3. Write new findings to knowledge/findings.jsonl (append, F9XX IDs).
4. Check convergence. ${isFinalIter ? "You MUST include a HANDOFF block — use 'exhausted' if not converged." : "Include HANDOFF if converged, otherwise end with NEXT ITERATION PLAN."}

## HANDOFF FORMAT
\`\`\`json
{
  "questionId": "${config.questionId}",
  "status": "answered|killed|narrowed|exhausted",
  "exhaustionReason": "data-gap|strategy-limit|infrastructure (only if status is exhausted)",
  "findings": [{"id": "F9XX", "claim": "...", "tag": "SOURCE", "source": "url", "confidence": 0.8, "domain": "..."}],
  "questionUpdates": [{"id": "QXXX", "status": "resolved", "resolvedBy": "F9XX"}],
  "newQuestions": [{"question": "...", "priority": "high", "domain": "...", "context": "..."}],
  "summary": "3-5 sentence summary",
  "iterationsRun": ${innerIter},
  "convergenceAchieved": true
}
\`\`\`
`;
}

/**
 * Parse the expert's output for convergence signal and handoff.
 * Uses multiple strategies like metrics.ts.
 */
function parseExpertOutput(
  output: string,
  questionId: string,
  innerIter: number
): { converged: boolean; handoff: ExpertHandoff | null } {
  // Strategy 1: JSON code block with handoff fields
  const jsonBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    const handoff = tryParseHandoff(jsonBlockMatch[1].trim(), questionId, innerIter);
    if (handoff) {
      const converged = handoff.status === "answered" || handoff.status === "killed";
      return { converged, handoff };
    }
  }

  // Strategy 2: Inline JSON with handoff fields
  const inlineMatch = output.match(/\{[^{}]*"questionId"\s*:[\s\S]*?"convergenceAchieved"\s*:[\s\S]*?\}/);
  if (inlineMatch) {
    const handoff = tryParseHandoff(inlineMatch[0], questionId, innerIter);
    if (handoff) {
      const converged = handoff.status === "answered" || handoff.status === "killed";
      return { converged, handoff };
    }
  }

  // Strategy 3: Look for ## HANDOFF section and parse fields
  const handoffSection = output.match(/## HANDOFF[\s\S]*?### Status\s*\n\s*(\w+)/i);
  if (handoffSection) {
    const status = handoffSection[1].trim().toLowerCase() as ExpertHandoff["status"];
    if (["answered", "killed", "narrowed", "exhausted"].includes(status)) {
      // Build a partial handoff from the section
      const handoff: ExpertHandoff = {
        questionId,
        status,
        findings: [],
        questionUpdates: [],
        newQuestions: [],
        summary: extractHandoffSummary(output),
        iterationsRun: innerIter,
        convergenceAchieved: status === "answered" || status === "killed",
      };
      const converged = status === "answered" || status === "killed";
      return { converged, handoff };
    }
  }

  return { converged: false, handoff: null };
}

function tryParseHandoff(
  raw: string,
  questionId: string,
  innerIter: number
): ExpertHandoff | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.status && typeof parsed.status === "string") {
      return {
        questionId: parsed.questionId ?? questionId,
        status: parsed.status,
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        questionUpdates: Array.isArray(parsed.questionUpdates) ? parsed.questionUpdates : [],
        newQuestions: Array.isArray(parsed.newQuestions) ? parsed.newQuestions : [],
        summary: parsed.summary ?? "",
        iterationsRun: parsed.iterationsRun ?? innerIter,
        convergenceAchieved: parsed.convergenceAchieved ?? false,
        exhaustionReason: parsed.exhaustionReason ?? undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function extractHandoffSummary(output: string): string {
  const summaryMatch = output.match(/### Summary\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim().slice(0, 500);
  }
  return "";
}

/**
 * Build a forced handoff when no parseable handoff was found.
 * Uses the best successful iteration's output, not the last (potentially crashed) output.
 */
function buildForcedHandoff(
  config: ExpertConfig,
  bestOutput: string,
  iterationsRun: number,
  allCrashed: boolean
): ExpertHandoff {
  const lines = bestOutput.split("\n").filter((l) => l.trim().length > 20);
  const summary = lines.slice(0, 3).join(" ").slice(0, 500) ||
    (allCrashed
      ? "All expert iterations crashed — infrastructure failure, not content exhaustion. Question remains open for re-dispatch."
      : "Expert completed without producing a structured handoff.");

  // Classify exhaustion reason
  let exhaustionReason: ExpertHandoff["exhaustionReason"];
  if (allCrashed) {
    exhaustionReason = "infrastructure";
  } else if (bestOutput.length < 500) {
    exhaustionReason = "infrastructure";
  } else if (/no\s+(data|published|study|measurement|result)|does not exist|not\s+found/i.test(bestOutput)) {
    exhaustionReason = "data-gap";
  } else {
    exhaustionReason = "strategy-limit";
  }

  return {
    questionId: config.questionId,
    status: allCrashed ? "crashed" : "exhausted",
    findings: [],
    questionUpdates: [],
    newQuestions: [],
    summary,
    iterationsRun,
    convergenceAchieved: false,
    exhaustionReason,
  };
}

// ── Iteration State Extraction ──

/**
 * Extract structured state from an expert iteration's output.
 * This replaces crude 3KB truncation with clean context for the next iteration.
 */
function extractIterationState(output: string): IterationState {
  const lines = output.split("\n");
  const state: IterationState = {
    findingsSoFar: [],
    searchesCompleted: [],
    currentHypothesis: "",
    blockers: [],
    progressSummary: "",
  };

  // Extract findings (lines with epistemic tags)
  for (const line of lines) {
    if (/\[(SOURCE|DERIVED|ESTIMATED)/.test(line) && line.trim().length > 30) {
      const clean = line.trim().replace(/^[-*]\s*/, "").slice(0, 150);
      if (state.findingsSoFar.length < 10) state.findingsSoFar.push(clean);
    }
  }

  // Extract searches completed (web_search patterns)
  const searchMatches = output.match(/(?:searching for|web_search|query)[:\s]+"([^"]+)"/gi);
  if (searchMatches) {
    state.searchesCompleted = searchMatches.slice(0, 10).map((m) =>
      m.replace(/^.*?["']/, "").replace(/["']$/, "").slice(0, 80)
    );
  }

  // Extract hypothesis/conclusion (look for verdict, conclusion, hypothesis lines)
  for (const line of lines) {
    if (/verdict|conclusion|hypothesis|bottom.line|key.find/i.test(line) && line.trim().length > 30) {
      state.currentHypothesis = line.trim().replace(/^[-*#>\d.]+\s*/, "").replace(/\*\*/g, "").slice(0, 200);
      break;
    }
  }

  // Extract blockers (no data, unknown, gap patterns)
  for (const line of lines) {
    if (/no\s+(data|published|study|measurement)|gap|blocker|\[UNKNOWN\]/i.test(line) && line.trim().length > 20) {
      const clean = line.trim().replace(/^[-*]\s*/, "").slice(0, 120);
      if (state.blockers.length < 5) state.blockers.push(clean);
    }
  }

  // Extract next iteration plan if present
  const nextPlanMatch = output.match(/NEXT ITERATION PLAN[\s\S]*$/i);
  if (nextPlanMatch) {
    state.progressSummary = nextPlanMatch[0].trim().split("\n").slice(0, 5).join(" ").slice(0, 300);
  } else {
    state.progressSummary = `${state.findingsSoFar.length} findings, ${state.searchesCompleted.length} searches completed`;
  }

  return state;
}

// ── Helpers ──

/**
 * Extract a one-line summary from the expert's raw output.
 * Looks for key finding patterns, conclusion lines, or the first substantive sentence.
 */
function extractBriefSummary(output: string): string {
  if (!output) return "";

  const lines = output.split("\n");

  // Strategy 1: Look for "key finding", "main result", "conclusion"
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

  // Strategy 2: Look for lines with epistemic tags (actual findings)
  const taggedLines = lines.filter((l) =>
    /\[(SOURCE|DERIVED|ESTIMATED)/.test(l) && l.trim().length > 30
  );
  if (taggedLines.length > 0) {
    const finding = taggedLines[0]
      .trim()
      .replace(/^[-*]\s*/, "")
      .slice(0, 120);
    return `${taggedLines.length} tagged findings. First: ${finding}`;
  }

  // Strategy 3: Count web searches as a progress indicator
  const searchCount = (output.match(/web_search|WebSearch|searching for/gi) || []).length;
  const fetchCount = (output.match(/web_fetch|WebFetch|fetching/gi) || []).length;
  if (searchCount > 0 || fetchCount > 0) {
    return `${searchCount} searches, ${fetchCount} fetches completed`;
  }

  return "";
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}
