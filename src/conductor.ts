import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { atomicAppendJsonl } from "./file-lock.js";
import path from "node:path";
import { runHybridResearch } from "./hybrid-agent.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import { readFindings, readQuestions, graduateFindings, enforceSummarySize, deduplicateFindings, aggregateReferences } from "./knowledge.js";
import {
  assembleQuestionSelectionPrompt,
  assembleConductorMetaPrompt,
} from "./conductor-context.js";
import { appendSpan } from "./metrics.js";
import type {
  ConductorState,
  ConductorConfig,
  QuestionSelection,
  ExpertHandoff,
  HybridResult,
  ConductorMetric,
  QuestionType,
} from "./types.js";
import { existsSync } from "node:fs";
import { DEFAULT_CONDUCTOR_CONFIG, conductorFile, conductorFileCandidates } from "./types.js";

import type { Provider } from "./types.js";

const SEA_ROOT = process.cwd();

/** Resolve the conductor playbook path, falling back across providers. */
function resolveConductorPath(provider?: Provider): string {
  for (const name of conductorFileCandidates(provider)) {
    const p = path.join(SEA_ROOT, name);
    if (existsSync(p)) return p;
  }
  return path.join(SEA_ROOT, conductorFile(provider));
}

let stopping = false;

export function requestConductorStop(): void {
  stopping = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single conductor iteration (v035 hybrid architecture):
 * 1. Select question (conductor LLM call — strategic exploration)
 * 2. Hybrid research (single LLM call — research + write to knowledge store)
 *
 * Based on EXP-013: conductor for exploration breadth, unified agent for per-call efficiency.
 */
export async function runConductorIteration(
  projectName: string,
  config: ConductorConfig = DEFAULT_CONDUCTOR_CONFIG
): Promise<{ conductorIteration: number; handoff: ExpertHandoff }> {
  const projectDir = path.join(SEA_ROOT, "projects", projectName);
  const state = await readConductorState(projectDir);
  const cIter = state.conductorIteration;
  const cIterStr = String(cIter).padStart(3, "0");

  // Clean stale entries from questionsExhausted
  if (state.questionsExhausted.length > 0) {
    const allQuestions = await readQuestions(projectDir);
    const resolvedIds = new Set(allQuestions.filter((q) => q.status === "resolved").map((q) => q.id));
    const stale = state.questionsExhausted.filter((id) => resolvedIds.has(id));
    if (stale.length > 0) {
      state.questionsExhausted = state.questionsExhausted.filter((id) => !resolvedIds.has(id));
      await writeFile(path.join(projectDir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
      console.log(`   ℹ Cleaned ${stale.length} stale exhausted entries: ${stale.join(", ")}`);
    }
  }

  console.log(`\n━━━ Conductor Iteration ${cIter} ━━━\n`);

  const dispatchStart = Date.now();
  const dispatchStartTime = new Date().toISOString();

  // ═══ CALL 1: Question Selection (unchanged — conductor's strategic value) ═══
  console.log("📋 SELECT — choosing highest-value question...");
  const selectStart = Date.now();
  const selection = await selectQuestion(projectDir, cIter, state.questionsExhausted, config);
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-select`,
    step: "select-question",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(selectStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - selectStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: 0, findingsProduced: 0,
  });
  console.log(`   ✓ Selected: ${selection.questionId} — ${truncateLine(selection.question, 60)}`);
  console.log(`   Type: ${selection.questionType} | ${selection.suggestedExpertType}`);

  // ═══ CALL 2: Hybrid Research (replaces persona creation + expert loop + integration) ═══
  console.log(`\n🔬 RESEARCH — unified agent (select + research + write in one call)...`);
  let result = await runHybridResearch(projectDir, selection, cIter, config);

  // One retry on crash with zero findings
  if (result.status === "crashed" && result.measuredFindingsDelta === 0) {
    console.log(`\n🔄 RETRY — crashed with no findings, retrying...`);
    result = await runHybridResearch(projectDir, selection, cIter, config);
    if (result.status === "crashed") {
      console.log(`   ⚠ Retry also crashed — accepting crash result`);
    } else {
      console.log(`   ✓ Retry succeeded: ${result.status}`);
    }
  }

  console.log(`   → ${result.questionId}: ${result.status} | +${result.measuredFindingsDelta} findings, +${result.measuredQuestionsDelta} questions`);

  // ═══ POST-PROCESSING (bookkeeping, not reasoning — runs outside LLM calls) ═══

  await incrementExpertDispatches(projectDir);

  if (result.status !== "crashed" || result.measuredFindingsDelta > 0) {
    await enforceSummarySize(projectDir);

    const deduped = await deduplicateFindings(projectDir);
    if (deduped > 0) console.log(`   ✓ Deduplicated ${deduped} findings`);

    await aggregateReferences(projectDir);

    // Wiki update (non-fatal)
    try {
      const { updateWiki } = await import("./wiki.js");
      const wikiResult = await updateWiki(projectDir);
      if (wikiResult.written > 0 || wikiResult.archived > 0 || wikiResult.backfilled > 0) {
        console.log(`   ✓ Wiki: ${wikiResult.written} written, ${wikiResult.skipped} unchanged, ${wikiResult.archived} archived${wikiResult.backfilled > 0 ? `, ${wikiResult.backfilled} backfilled` : ""}`);
      }
    } catch (err) {
      console.log(`   ⚠ Wiki update failed: ${(err as Error).message}`);
    }

    // Global wiki (non-fatal)
    try {
      const { updateGlobalWikiFromProject } = await import("./global-wiki.js");
      const globalResult = await updateGlobalWikiFromProject(projectDir, projectName);
      if (globalResult.promoted > 0 || globalResult.revoked > 0) {
        console.log(`   ✓ Global wiki: ${globalResult.promoted} promoted, ${globalResult.revoked} revoked`);
      }
    } catch { /* non-fatal */ }
  }

  // Parent span
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}`,
    step: "conductor-iteration",
    startTime: dispatchStartTime,
    endTime: new Date().toISOString(),
    durationMs: Date.now() - dispatchStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: result.status === "crashed" ? 1 : 0,
    findingsProduced: result.measuredFindingsDelta,
    metadata: { questionId: selection.questionId, status: result.status },
  });

  // Auto-graduate
  const graduated = await graduateFindings(projectDir, cIter);
  if (graduated > 0) console.log(`   ✓ Auto-graduated ${graduated} findings to verified`);

  // Build ExpertHandoff for backward compatibility (state advancement, metrics, story)
  const handoff: ExpertHandoff = {
    questionId: result.questionId,
    status: result.status,
    findings: [],
    questionUpdates: result.questionsResolvedByAgent.map((id) => ({ id, status: "resolved" as const })),
    newQuestions: [],
    summary: result.summary,
    iterationsRun: 1,
    convergenceAchieved: result.status === "answered" || result.status === "killed",
    exhaustionReason: result.exhaustionReason as ExpertHandoff["exhaustionReason"],
  };

  // Print story
  await printConductorStory(projectDir, cIter, selection, handoff);

  // Advance state
  await advanceConductorState(projectDir, handoff);

  // Log metric
  await appendConductorMetric(projectDir, {
    conductorIteration: cIter,
    questionId: selection.questionId,
    expertStatus: result.status,
    findingsAdded: result.measuredFindingsDelta,
    questionsResolved: result.questionsResolvedByAgent.length,
    newQuestionsCreated: result.measuredQuestionsDelta,
    innerIterationsRun: 1,
    timestamp: new Date().toISOString(),
    ...(result.exhaustionReason ? { exhaustionReason: result.exhaustionReason as ConductorMetric["exhaustionReason"] } : {}),
    questionType: selection.questionType,
  });

  return { conductorIteration: cIter, handoff };
}

/**
 * Continuous conductor loop.
 */
export async function runConductorLoop(
  projectName: string,
  config: ConductorConfig = DEFAULT_CONDUCTOR_CONFIG
): Promise<void> {
  console.log(`\n🎼 SEA Conductor v035 — Project: ${projectName}`);
  console.log(`   Architecture: Conductor (select) → Hybrid Research (research + write)`);
  console.log(`   LLM calls per iteration: 2 (was 4+)`);
  console.log(`   Meta every: ${config.metaEveryN} conductor iterations`);
  console.log(`   Cooldown: ${config.cooldownMs / 1000}s`);
  console.log(`   Press Ctrl+C to stop gracefully\n`);

  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stop requested. Finishing current dispatch...");
    requestConductorStop();
  });

  let totalIterations = 0;

  while (!stopping && totalIterations < config.maxConductorIterations) {
    // Completion gate: stop if no open questions remain
    {
      const projDir = path.join(SEA_ROOT, "projects", projectName);
      const allQ = await readQuestions(projDir);
      const openQuestions = allQ.filter(
        (q) => q.status === "open"
      );
      if (openQuestions.length === 0 && allQ.length > 0) {
        const cState = await readConductorState(projDir);
        cState.status = "completed";
        cState.updatedAt = new Date().toISOString();
        await writeFile(
          path.join(projDir, "state.json"),
          JSON.stringify(cState, null, 2),
          "utf-8"
        );
        console.log(
          `\n✅ Completion gate — all questions resolved. Project status set to "completed".`
        );
        break;
      }
    }

    const result = await runConductorIteration(projectName, config);
    totalIterations++;

    // Meta-evolution check
    const state = await readConductorState(
      path.join(SEA_ROOT, "projects", projectName)
    );

    if (state.conductorIteration % config.metaEveryN === 0) {
      console.log("\n🧠 META — evolving conductor...");
      await snapshotFile(
        resolveConductorPath(config.provider),
        path.join(SEA_ROOT, "conductor-history")
      );
      const metaPrompt = await assembleConductorMetaPrompt(
        path.join(SEA_ROOT, "projects", projectName),
        state.conductorIteration,
        config.provider
      );
      await runAndTrace(
        metaPrompt,
        SEA_ROOT,
        path.join(SEA_ROOT, "projects", projectName, "traces"),
        `conductor-${String(state.conductorIteration).padStart(3, "0")}-meta`,
        config.provider ? { provider: config.provider } : undefined
      );
      console.log("   ✓ Conductor updated");
    }

    // Convergence check (advisory — never auto-stops)
    try {
      const { readConductorMetrics, detectConvergenceSignals } = await import("./metrics.js");
      const { readFindings: readF, readQuestions: readQ } = await import("./knowledge.js");
      const projDir = path.join(SEA_ROOT, "projects", projectName);
      const [cMetrics, cFindings, cQuestions] = await Promise.all([
        readConductorMetrics(projDir),
        readF(projDir),
        readQ(projDir),
      ]);
      const convergence = detectConvergenceSignals(cFindings, cQuestions, cMetrics);
      if (convergence.isConverging) {
        console.log(`\n⚡ Convergence signals (${convergence.recommendation.toUpperCase()}):`);
        for (const signal of convergence.signals) {
          console.log(`   - ${signal}`);
        }
        if (convergence.recommendation === "stop") {
          // Write convergence report
          const reportDir = path.join(projDir, "output");
          await mkdir(reportDir, { recursive: true });
          const report = [
            "# Convergence Report",
            "",
            `*Generated: ${new Date().toISOString()}*`,
            `*Conductor iteration: ${state.conductorIteration}*`,
            "",
            "## Signals",
            "",
            ...convergence.signals.map((s) => `- ${s}`),
            "",
            `## Recommendation: ${convergence.recommendation.toUpperCase()}`,
            "",
            "The knowledge frontier appears exhausted. Review wiki/index.md and output/ before continuing.",
            "",
          ].join("\n");
          await writeFile(path.join(reportDir, "convergence-report.md"), report, "utf-8");
          console.log(`   → Report written to output/convergence-report.md`);
        }
      }
    } catch (err) {
      // Convergence check is advisory — never block the loop
    }

    if (!stopping && totalIterations < config.maxConductorIterations) {
      console.log(`\n⏱  Cooling down ${config.cooldownMs / 1000}s...`);
      await sleep(config.cooldownMs);
    }
  }

  console.log(`\n🏁 Conductor loop complete. Ran ${totalIterations} iterations.`);
}

