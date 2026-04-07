import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { atomicAppendJsonl } from "./file-lock.js";
import path from "node:path";
import { createExpert } from "./expert-factory.js";
import { runExpertLoop } from "./expert-loop.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import { readFindings, readQuestions, graduateFindings, enforceSummarySize, deduplicateFindings, aggregateReferences } from "./knowledge.js";
import {
  assembleQuestionSelectionPrompt,
  assembleHandoffIntegrationPrompt,
  assembleConductorMetaPrompt,
} from "./conductor-context.js";
import { appendSpan } from "./metrics.js";
import { hashPersona, upsertLibraryEntry } from "./expert-library.js";
import type {
  ConductorState,
  ConductorConfig,
  QuestionSelection,
  ExpertConfig,
  ExpertHandoff,
  ConductorMetric,
  QuestionType,
  Span,
} from "./types.js";
import { existsSync } from "node:fs";
import { DEFAULT_CONDUCTOR_CONFIG, QUESTION_TYPE_ITERATION_CAP, conductorFile, conductorFileCandidates } from "./types.js";

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
 * Run a single conductor iteration:
 * 1. Select question
 * 2. Create expert
 * 3. Run expert loop
 * 4. Integrate handoff
 */
export async function runConductorIteration(
  projectName: string,
  config: ConductorConfig = DEFAULT_CONDUCTOR_CONFIG
): Promise<{ conductorIteration: number; handoff: ExpertHandoff }> {
  const projectDir = path.join(SEA_ROOT, "projects", projectName);
  const state = await readConductorState(projectDir);
  const cIter = state.conductorIteration;
  const cIterStr = String(cIter).padStart(3, "0");

  // Clean stale entries from questionsExhausted (questions resolved since exhaustion)
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

  // Step 1: Select question
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
  console.log(`   Expert type: ${selection.suggestedExpertType}`);

  // Step 2: Create expert (cap iterations by question type)
  const typeCap = QUESTION_TYPE_ITERATION_CAP[selection.questionType] ?? config.maxExpertIterations;
  const effectiveMaxIter = Math.min(config.maxExpertIterations, typeCap);
  console.log("\n🧬 CREATE — building expert persona...");
  if (effectiveMaxIter < config.maxExpertIterations) {
    console.log(`   Question type "${selection.questionType}" → capped at ${effectiveMaxIter} iterations`);
  }
  const createStart = Date.now();
  const expertConfig = await createExpert(selection, projectDir, cIter, effectiveMaxIter, config.provider);
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-create`,
    step: "create-expert",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(createStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - createStart,
    promptChars: 0, outputChars: expertConfig.persona.length, promptTokensEst: 0,
    outputTokensEst: Math.ceil(expertConfig.persona.length / 4),
    exitCode: 0, findingsProduced: 0,
  });

  // Snapshot knowledge store BEFORE expert loop (experts may write directly to findings.jsonl)
  const findingsBeforeDispatch = (await readFindings(projectDir)).length;
  const questionsBeforeDispatch = (await readQuestions(projectDir)).length;

  // Step 3: Run expert loop (with one retry on zero-finding crash)
  console.log(`\n🔬 DISPATCH — expert running (max ${effectiveMaxIter} iterations)...`);
  const expertStart = Date.now();
  let handoff = await runExpertLoop(expertConfig);

  if (handoff.status === "crashed" && handoff.findings.length === 0) {
    console.log(`\n🔄 RETRY — expert crashed with no findings, retrying with fresh persona...`);
    const retryConfig = await createExpert(selection, projectDir, cIter, effectiveMaxIter, config.provider);
    await writeFile(
      path.join(retryConfig.expertDir, "persona.md"),
      retryConfig.persona,
      "utf-8"
    );
    handoff = await runExpertLoop(retryConfig);
    if (handoff.status === "crashed") {
      console.log(`   ⚠ Retry also crashed — accepting crash result`);
    } else {
      console.log(`   ✓ Retry succeeded: ${handoff.status}`);
    }
  }

  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-dispatch`,
    step: "dispatch-expert",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(expertStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - expertStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: handoff.status === "crashed" ? 1 : 0,
    findingsProduced: handoff.findings.length,
    metadata: { status: handoff.status, iterationsRun: handoff.iterationsRun },
  });

  // Increment expert dispatch count immediately (survives integration crashes)
  await incrementExpertDispatches(projectDir);

  // Step 4: Integrate handoff (skip for zero-finding crashes)
  const integrateStart = Date.now();
  if (handoff.status === "crashed" && handoff.findings.length === 0) {
    console.log("\n📥 INTEGRATE — skipped (crash with no findings)");
  } else {
    console.log("\n📥 INTEGRATE — merging results into knowledge store...");
    await integrateHandoff(projectDir, handoff, cIter, config);
    await enforceSummarySize(projectDir);

    // Deduplicate findings (expert writes directly + integration may re-append)
    const deduped = await deduplicateFindings(projectDir);
    if (deduped > 0) {
      console.log(`   ✓ Deduplicated ${deduped} findings from knowledge store`);
    }

    // Aggregate source URLs into references/links.md
    await aggregateReferences(projectDir);

    // Update wiki output (non-fatal — wiki is derived, not source of truth)
    try {
      const { updateWiki } = await import("./wiki.js");
      const wikiResult = await updateWiki(projectDir);
      if (wikiResult.written > 0 || wikiResult.archived > 0 || wikiResult.backfilled > 0) {
        console.log(`   ✓ Wiki: ${wikiResult.written} written, ${wikiResult.skipped} unchanged, ${wikiResult.archived} archived${wikiResult.backfilled > 0 ? `, ${wikiResult.backfilled} backfilled` : ""}`);
      }
    } catch (err) {
      console.log(`   ⚠ Wiki update failed: ${(err as Error).message}`);
    }

    // Update global wiki (non-fatal — derived from project knowledge store)
    try {
      const { updateGlobalWikiFromProject } = await import("./global-wiki.js");
      const globalResult = await updateGlobalWikiFromProject(projectDir, projectName);
      if (globalResult.promoted > 0 || globalResult.revoked > 0) {
        console.log(`   ✓ Global wiki: ${globalResult.promoted} promoted, ${globalResult.revoked} revoked, ${globalResult.skipped} skipped`);
      }
    } catch (err) {
      console.log(`   ⚠ Global wiki update failed: ${(err as Error).message}`);
    }
  }

  // Compute dispatch-level delta (captures findings written by expert + integration)
  const findingsAfterDispatch = (await readFindings(projectDir)).length;
  const questionsAfterDispatch = (await readQuestions(projectDir)).length;
  const fileDelta = findingsAfterDispatch - findingsBeforeDispatch;
  const handoffDelta = handoff.findings?.length || 0;
  const delta = {
    findingsAdded: Math.max(fileDelta, handoffDelta),
    questionsAdded: questionsAfterDispatch - questionsBeforeDispatch,
  };
  if (fileDelta === 0 && handoffDelta > 0) {
    console.log(`   ℹ File delta was 0 but handoff reports ${handoffDelta} findings (expert wrote directly)`);
  }
  if (delta.findingsAdded > 0 || delta.questionsAdded > 0) {
    console.log(`   ✓ Dispatch delta: +${delta.findingsAdded} findings, +${delta.questionsAdded} questions`);
  }
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-integrate`,
    step: "integrate-handoff",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(integrateStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - integrateStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: 0, findingsProduced: delta.findingsAdded,
  });

  // Parent span for entire conductor iteration
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}`,
    step: "conductor-iteration",
    startTime: dispatchStartTime,
    endTime: new Date().toISOString(),
    durationMs: Date.now() - dispatchStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: handoff.status === "crashed" ? 1 : 0,
    findingsProduced: delta.findingsAdded,
    metadata: { questionId: selection.questionId, status: handoff.status },
  });

  // Update expert library with dispatch results
  // Landscape dispatches produce questions, not findings — count both as IG
  const effectiveIG = selection.questionType === "landscape"
    ? delta.findingsAdded + delta.questionsAdded
    : delta.findingsAdded;
  const pHash = hashPersona(expertConfig.persona);
  const personaRelPath = path.relative(projectDir, path.join(expertConfig.expertDir, "persona.md"));
  await upsertLibraryEntry(
    projectDir,
    pHash,
    selection.questionType,
    selection.question.slice(0, 100),
    selection.suggestedExpertType,
    effectiveIG,
    personaRelPath,
    expertConfig.adaptedFromHash
  );

  // Record success pattern for high-IG dispatches (type-aware thresholds)
  const SUCCESS_PATTERN_THRESHOLD = 5;
  const LANDSCAPE_QUESTION_THRESHOLD = 3;
  const isSuccessfulDispatch =
    handoff.status === "answered" && delta.findingsAdded >= SUCCESS_PATTERN_THRESHOLD;
  const isSuccessfulLandscape =
    selection.questionType === "landscape" &&
    (handoff.status === "answered" || handoff.status === "narrowed") &&
    delta.questionsAdded >= LANDSCAPE_QUESTION_THRESHOLD;
  if (isSuccessfulDispatch || isSuccessfulLandscape) {
    await recordSuccessPattern(selection, expertConfig, handoff, delta, cIter);
  }

  // Auto-graduate provisional findings
  const graduated = await graduateFindings(projectDir, cIter);
  if (graduated > 0) {
    console.log(`   ✓ Auto-graduated ${graduated} provisional findings to verified`);
  }

  // Print story
  await printConductorStory(projectDir, cIter, selection, handoff);

  // Advance state
  await advanceConductorState(projectDir, handoff);

  // Log metric
  await appendConductorMetric(projectDir, {
    conductorIteration: cIter,
    questionId: selection.questionId,
    expertStatus: handoff.status,
    findingsAdded: delta.findingsAdded,
    questionsResolved: handoff.questionUpdates.length,
    newQuestionsCreated: delta.questionsAdded,
    innerIterationsRun: handoff.iterationsRun,
    timestamp: new Date().toISOString(),
    ...(handoff.exhaustionReason ? { exhaustionReason: handoff.exhaustionReason } : {}),
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
  console.log(`\n🎼 SEA Conductor — Project: ${projectName}`);
  console.log(`   Max expert iterations: ${config.maxExpertIterations}`);
  console.log(`   Meta every: ${config.metaEveryN} conductor iterations`);
  console.log(`   Cooldown: ${config.cooldownMs / 1000}s`);
  console.log(`   Architecture: Conductor (outer) → Expert (inner)`);
  console.log(`   Press Ctrl+C to stop gracefully\n`);

  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stop requested. Finishing current dispatch...");
    requestConductorStop();
  });

  let totalIterations = 0;

  while (!stopping && totalIterations < config.maxConductorIterations) {
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

const VALID_QUESTION_TYPES = ["landscape", "kill-check", "data-hunt", "mechanism", "synthesis"] as const;

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

// ── Handoff Integration ──

async function integrateHandoff(
  projectDir: string,
  handoff: ExpertHandoff,
  conductorIteration: number,
  config?: ConductorConfig
): Promise<void> {
  const prompt = await assembleHandoffIntegrationPrompt(projectDir, handoff);
  const iterStr = String(conductorIteration).padStart(3, "0");

  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${iterStr}-integrate`,
    config?.provider ? { provider: config.provider } : undefined
  );

  if (result.exitCode !== 0) {
    console.log(`   ⚠ Integration exited with code ${result.exitCode}`);
  } else {
    console.log(`   ✓ Integration complete`);
  }
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

// ── Success Patterns ──

async function recordSuccessPattern(
  selection: QuestionSelection,
  expertConfig: ExpertConfig,
  handoff: ExpertHandoff,
  delta: { findingsAdded: number; questionsAdded: number },
  conductorIteration: number
): Promise<void> {
  const patternDir = path.join(SEA_ROOT, "success-patterns");
  await mkdir(patternDir, { recursive: true });

  const slug = selection.suggestedExpertType.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const fileName = `${selection.questionType}-${slug}-d${String(conductorIteration).padStart(2, "0")}.md`;

  const content = [
    `# Success Pattern: ${selection.questionType} — ${selection.suggestedExpertType}`,
    ``,
    `## Strategy`,
    `Expert type "${selection.suggestedExpertType}" for ${selection.questionType} question.`,
    `Question: ${selection.question}`,
    ``,
    `## When It Works`,
    `- Question type: ${selection.questionType}`,
    `- Converged in ${handoff.iterationsRun}/${expertConfig.maxIterations} iterations`,
    ``,
    `## Evidence`,
    `- Dispatch: D${conductorIteration}`,
    `- Question: ${selection.questionId}`,
    `- Findings produced: ${delta.findingsAdded}`,
    `- Iterations: ${handoff.iterationsRun}/${expertConfig.maxIterations}`,
    `- Status: ${handoff.status}`,
    ``,
    `## Key Decisions`,
    handoff.summary || "(no summary)",
  ].join("\n");

  await writeFile(path.join(patternDir, fileName), content, "utf-8");
  console.log(`   ✓ Success pattern recorded: ${fileName}`);
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
