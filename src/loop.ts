import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assemblePrompt } from "./context.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import { parseScoresFromReflection, appendScore } from "./metrics.js";
import { checkAndRollback, advanceIteration } from "./safety.js";
import type { ProjectState, LoopConfig } from "./types.js";
import { DEFAULT_LOOP_CONFIG } from "./types.js";

const SEA_ROOT = process.cwd();

let stopping = false;

export function requestStop(): void {
  stopping = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single iteration: EXECUTE → REFLECT → EVOLVE
 */
export async function runIteration(
  projectName: string,
  config: LoopConfig = DEFAULT_LOOP_CONFIG
): Promise<{ iteration: number; score: number | null }> {
  const projectDir = path.join(SEA_ROOT, "projects", projectName);
  const raw = await readFile(path.join(projectDir, "state.json"), "utf-8");
  const state: ProjectState = JSON.parse(raw);
  const iter = state.iteration;
  const iterStr = String(iter).padStart(3, "0");

  console.log(`\n━━━ Iteration ${iter} (persona v${String(state.personaVersion).padStart(3, "0")}) ━━━\n`);

  // ── EXECUTE ──
  console.log("📝 EXECUTE — researching...");
  const executePrompt = await assemblePrompt("execute", projectName);
  await runAndTrace(
    executePrompt,
    projectDir,
    path.join(projectDir, "traces"),
    `iter-${iterStr}-execute`
  );
  console.log("   ✓ Trace + experiment log written");

  // ── REFLECT ──
  console.log("🔍 REFLECT — scoring...");
  const reflectPrompt = await assemblePrompt("reflect", projectName);
  const reflectResult = await runAndTrace(
    reflectPrompt,
    projectDir,
    path.join(projectDir, "traces"),
    `iter-${iterStr}-reflect`
  );

  // Parse scores from the reflection output
  let score: number | null = null;
  const scores = parseScoresFromReflection(
    reflectResult.stdout,
    iter,
    state.personaVersion
  );
  if (scores) {
    await appendScore(projectDir, scores);
    score = scores.overall;
    console.log(
      `   ✓ Scores — accuracy: ${scores.accuracy} | coverage: ${scores.coverage} | coherence: ${scores.coherence} | insight: ${scores.insightQuality} | overall: ${scores.overall.toFixed(1)}`
    );
  } else {
    console.log("   ⚠ Could not parse scores from reflection");
  }

  // ── EVOLVE ──
  console.log("🧬 EVOLVE — improving persona...");

  // Snapshot persona before mutation
  await snapshotFile(
    path.join(projectDir, "persona.md"),
    path.join(projectDir, "persona-history")
  );

  const evolvePrompt = await assemblePrompt("evolve", projectName);
  await runAndTrace(
    evolvePrompt,
    projectDir,
    path.join(projectDir, "traces"),
    `iter-${iterStr}-evolve`
  );

  // Advance state
  const newState = await advanceIteration(projectDir, true);
  console.log(`   ✓ Persona → v${String(newState.personaVersion).padStart(3, "0")}`);

  // Check for regression
  const rolledBack = await checkAndRollback(projectDir, config);
  if (rolledBack) {
    console.log("   ↩ Rolled back to previous persona version");
  }

  return { iteration: iter, score };
}

/**
 * Continuous loop: EXECUTE → REFLECT → EVOLVE → repeat.
 * META step runs every N iterations.
 */
export async function runLoop(
  projectName: string,
  config: LoopConfig = DEFAULT_LOOP_CONFIG
): Promise<void> {
  console.log(`\n🌊 SEA Loop — Project: ${projectName}`);
  console.log(`   Cooldown: ${config.cooldownMs / 1000}s | Meta every: ${config.metaEveryN} iters`);
  console.log(`   Press Ctrl+C to stop gracefully\n`);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stop requested. Finishing current iteration...");
    requestStop();
  });

  let totalIterations = 0;

  while (!stopping && totalIterations < config.maxIterations) {
    const result = await runIteration(projectName, config);
    totalIterations++;

    // Read current state for meta check
    const projectDir = path.join(SEA_ROOT, "projects", projectName);
    const state: ProjectState = JSON.parse(
      await readFile(path.join(projectDir, "state.json"), "utf-8")
    );

    // ── META (every N iterations) ──
    if (state.iteration % config.metaEveryN === 0) {
      console.log("\n🧠 META — evolving conductor...");

      await snapshotFile(
        path.join(SEA_ROOT, "CLAUDE.md"),
        path.join(SEA_ROOT, "conductor-history")
      );

      const metaPrompt = await assemblePrompt("meta", projectName);
      await runAndTrace(
        metaPrompt,
        SEA_ROOT,
        path.join(projectDir, "traces"),
        `iter-${String(state.iteration - 1).padStart(3, "0")}-meta`
      );
      console.log("   ✓ Conductor updated");
    }

    if (!stopping && totalIterations < config.maxIterations) {
      console.log(`\n⏱  Cooling down ${config.cooldownMs / 1000}s...`);
      await sleep(config.cooldownMs);
    }
  }

  console.log(`\n🏁 Loop complete. Ran ${totalIterations} iterations.`);
}