// ── Question Selection ──

async function selectQuestion(
  projectDir: string,
  conductorIteration: number,
  exhaustedQuestionIds: string[],
  config?: ConductorConfig
): Promise<QuestionSelection> {
  const prompt = await assembleQuestionSelectionPrompt(
    projectDir,
    conductorIteration,
    exhaustedQuestionIds
  );

  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${String(conductorIteration).padStart(3, "0")}-select`,
    config?.provider ? { provider: config.provider } : undefined
  );

  // Parse QuestionSelection from output
  const selection = parseQuestionSelection(result.stdout);

  if (!selection) {
    throw new Error(
      "Failed to parse question selection from conductor output. Check the trace file."
    );
  }

  return selection;
}

function parseQuestionSelection(output: string): QuestionSelection | null {
  // Strategy 1: JSON code block
  const jsonBlockMatch = output.match(/```json\s*\n([\s\S]*?)\n\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed.questionId && parsed.question) {
        return buildSelection(parsed);
      }
    } catch {
      // fall through
    }
  }

  // Strategy 2: Inline JSON
  const inlineMatch = output.match(/\{[^{}]*"questionId"\s*:[\s\S]*?"question"\s*:[\s\S]*?\}/);
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[0]);
      if (parsed.questionId && parsed.question) {
        return buildSelection(parsed);
      }
    } catch {
      // fall through
    }
  }

  return null;
}

