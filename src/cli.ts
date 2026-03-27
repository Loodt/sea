#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverProject } from "./discovery.js";
import { runIteration, runLoop } from "./loop.js";
import { restoreVersion, getCurrentVersion } from "./versioner.js";
import { readScores } from "./metrics.js";
import type { ProjectState, LoopConfig } from "./types.js";
import { DEFAULT_LOOP_CONFIG, padVersion } from "./types.js";

const program = new Command();

program
  .name("sea")
  .description("SEA — Self-Evolving Agent")
  .version("0.1.0");

// ── sea new <project> ──
program
  .command("new <project>")
  .description("Create a new research project (interactive discovery)")
  .action(async (project: string) => {
    await discoverProject(project, process.cwd());
  });

// ── sea run <project> ──
program
  .command("run <project>")
  .description("Run a single iteration (execute → reflect → evolve)")
  .action(async (project: string) => {
    await runIteration(project);
  });

// ── sea loop <project> ──
program
  .command("loop <project>")
  .description("Continuous evolution loop (walk away)")
  .option("-c, --cooldown <seconds>", "Cooldown between iterations", "30")
  .option("-m, --max <iterations>", "Maximum iterations", "Infinity")
  .option("--meta-every <n>", "Run meta-evolution every N iterations", "5")
  .action(async (project: string, opts) => {
    const config: LoopConfig = {
      ...DEFAULT_LOOP_CONFIG,
      cooldownMs: parseFloat(opts.cooldown) * 1000,
      maxIterations: opts.max === "Infinity" ? Infinity : parseInt(opts.max, 10),
      metaEveryN: parseInt(opts.metaEvery, 10),
    };
    await runLoop(project, config);
  });

// ── sea status [project] ──
program
  .command("status [project]")
  .description("Show current state")
  .action(async (project?: string) => {
    if (project) {
      const projectDir = path.join(process.cwd(), "projects", project);
      try {
        const state: ProjectState = JSON.parse(
          await readFile(path.join(projectDir, "state.json"), "utf-8")
        );
        const scores = await readScores(projectDir);
        const lastScore = scores.length > 0 ? scores[scores.length - 1] : null;

        console.log(`\n📊 Project: ${state.name}`);
        console.log(`   Status: ${state.status}`);
        console.log(`   Iteration: ${state.iteration}`);
        console.log(`   Persona: ${padVersion(state.personaVersion)}`);
        console.log(`   Last score: ${lastScore ? lastScore.overall.toFixed(1) : "N/A"}`);
        console.log(`   Total scores: ${scores.length}`);
        if (scores.length > 1) {
          const trend = scores.slice(-5).map((s) => s.overall.toFixed(1));
          console.log(`   Recent trend: ${trend.join(" → ")}`);
        }
        console.log(`   Updated: ${state.updatedAt}`);
      } catch {
        console.error(`Project "${project}" not found.`);
      }
    } else {
      // List all projects
      const { readdir } = await import("node:fs/promises");
      try {
        const projects = await readdir(path.join(process.cwd(), "projects"));
        if (projects.length === 0) {
          console.log("\nNo projects. Run: sea new <name>");
        } else {
          console.log("\n📁 Projects:");
          for (const p of projects) {
            try {
              const state: ProjectState = JSON.parse(
                await readFile(
                  path.join(process.cwd(), "projects", p, "state.json"),
                  "utf-8"
                )
              );
              console.log(
                `   ${p} — iter ${state.iteration}, persona ${padVersion(state.personaVersion)}, ${state.status}`
              );
            } catch {
              console.log(`   ${p} — (no state)`);
            }
          }
        }
      } catch {
        console.log("\nNo projects directory. Run: sea new <name>");
      }
    }
  });

// ── sea history <project> ──
program
  .command("history <project>")
  .description("Show evolution timeline with scores")
  .action(async (project: string) => {
    const projectDir = path.join(process.cwd(), "projects", project);
    const scores = await readScores(projectDir);

    if (scores.length === 0) {
      console.log("\nNo scores yet.");
      return;
    }

    console.log(`\n📈 Evolution History: ${project}\n`);
    console.log("Iter  Persona  Accuracy  Coverage  Coherence  Insight  Overall");
    console.log("────  ───────  ────────  ────────  ─────────  ───────  ───────");

    for (const s of scores) {
      console.log(
        `${String(s.iteration).padStart(4)}  ${padVersion(s.personaVersion).padStart(7)}  ${String(s.accuracy).padStart(8)}  ${String(s.coverage).padStart(8)}  ${String(s.coherence).padStart(9)}  ${String(s.insightQuality).padStart(7)}  ${s.overall.toFixed(1).padStart(7)}`
      );
    }
  });

// ── sea rollback <project> [version] ──
program
  .command("rollback <target> [version]")
  .description("Rollback persona or conductor to a previous version")
  .action(async (target: string, versionStr?: string) => {
    if (target === "conductor") {
      const historyDir = path.join(process.cwd(), "conductor-history");
      const current = await getCurrentVersion(historyDir);
      const version = versionStr ? parseInt(versionStr, 10) : current;

      await restoreVersion(historyDir, version, path.join(process.cwd(), "CLAUDE.md"));
      console.log(`✅ Conductor rolled back to ${padVersion(version)}`);
    } else {
      // Treat target as project name
      const projectDir = path.join(process.cwd(), "projects", target);
      const historyDir = path.join(projectDir, "persona-history");
      const current = await getCurrentVersion(historyDir);
      const version = versionStr ? parseInt(versionStr, 10) : current;

      await restoreVersion(historyDir, version, path.join(projectDir, "persona.md"));

      // Update state
      const state: ProjectState = JSON.parse(
        await readFile(path.join(projectDir, "state.json"), "utf-8")
      );
      state.personaVersion = version;
      state.updatedAt = new Date().toISOString();
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(
          path.join(projectDir, "state.json"),
          JSON.stringify(state, null, 2),
          "utf-8"
        )
      );

      console.log(`✅ Project "${target}" persona rolled back to ${padVersion(version)}`);
    }
  });

program.parse();
