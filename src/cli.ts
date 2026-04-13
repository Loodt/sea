#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discoverProject } from "./discovery.js";
import { runIteration, runLoop } from "./loop.js";
import { runConductorIteration, runConductorLoop } from "./conductor.js";
import { restoreVersion, getCurrentVersion } from "./versioner.js";
import { readScores } from "./metrics.js";
import type { ProjectState, LoopConfig, ConductorConfig, ConductorState, Provider } from "./types.js";
import { DEFAULT_LOOP_CONFIG, DEFAULT_CONDUCTOR_CONFIG, PROVIDERS, padVersion, conductorFile, detectProvider } from "./types.js";

const program = new Command();

program
  .name("sea")
  .description("SEA — Self-Evolving Agent")
  .version("0.1.0")
  .option("--provider <provider>", "LLM provider: claude or codex (auto-detected from harness if omitted)");

function resolveProvider(): Provider {
  const explicit = program.opts().provider;
  if (explicit) {
    if (!(explicit in PROVIDERS)) {
      console.error(`Unknown provider: "${explicit}". Valid: ${Object.keys(PROVIDERS).join(", ")}`);
      process.exit(1);
    }
    return explicit as Provider;
  }
  return detectProvider();
}

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
  .description("Run a single iteration (plan → research → synthesize → evaluate → evolve → summarize)")
  .option("--evaluate-model <model>", "Use a different model for evaluation (Axiom 1)")
  .action(async (project: string, opts) => {
    const config: LoopConfig = {
      ...DEFAULT_LOOP_CONFIG,
      provider: resolveProvider(),
      ...(opts.evaluateModel ? { evaluateModel: opts.evaluateModel } : {}),
    };
    await runIteration(project, config);
  });

// ── sea loop <project> ──
program
  .command("loop <project>")
  .description("Continuous pipeline loop (walk away)")
  .option("-c, --cooldown <seconds>", "Cooldown between iterations", "30")
  .option("-m, --max <iterations>", "Maximum iterations", "Infinity")
  .option("--meta-every <n>", "Run meta-evolution every N iterations", "5")
  .option("--evaluate-model <model>", "Use a different model for evaluation (Axiom 1)")
  .action(async (project: string, opts) => {
    const config: LoopConfig = {
      ...DEFAULT_LOOP_CONFIG,
      cooldownMs: parseFloat(opts.cooldown) * 1000,
      maxIterations: opts.max === "Infinity" ? Infinity : parseInt(opts.max, 10),
      metaEveryN: parseInt(opts.metaEvery, 10),
      provider: resolveProvider(),
      ...(opts.evaluateModel ? { evaluateModel: opts.evaluateModel } : {}),
    };
    await runLoop(project, config);
  });

// ── sea conduct <project> ──
program
  .command("conduct <project>")
  .description("Two-loop conductor: select question → create persona → dispatch expert → integrate")
  .option("-c, --cooldown <seconds>", "Cooldown between conductor iterations", "30")
  .option("-m, --max <iterations>", "Maximum conductor iterations", "Infinity")
  .option("-e, --expert-max <iterations>", "Maximum expert inner iterations", "5")
  .option("--meta-every <n>", "Run conductor meta every N iterations", "3")
  .option("--evaluate-model <model>", "Use a different model for evaluation (Axiom 1)")
  .action(async (project: string, opts) => {
    const config: ConductorConfig = {
      ...DEFAULT_CONDUCTOR_CONFIG,
      cooldownMs: parseFloat(opts.cooldown) * 1000,
      maxConductorIterations:
        opts.max === "Infinity" ? Infinity : parseInt(opts.max, 10),
      maxExpertIterations: parseInt(opts.expertMax, 10),
      metaEveryN: parseInt(opts.metaEvery, 10),
      provider: resolveProvider(),
      ...(opts.evaluateModel ? { evaluateModel: opts.evaluateModel } : {}),
    };
    await runConductorLoop(project, config);
  });

