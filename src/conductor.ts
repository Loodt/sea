import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createExpert } from "./expert-factory.js";
import { runExpertLoop } from "./expert-loop.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import { readFindings, readQuestions, graduateFindings } from "./knowledge.js";
import {
  assembleQuestionSelectionPrompt,
  assembleHandoffIntegrationPrompt,
  assembleConductorMetaPrompt,
} from "./conductor-context.js";
import type {
  ConductorState,
  ConductorConfig,
  QuestionSelection,
  ExpertHandoff,
  ConductorMetric,
  QuestionType,
} from "./types.js";
import { DEFAULT_CONDUCTOR_CONFIG, QUESTION_TYPE_ITERATION_CAP } from "./types.js";

const SEA_ROOT = process.cwd();

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

  // Step 1: Select question
  console.log("📋 SELECT — choosing highest-value question...");
  const selection = await selectQuestion(projectDir, cIter, state.questionsExhausted);
  console.log(`   ✓ Selected: ${selection.questionId} — ${truncateLine(selection.question, 60)}`);
  console.log(`   Expert type: ${selection.suggestedExpertType}`);

  // Step 2: Create expert (cap iterations by question type)
  const typeCap = QUESTION_TYPE_ITERATION_CAP[selection.questionType] ?? config.maxExpertIterations;
  const effectiveMaxIter = Math.min(config.maxExpertIterations, typeCap);
  console.log("\n🧬 CREATE — building expert persona...");
  if (effectiveMaxIter < config.maxExpertIterations) {
    console.log(`   Question type "${selection.questionType}" → capped at ${effectiveMaxIter} iterations`);
  }
  const expertConfig = await createExpert(selection, projectDir, cIter, effectiveMaxIter);

  // Step 3: Run expert loop
  console.log(`\n🔬 DISPATCH — expert running (max ${effectiveMaxIter} iterations)...`);
  const handoff = await runExpertLoop(expertConfig);

  // Step 4: Integrate handoff (skip for zero-finding crashes)
  let delta = { findingsAdded: 0, questionsAdded: 0 };
  if (handoff.status === "crashed" && handoff.findings.length === 0) {
    console.log("\n📥 INTEGRATE — skipped (crash with no findings)");
  } else {
    console.log("\n📥 INTEGRATE — merging results into knowledge store...");
    delta = await integrateHandoff(projectDir, handoff, cIter);
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
        path.join(SEA_ROOT, "CLAUDE.md"),
        path.join(SEA_ROOT, "conductor-history")
      );
      const metaPrompt = await assembleConductorMetaPrompt(
        path.join(SEA_ROOT, "projects", projectName),
        state.conductorIteration
      );
      await runAndTrace(
        metaPrompt,
        SEA_ROOT,
        path.join(SEA_ROOT, "projects", projectName, "traces"),
        `conductor-${String(state.conductorIteration).padStart(3, "0")}-meta`
      );
      console.log("   ✓ Conductor updated");
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
  exhaustedQuestionIds: string[]
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
    `conductor-${String(conductorIteration).padStart(3, "0")}-select`
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
  conductorIteration: number
): Promise<{ findingsAdded: number; questionsAdded: number }> {
  // Snapshot knowledge store counts before integration
  const findingsBefore = await readFindings(projectDir);
  const questionsBefore = await readQuestions(projectDir);

  const prompt = await assembleHandoffIntegrationPrompt(projectDir, handoff);
  const iterStr = String(conductorIteration).padStart(3, "0");

  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${iterStr}-integrate`
  );

  if (result.exitCode !== 0) {
    console.log(`   ⚠ Integration exited with code ${result.exitCode}`);
  }

  // Post-integration validation: verify knowledge store was actually updated
  const findingsAfter = await readFindings(projectDir);
  const questionsAfter = await readQuestions(projectDir);
  const newFindings = findingsAfter.length - findingsBefore.length;
  const newQuestions = questionsAfter.length - questionsBefore.length;

  if (newFindings > 0 || newQuestions > 0) {
    console.log(`   ✓ Knowledge store updated (+${newFindings} findings, +${newQuestions} questions)`);
  } else if (handoff.findings.length > 0) {
    console.log(`   ⚠ Integration ran but knowledge store unchanged (expected +${handoff.findings.length} findings)`);
    console.log(`     Handoff contained findings but none persisted — check integration trace`);
  } else {
    console.log(`   ✓ Integration complete (no new findings in handoff)`);
  }

  return { findingsAdded: newFindings, questionsAdded: newQuestions };
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

async function advanceConductorState(
  projectDir: string,
  handoff: ExpertHandoff
): Promise<ConductorState> {
  const state = await readConductorState(projectDir);

  state.conductorIteration += 1;
  state.totalExpertDispatches += 1;
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

  try {
    const existing = await readFile(filePath, "utf-8");
    // Deduplication: skip if this conductorIteration already logged
    const lines = existing.trim().split("\n").filter((l) => l.trim());
    const alreadyLogged = lines.some((line) => {
      try {
        const entry = JSON.parse(line);
        return entry.conductorIteration === metric.conductorIteration;
      } catch {
        return false;
      }
    });
    if (alreadyLogged) {
      console.log(`   ℹ Metric for conductor iteration ${metric.conductorIteration} already exists — skipping`);
      return;
    }
    await writeFile(filePath, existing + JSON.stringify(metric) + "\n", "utf-8");
  } catch {
    await writeFile(filePath, JSON.stringify(metric) + "\n", "utf-8");
  }
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
