import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runAndTrace } from "./runner.js";
import { readSummary, readFindings, readQuestions } from "./knowledge.js";
import type { ExpertConfig, ExpertHandoff, Finding, Question } from "./types.js";

/**
 * Run the expert inner loop: iterate on a single question until convergence.
 * Each inner iteration is a single claude -p session that plans, researches, and synthesizes.
 * The persona encodes the workflow stages internally.
 */
export async function runExpertLoop(config: ExpertConfig): Promise<ExpertHandoff> {
  await mkdir(config.expertDir, { recursive: true });

  let priorOutput = "";
  let lastHandoff: ExpertHandoff | null = null;

  for (let innerIter = 1; innerIter <= config.maxIterations; innerIter++) {
    const iterStr = String(innerIter).padStart(2, "0");
    console.log(`      Inner iteration ${innerIter}/${config.maxIterations}...`);

    // Assemble and run
    const prompt = await assembleExpertPrompt(config, innerIter, priorOutput);
    const result = await runAndTrace(
      prompt,
      config.projectDir,
      config.expertDir,
      `expert-iter-${iterStr}`
    );

    if (result.exitCode !== 0) {
      console.log(`      ⚠ Expert iteration ${innerIter} exited with code ${result.exitCode}`);
    }

    // Save the raw output
    await writeFile(
      path.join(config.expertDir, `output-iter-${iterStr}.md`),
      result.stdout,
      "utf-8"
    );

    // Check for convergence / handoff
    const parsed = parseExpertOutput(result.stdout, config.questionId, innerIter);

    if (parsed.handoff) {
      lastHandoff = parsed.handoff;

      if (parsed.converged) {
        console.log(`      ✓ Expert converged: ${parsed.handoff.status}`);
        return parsed.handoff;
      }
    }

    // Carry forward a truncated version for next iteration's context
    priorOutput = truncate(result.stdout, 3000);
  }

  // Max iterations reached — build forced handoff from last output
  if (lastHandoff) {
    lastHandoff.status = "exhausted";
    lastHandoff.iterationsRun = config.maxIterations;
    lastHandoff.convergenceAchieved = false;
    console.log(`      ⚠ Expert exhausted after ${config.maxIterations} iterations`);
    return lastHandoff;
  }

  // No handoff parsed at all — build a minimal one
  console.log(`      ⚠ Expert produced no parseable handoff`);
  return buildForcedHandoff(config, priorOutput, config.maxIterations);
}

/**
 * Assemble the expert's iteration prompt.
 * Includes: persona, question, relevant findings, prior output, convergence instructions.
 */
async function assembleExpertPrompt(
  config: ExpertConfig,
  innerIter: number,
  priorOutput: string
): Promise<string> {
  // Read current knowledge state (compact)
  const summary = await readSummary(config.projectDir);

  // Build the relevant findings context
  const findingsContext = config.relevantFindings.length > 0
    ? config.relevantFindings
        .map((f) => `- ${f.id}: [${f.tag}] ${f.claim} (${f.status}, confidence: ${f.confidence})`)
        .join("\n")
    : "(No relevant findings provided)";

  const priorSection = priorOutput
    ? `## Prior Iteration Output (truncated)\n${priorOutput}`
    : "(First iteration — no prior output)";

  const isFirstIter = innerIter === 1;
  const isFinalIter = innerIter === config.maxIterations;

  return `You are a research expert. Follow your persona instructions precisely.

Your working directory is: ${config.projectDir}

## YOUR PERSONA
${config.persona}

## YOUR QUESTION
${config.question}
Question ID: ${config.questionId}

## ITERATION ${innerIter} of ${config.maxIterations}
${isFirstIter ? "This is your FIRST iteration. Start with Stage 1 of your workflow (fast-kill check)." : ""}
${isFinalIter ? "This is your FINAL iteration. You MUST produce a HANDOFF block regardless of convergence." : ""}

## CURRENT KNOWLEDGE SUMMARY
${summary || "(No prior knowledge in the store)"}

## RELEVANT FINDINGS
${findingsContext}

${priorSection}

## CONVERGENCE CRITERIA
${config.convergenceCriteria}

## INSTRUCTIONS
1. Follow your persona's staged workflow. ${isFirstIter ? "Begin with the fast-kill check." : "Continue from where the prior iteration left off."}
2. Use web search and web fetch to gather evidence. Tag every claim with its epistemic basis.
3. After synthesizing, CHECK your key findings:
   - Does each finding have a source URL or derivation method?
   - Could any finding be wrong? What would that mean?
   - Are there contradictions with existing knowledge?
4. Write findings incrementally to knowledge/findings.jsonl (append, don't overwrite):
   Each line: {"id": "F{NNN}", "claim": "...", "tag": "SOURCE|DERIVED|ESTIMATED|ASSUMED|UNKNOWN", "source": "url or null", "confidence": 0.0-1.0, "domain": "...", "iteration": ${innerIter}, "status": "provisional", "verifiedAt": null, "supersededBy": null}
   Use IDs starting from F901 to avoid collision with existing findings (the conductor will reassign IDs).
5. Update knowledge/questions.jsonl if any open questions are resolved by your findings.
6. Check convergence against your criteria. If you can determine a status (answered/killed/narrowed), include the HANDOFF block.
7. ${isFinalIter ? "You MUST include a HANDOFF block — use status 'exhausted' if you haven't converged." : "If not converged and more iterations remain, end with a brief 'NEXT ITERATION PLAN' section."}

## HANDOFF FORMAT (include when converged or on final iteration)
\`\`\`json
{
  "questionId": "${config.questionId}",
  "status": "answered|killed|narrowed|exhausted",
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
 */
function buildForcedHandoff(
  config: ExpertConfig,
  lastOutput: string,
  iterationsRun: number
): ExpertHandoff {
  // Try to extract a summary from the last output
  const lines = lastOutput.split("\n").filter((l) => l.trim().length > 20);
  const summary = lines.slice(0, 3).join(" ").slice(0, 500) || "Expert completed without producing a structured handoff.";

  return {
    questionId: config.questionId,
    status: "exhausted",
    findings: [],
    questionUpdates: [],
    newQuestions: [],
    summary,
    iterationsRun,
    convergenceAchieved: false,
  };
}

// ── Helpers ──

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}