const VALID_QUESTION_TYPES = ["landscape", "kill-check", "data-hunt", "mechanism", "synthesis", "first-principles", "design-space"] as const;

function buildSelection(parsed: Record<string, unknown>): QuestionSelection {
  const qt = typeof parsed.questionType === "string" &&
    VALID_QUESTION_TYPES.includes(parsed.questionType as QuestionType)
    ? (parsed.questionType as QuestionType)
    : "mechanism"; // safe default — standard budget, no special handling
  return {
    questionId: parsed.questionId as string,
    question: parsed.question as string,
    reasoning: (parsed.reasoning as string) ?? "",
    relevantFindingIds: Array.isArray(parsed.relevantFindingIds)
      ? (parsed.relevantFindingIds as string[])
      : [],
    suggestedExpertType: (parsed.suggestedExpertType as string) ?? "general researcher",
    estimatedIterations: (parsed.estimatedIterations as number) ?? 3,
    questionType: qt,
  };
}

// ── State Management ──

async function readConductorState(projectDir: string): Promise<ConductorState> {
  const raw = await readFile(path.join(projectDir, "state.json"), "utf-8");
  const state = JSON.parse(raw);

  // Handle legacy state.json that doesn't have conductor fields
  return {
    ...state,
    mode: state.mode ?? "conductor",
    conductorIteration: state.conductorIteration ?? 1,
    totalExpertDispatches: state.totalExpertDispatches ?? 0,
    activeQuestionId: state.activeQuestionId ?? null,
    questionsExhausted: state.questionsExhausted ?? [],
  };
}

