import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readScores, isRegressing } from "./metrics.js";
import { restoreVersion } from "./versioner.js";
import type { ProjectState, LoopConfig } from "./types.js";

/**
 * Check for regression and auto-rollback if needed.
 * Returns true if rollback was triggered.
 */
export async function checkAndRollback(
  projectDir: string,
  config: LoopConfig
): Promise<boolean> {
  const scores = await readScores(projectDir);

  if (isRegressing(scores, config.regressionWindow, config.regressionThreshold)) {
    const state: ProjectState = JSON.parse(
      await readFile(path.join(projectDir, "state.json"), "utf-8")
    );

    const prevVersion = (state.personaVersion ?? 1) - 1;
    if (prevVersion < 1) return false;

    console.log(
      `⚠️  Regression detected! Rolling back persona from v${String(state.personaVersion).padStart(3, "0")} to v${String(prevVersion).padStart(3, "0")}`
    );

    await restoreVersion(
      path.join(projectDir, "persona-history"),
      prevVersion,
      path.join(projectDir, "persona.md")
    );

    state.personaVersion = prevVersion;
    state.updatedAt = new Date().toISOString();
    await writeFile(
      path.join(projectDir, "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8"
    );

    return true;
  }

  return false;
}

/**
 * Update project state after an iteration.
 */
export async function advanceIteration(
  projectDir: string,
  bumpPersonaVersion: boolean = false
): Promise<ProjectState> {
  const raw = await readFile(path.join(projectDir, "state.json"), "utf-8");
  const state: ProjectState = JSON.parse(raw);

  state.iteration += 1;
  if (bumpPersonaVersion) {
    state.personaVersion = (state.personaVersion ?? 1) + 1;
  }
  state.updatedAt = new Date().toISOString();

  await writeFile(
    path.join(projectDir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );

  return state;
}