// ── sea dispatch <project> ──
program
  .command("dispatch <project>")
  .description("Run a single conductor iteration (select question, create expert, dispatch, integrate)")
  .option("-e, --expert-max <iterations>", "Maximum expert inner iterations", "5")
  .option("--evaluate-model <model>", "Use a different model for evaluation (Axiom 1)")
  .action(async (project: string, opts) => {
    const config: ConductorConfig = {
      ...DEFAULT_CONDUCTOR_CONFIG,
      maxExpertIterations: parseInt(opts.expertMax, 10),
      provider: resolveProvider(),
      ...(opts.evaluateModel ? { evaluateModel: opts.evaluateModel } : {}),
    };
    await runConductorIteration(project, config);
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

        const isConductor = (state as ConductorState).mode === "conductor";

        console.log(`\n📊 Project: ${state.name}`);
        console.log(`   Status: ${state.status}`);
        console.log(`   Mode: ${isConductor ? "conductor" : "pipeline"}`);
        if (isConductor) {
          const cState = state as ConductorState;
          console.log(`   Conductor iteration: ${cState.conductorIteration ?? "N/A"}`);
          console.log(`   Expert dispatches: ${cState.totalExpertDispatches ?? 0}`);
        } else {
          console.log(`   Iteration: ${state.iteration}`);
          console.log(`   Persona: ${padVersion(state.personaVersion)}`);
        }
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
    console.log("Iter  Persona  Acc  Cov  Coh  Ins  Proc  Overall");
    console.log("────  ───────  ───  ───  ───  ───  ────  ───────");

    for (const s of scores) {
      const proc = "processCompliance" in s ? String(s.processCompliance) : "-";
      console.log(
        `${String(s.iteration).padStart(4)}  ${padVersion(s.personaVersion).padStart(7)}  ${String(s.accuracy).padStart(3)}  ${String(s.coverage).padStart(3)}  ${String(s.coherence).padStart(3)}  ${String(s.insightQuality).padStart(3)}  ${String(proc).padStart(4)}  ${s.overall.toFixed(1).padStart(7)}`
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

      await restoreVersion(historyDir, version, path.join(process.cwd(), conductorFile(resolveProvider())));
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

program
  .command("wiki <project>")
  .description("Generate or update engineering wiki from project findings")
  .action(async (projectName: string) => {
    const projectDir = path.join(process.cwd(), "projects", projectName);
    const { updateWiki } = await import("./wiki.js");
    const result = await updateWiki(projectDir);
    console.log(
      `Wiki updated: ${result.written} written, ${result.skipped} unchanged, ${result.archived} archived${result.backfilled > 0 ? `, ${result.backfilled} backfilled` : ""}`
    );
    console.log(`See projects/${projectName}/wiki/index.md`);
  });

// ── sea global-wiki [project] ──
program
  .command("global-wiki [project]")
  .description("Promote verified findings from project(s) to the cross-project global wiki")
  .action(async (projectName?: string) => {
    const { updateGlobalWikiFromProject } = await import("./global-wiki.js");
    const projectsDir = path.join(process.cwd(), "projects");

    if (projectName) {
      const projectDir = path.join(projectsDir, projectName);
      const result = await updateGlobalWikiFromProject(projectDir, projectName);
      console.log(
        `Global wiki updated from ${projectName}: ${result.promoted} promoted, ${result.revoked} revoked, ${result.skipped} skipped`
      );
    } else {
      // Process all projects
      const { readdir } = await import("node:fs/promises");
      let projects: string[];
      try {
        projects = await readdir(projectsDir);
      } catch {
        console.log("No projects directory found.");
        return;
      }
      let totalPromoted = 0;
      let totalRevoked = 0;
      for (const p of projects) {
        try {
          const result = await updateGlobalWikiFromProject(
            path.join(projectsDir, p),
            p
          );
          if (result.promoted > 0 || result.revoked > 0) {
            console.log(
              `  ${p}: ${result.promoted} promoted, ${result.revoked} revoked, ${result.skipped} skipped`
            );
          }
          totalPromoted += result.promoted;
          totalRevoked += result.revoked;
        } catch {
          // Skip projects without findings
        }
      }
      console.log(
        `Global wiki: ${totalPromoted} promoted, ${totalRevoked} revoked across ${projects.length} projects`
      );
    }
    console.log("See global-wiki/");
  });

// ── sea global-experts [project] ──
program
  .command("global-experts [project]")
  .description("Promote high-scoring experts from project(s) to the cross-project global expert library")
  .action(async (projectName?: string) => {
    const { promoteExpertsToGlobal } = await import("./global-expert-library.js");
    const projectsDir = path.join(process.cwd(), "projects");

    if (projectName) {
      const projectDir = path.join(projectsDir, projectName);
      const result = await promoteExpertsToGlobal(projectDir, projectName);
      console.log(
        `Global expert library updated from ${projectName}: ${result.promoted} promoted, ${result.skipped} skipped`
      );
    } else {
      const { readdir } = await import("node:fs/promises");
      let projects: string[];
      try {
        projects = await readdir(projectsDir);
      } catch {
        console.log("No projects directory found.");
        return;
      }
      let totalPromoted = 0;
      for (const p of projects) {
        try {
          const result = await promoteExpertsToGlobal(
            path.join(projectsDir, p),
            p
          );
          if (result.promoted > 0) {
            console.log(`  ${p}: ${result.promoted} promoted, ${result.skipped} skipped`);
          }
          totalPromoted += result.promoted;
        } catch {
          // Skip projects without expert library
        }
      }
      console.log(
        `Global expert library: ${totalPromoted} promoted across ${projects.length} projects`
      );
    }
    console.log("See global-expert-library.jsonl");
  });

// ── sea audit <project> ──
program
  .command("audit <project>")
  .description("Run integrity audit on a project's knowledge store, wiki, and questions")
  .action(async (projectName: string) => {
    const { runAudit } = await import("./audit.js");
    const projectDir = path.join(process.cwd(), "projects", projectName);
    const result = await runAudit(projectDir);

    const issues: string[] = [];
    if (result.findingIntegrity.sourceWithoutUrl.length > 0)
      issues.push(`${result.findingIntegrity.sourceWithoutUrl.length} SOURCE findings without URL`);
    if (result.findingIntegrity.claimDuplicates.length > 0)
      issues.push(`${result.findingIntegrity.claimDuplicates.length} duplicate claim groups`);
    if (result.wikiIntegrity.missingFiles.length > 0)
      issues.push(`${result.wikiIntegrity.missingFiles.length} missing wiki files`);
    if (result.wikiIntegrity.orphanedFiles.length > 0)
      issues.push(`${result.wikiIntegrity.orphanedFiles.length} orphaned wiki files`);
    if (result.questionHealth.staleOpen.length > 0)
      issues.push(`${result.questionHealth.staleOpen.length} stale open questions`);

    if (issues.length > 0) {
      console.log(`Audit found ${issues.length} issue(s):`);
      for (const issue of issues) console.log(`  - ${issue}`);
    } else {
      console.log("Audit clean — no issues found.");
    }

    if (result.convergence.isConverging) {
      console.log(`Convergence: ${result.convergence.recommendation.toUpperCase()} (${result.convergence.signals.length} signals)`);
    }
    console.log(`Dispatch efficiency: ${result.dispatchEfficiency.avgFindings.toFixed(1)} findings/dispatch (${result.dispatchEfficiency.trend})`);
    console.log(`See projects/${projectName}/output/audit-report.md`);
  });

program.parse();