/**
 * Increment totalExpertDispatches immediately after expert dispatch.
 * Separated from advanceConductorState so it survives integration crashes.
 */
async function incrementExpertDispatches(projectDir: string): Promise<void> {
  const state = await readConductorState(projectDir);
  state.totalExpertDispatches += 1;
  state.updatedAt = new Date().toISOString();
  await writeFile(
    path.join(projectDir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

async function advanceConductorState(
  projectDir: string,
  handoff: ExpertHandoff
): Promise<ConductorState> {
  const state = await readConductorState(projectDir);

  state.conductorIteration += 1;
  // totalExpertDispatches already incremented by incrementExpertDispatches()
  state.activeQuestionId = null;
  state.updatedAt = new Date().toISOString();

  if (handoff.status === "exhausted") {
    if (!state.questionsExhausted.includes(handoff.questionId)) {
      state.questionsExhausted.push(handoff.questionId);
    }
  }
  // "crashed" status: question stays open for re-dispatch — do NOT add to exhausted list

  await writeFile(
    path.join(projectDir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );

  return state;
}

// ── Conductor Metrics ──

async function appendConductorMetric(
  projectDir: string,
  metric: ConductorMetric
): Promise<void> {
  const metricsDir = path.join(projectDir, "metrics");
  await mkdir(metricsDir, { recursive: true });
  const filePath = path.join(metricsDir, "conductor-metrics.jsonl");

  // Deduplication: skip if this conductorIteration already logged
  try {
    const existing = await readFile(filePath, "utf-8");
    const alreadyLogged = existing.trim().split("\n").filter(Boolean).some((line) => {
      try { return JSON.parse(line).conductorIteration === metric.conductorIteration; } catch { return false; }
    });
    if (alreadyLogged) {
      console.log(`   ℹ Metric for conductor iteration ${metric.conductorIteration} already exists — skipping`);
      return;
    }
  } catch {
    // File doesn't exist yet — proceed to append
  }
  await atomicAppendJsonl(filePath, metric);
}

// ── Conductor Story ──

async function printConductorStory(
  projectDir: string,
  conductorIteration: number,
  selection: QuestionSelection,
  handoff: ExpertHandoff
): Promise<void> {
  const BAR = "━";
  const width = 64;

  const findings = await readFindings(projectDir);
  const questions = await readQuestions(projectDir);
  const openQs = questions.filter((q) => q.status === "open");
  const resolvedQs = questions.filter((q) => q.status === "resolved");
  const verifiedFindings = findings.filter((f) => f.status === "verified");

  const statusIcon: Record<string, string> = {
    answered: "✅",
    killed: "💀",
    narrowed: "🔍",
    exhausted: "⏳",
    crashed: "💥",
  };

  console.log(`\n${BAR.repeat(width)}`);
  console.log(`  Conductor Iteration ${conductorIteration} Complete`);
  console.log(BAR.repeat(width));

  console.log(`\n  Question:   ${truncateLine(selection.question, width - 14)}`);
  console.log(`  Expert:     ${selection.suggestedExpertType}`);
  console.log(`  Result:     ${statusIcon[handoff.status] || "?"} ${handoff.status} (${handoff.iterationsRun} inner iterations)${handoff.exhaustionReason ? ` [${handoff.exhaustionReason}]` : ""}`);

  if (handoff.summary) {
    console.log(`\n  Summary:    ${wrapIndent(handoff.summary, 14, width - 4)}`);
  }

  // Per-iteration stats
  const parts: string[] = [];
  parts.push(`Findings: ${findings.length}`);
  if (handoff.findings.length > 0) parts.push(`New: +${handoff.findings.length}`);
  if (openQs.length > 0) parts.push(`Open Qs: ${openQs.length}`);
  if (handoff.newQuestions.length > 0) parts.push(`New Qs: +${handoff.newQuestions.length}`);
  console.log(`\n  ${parts.join("  |  ")}`);

  console.log(BAR.repeat(width));

  // Cumulative dashboard (every 3 iterations)
  if (conductorIteration % 3 === 0 || conductorIteration === 1) {
    await printCumulativeDashboard(projectDir, findings, questions, conductorIteration);
  }
}

async function printCumulativeDashboard(
  projectDir: string,
  findings: import("./types.js").Finding[],
  questions: import("./types.js").Question[],
  conductorIteration: number
): Promise<void> {
  const verified = findings.filter((f) => f.status === "verified").length;
  const provisional = findings.filter((f) => f.status === "provisional").length;
  const openQs = questions.filter((q) => q.status === "open");
  const resolvedQs = questions.filter((q) => q.status === "resolved");

  // Read goal for success criteria checking
  const goal = await safeReadFile(path.join(projectDir, "goal.md"));
  const summary = await safeReadFile(path.join(projectDir, "knowledge", "summary.md"));

  // Read metrics for efficiency stats
  const metricsPath = path.join(projectDir, "metrics", "conductor-metrics.jsonl");
  let avgFindingsPerDispatch = 0;
  let convergenceRate = 0;
  try {
    const raw = await readFile(metricsPath, "utf-8");
    const entries = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const totalFindings = entries.reduce((sum: number, e: { findingsAdded?: number }) => sum + (e.findingsAdded ?? 0), 0);
    avgFindingsPerDispatch = entries.length > 0 ? totalFindings / entries.length : 0;
    const converged = entries.filter((e: { expertStatus?: string }) => e.expertStatus === "answered" || e.expertStatus === "killed").length;
    convergenceRate = entries.length > 0 ? (converged / entries.length) * 100 : 0;
  } catch { /* no metrics yet */ }

  console.log(`\n  ┌${"─".repeat(60)}┐`);
  console.log(`  │ CUMULATIVE STATUS — Iteration ${conductorIteration}${" ".repeat(Math.max(0, 36 - String(conductorIteration).length))}│`);
  console.log(`  ├${"─".repeat(60)}┤`);
  console.log(`  │ Findings: ${String(findings.length).padEnd(6)} (${verified} verified, ${provisional} provisional)${" ".repeat(Math.max(0, 22 - String(findings.length).length - String(verified).length - String(provisional).length))}│`);
  console.log(`  │ Questions: ${String(resolvedQs.length).padEnd(3)}/${questions.length} resolved, ${openQs.length} open${" ".repeat(Math.max(0, 30 - String(resolvedQs.length).length - String(questions.length).length - String(openQs.length).length))}│`);
  console.log(`  │ Efficiency: ${convergenceRate.toFixed(0)}% convergence, ${avgFindingsPerDispatch.toFixed(1)} findings/dispatch${" ".repeat(Math.max(0, 23 - convergenceRate.toFixed(0).length - avgFindingsPerDispatch.toFixed(1).length))}│`);
  console.log(`  └${"─".repeat(60)}┘`);
}

async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ── Helpers ──

function truncateLine(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

function wrapIndent(text: string, indent: number, maxWidth: number): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth - indent && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);

  return lines.join("\n" + " ".repeat(indent));
}
