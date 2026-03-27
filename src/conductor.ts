import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createExpert } from "./expert-factory.js";
import { runExpertLoop } from "./expert-loop.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import { readFindings, readQuestions } from "./knowledge.js";
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
} from "./types.js";
import { DEFAULT_CONDUCTOR_CONFIG } from "./types.js";

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

  console.log(`\n━━━ Conductor Iteration ${cIter} ━━━\n`);

  // Step 1: Select question
  console.log("📋 SELECT — choosing highest-value question...");
  const selection = await selectQuestion(projectDir, cIter, state.questionsExhausted);
  console.log(`   ✓ Selected: ${selection.questionId} — ${truncateLine(selection.question, 60)}`);
  console.log(`   Expert type: ${selection.suggestedExpertType}`);

  // Step 2: Create expert
  console.log("\n🧬 CREATE — building expert persona...");
  const expertConfig = await createExpert(selection, projectDir, cIter, config.maxExpertIterations);

  // Step 3: Run expert loop
  console.log(`\n🔬 DISPATCH — expert running (max ${config.maxExpertIterations} iterations)...`);
  const handoff = await runExpertLoop(expertConfig);

  // Step 4: Integrate handoff
  console.log("\n📥 INTEGRATE — merging results into knowledge store...");
  await integrateHandoff(projectDir, handoff, cIter);

  // Print story
  await printConductorStory(projectDir, cIter, selection, handoff);

  // Advance state
  await advanceConductorState(projectDir, handoff);

  // Log metric
  await appendConductorMetric(projectDir, {
    conductorIteration: cIter,
    questionId: selection.questionId,
    expertStatus: handoff.status,
    findingsAdded: handoff.findings.length,
    questionsResolved: handoff.questionUpdates.length,
    newQuestionsCreated: handoff.newQuestions.length,
    innerIterationsRun: handoff.iterationsRun,
    timestamp: new Date().toISOString(),
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
        `conductor-${String(state.conductorIteration - 1).padStart(3, "0")}-meta`
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
        return {
          questionId: parsed.questionId,
          question: parsed.question,
          reasoning: parsed.reasoning ?? "",
          relevantFindingIds: Array.isArray(parsed.relevantFindingIds)
            ? parsed.relevantFindingIds
            : [],
          suggestedExpertType: parsed.suggestedExpertType ?? "general researcher",
          estimatedIterations: parsed.estimatedIterations ?? 3,
        };
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
        return {
          questionId: parsed.questionId,
          question: parsed.question,
          reasoning: parsed.reasoning ?? "",
          relevantFindingIds: Array.isArray(parsed.relevantFindingIds)
            ? parsed.relevantFindingIds
            : [],
          suggestedExpertType: parsed.suggestedExpertType ?? "general researcher",
          estimatedIterations: parsed.estimatedIterations ?? 3,
        };
      }
    } catch {
      // fall through
    }
  }

  return null;
}

// ── Handoff Integration ──

async function integrateHandoff(
  projectDir: string,
  handoff: ExpertHandoff,
  conductorIteration: number
): Promise<void> {
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
  } else {
    console.log("   ✓ Knowledge store updated");
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

  const statusIcon: Record<string, string> = {
    answered: "✅",
    killed: "💀",
    narrowed: "🔍",
    exhausted: "⏳",
  };

  console.log(`\n${BAR.repeat(width)}`);
  console.log(`  Conductor Iteration ${conductorIteration} Complete`);
  console.log(BAR.repeat(width));

  console.log(`\n  Question:   ${truncateLine(selection.question, width - 14)}`);
  console.log(`  Expert:     ${selection.suggestedExpertType}`);
  console.log(`  Result:     ${statusIcon[handoff.status] || "?"} ${handoff.status} (${handoff.iterationsRun} inner iterations)`);

  if (handoff.summary) {
    console.log(`\n  Summary:    ${wrapIndent(handoff.summary, 14, width - 4)}`);
  }

  const parts: string[] = [];
  parts.push(`Findings: ${findings.length}`);
  if (handoff.findings.length > 0) parts.push(`New: +${handoff.findings.length}`);
  if (openQs.length > 0) parts.push(`Open Qs: ${openQs.length}`);
  if (handoff.newQuestions.length > 0) parts.push(`New Qs: +${handoff.newQuestions.length}`);
  console.log(`\n  ${parts.join("  |  ")}`);

  console.log(BAR.repeat(width));
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
