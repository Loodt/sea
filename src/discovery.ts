import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ProjectState } from "./types.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Interactive discovery for a new project.
 * Asks questions, creates folder structure, writes goal.md + persona.md.
 */
export async function discoverProject(
  projectName: string,
  seaRoot: string
): Promise<void> {
  const projectDir = path.join(seaRoot, "projects", projectName);

  console.log(`\n🔬 SEA Discovery — Project: ${projectName}\n`);
  console.log("I need to understand your research goal before creating the expert persona.\n");

  // 1. Goal
  const goal = await ask("What is the goal or problem statement?\n> ");

  // 2. Clarifying questions
  const successCriteria = await ask("\nWhat does success look like? (measurable criteria)\n> ");
  const domain = await ask("\nWhat domain expertise is needed? (e.g., ML, biology, economics)\n> ");
  const sourcePref = await ask("\nPreferred source types? (papers, docs, web, all)\n> ");
  const outputFormat = await ask("\nDesired output format? (report, comparison, summary, analysis)\n> ");
  const additionalContext = await ask("\nAny additional context? (press Enter to skip)\n> ");

  rl.close();

  // Create directory structure
  const dirs = [
    "",
    "persona-history",
    "references",
    "references/pdfs",
    "references/notes",
    "experiments",
    "traces",
    "reflections",
    "metrics",
    "lineage",
    "output",
    "knowledge",
    "scratch",
    "experts",
    "expert-library",
    "wiki",
  ];

  for (const dir of dirs) {
    await mkdir(path.join(projectDir, dir), { recursive: true });
  }

  // Write goal.md
  const goalContent = `# Project Goal: ${projectName}

## Problem Statement
${goal}

## Success Criteria
${successCriteria}

## Domain
${domain}

## Source Preferences
${sourcePref || "all"}

## Output Format
${outputFormat || "structured report"}

${additionalContext ? `## Additional Context\n${additionalContext}` : ""}

## Created
${new Date().toISOString()}
`;

  await writeFile(path.join(projectDir, "goal.md"), goalContent, "utf-8");

  // Load failure patterns to seed persona warnings
  const failureWarnings = await loadFailureWarnings(seaRoot);

  // Write initial persona.md
  const personaContent = `# Expert Persona: ${projectName}

## Domain
${domain}

## Scope Boundaries
- Competent: ${domain}
- NOT competent: (will be discovered — flag out-of-scope questions as [OUT-OF-SCOPE])

## Goal
${goal}

## Research Methodology
- strategy-1: Comprehensive source gathering — search broadly, then filter for quality (confidence: 0.70, used: 0, avg score: N/A)
- strategy-2: Deep-read-first — read sources thoroughly before synthesizing (confidence: 0.70, used: 0, avg score: N/A)
- strategy-3: Multi-source triangulation — verify claims across 3+ independent sources (confidence: 0.65, used: 0, avg score: N/A)

## Heuristics
${failureWarnings || "(none yet — will be learned from execution)"}

## Source Evaluation
- Prefer ${sourcePref || "all source types"}
- Check publication dates — prefer recent sources unless historical context needed
- Cross-reference claims between sources

## Synthesis Approach
- Structure output as: ${outputFormat || "structured report"}
- Lead with key findings, then supporting evidence
- Tag every claim: [SOURCE], [DERIVED], [ESTIMATED], [ASSUMED], [UNKNOWN]
- Explicitly note contradictions between sources

## Output Format
${outputFormat || "Structured report with sections: Summary, Analysis, Evidence, Gaps, Conclusions"}
`;

  await writeFile(path.join(projectDir, "persona.md"), personaContent, "utf-8");

  // Write initial references/links.md
  await writeFile(
    path.join(projectDir, "references", "links.md"),
    `# References: ${projectName}\n\n(Sources will be added during execution)\n`,
    "utf-8"
  );

  // Write initial knowledge/summary.md
  await writeFile(
    path.join(projectDir, "knowledge", "summary.md"),
    `# Knowledge Summary: ${projectName}\n\n(No findings yet — updated after each iteration)\n`,
    "utf-8"
  );

  // Write initial pipeline.json
  await writeFile(
    path.join(projectDir, "pipeline.json"),
    JSON.stringify(
      {
        steps: [
          { id: "plan", type: "plan" },
          { id: "research", type: "research" },
          { id: "synthesize", type: "synthesize" },
          { id: "evaluate", type: "evaluate" },
          { id: "evolve", type: "evolve" },
          { id: "summarize", type: "summarize" },
        ],
      },
      null,
      2
    ),
    "utf-8"
  );

  // Write initial state.json
  const state: ProjectState = {
    name: projectName,
    iteration: 1,
    status: "active",
    personaVersion: 1,
    conductorVersionAtCreation: 1,
    currentTask: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scores: [],
  };

  await writeFile(
    path.join(projectDir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );

  console.log(`\n✅ Project "${projectName}" created at: ${projectDir}`);
  console.log(`   goal.md       — problem statement + criteria`);
  console.log(`   persona.md    — initial expert persona (v001)`);
  console.log(`   pipeline.json — 6-step pipeline config`);
  console.log(`   knowledge/    — structured findings store`);
  console.log(`   state.json    — iteration tracking`);
  if (failureWarnings) {
    console.log(`   ⚠ Seeded with known failure patterns from prior projects`);
  }
  console.log(`\nRun: sea loop ${projectName}`);
}

/**
 * Load failure patterns from the top-level failure-patterns/ directory
 * and convert them to compact persona warnings.
 */
async function loadFailureWarnings(seaRoot: string): Promise<string> {
  const dir = path.join(seaRoot, "failure-patterns");
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return "";

    const warnings: string[] = [];
    for (const file of mdFiles) {
      const content = await readFile(path.join(dir, file), "utf-8");
      // Extract description line (first paragraph after ## Description)
      const descMatch = content.match(/## Description\n+([\s\S]*?)(?=\n##|\n$)/);
      if (descMatch) {
        const desc = descMatch[1].trim().split("\n")[0];
        const name = file.replace(".md", "").replace(/-/g, " ");
        warnings.push(`- **${name}:** ${desc}`);
      }
    }
    return warnings.length > 0
      ? `(seeded from cross-project failure patterns)\n${warnings.join("\n")}`
      : "";
  } catch {
    return "";
  }
}
