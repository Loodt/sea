import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { StepType, ProjectState, Score } from "./types.js";

const SEA_ROOT = process.cwd();

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const content = await safeRead(filePath);
  if (!content.trim()) return [];
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as T);
}

function extractSection(md: string, heading: string): string {
  const lines = md.split("\n");
  let capturing = false;
  const captured: string[] = [];

  for (const line of lines) {
    if (line.match(new RegExp(`^##\\s+${heading}\\b`))) {
      capturing = true;
      continue;
    }
    if (capturing && /^##\s/.test(line)) {
      break;
    }
    if (capturing) {
      captured.push(line);
    }
  }

  return captured.join("\n").trim();
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.slice(-n);
}

export async function assemblePrompt(
  step: StepType,
  projectName: string
): Promise<string> {
  const projectDir = path.join(SEA_ROOT, "projects", projectName);
  const conductor = await safeRead(path.join(SEA_ROOT, "CLAUDE.md"));
  const persona = await safeRead(path.join(projectDir, "persona.md"));
  const goal = await safeRead(path.join(projectDir, "goal.md"));
  const state: ProjectState = JSON.parse(
    await safeRead(path.join(projectDir, "state.json")) || "{}"
  );

  switch (step) {
    case "execute":
      return assembleExecute(conductor, persona, goal, state, projectDir);
    case "reflect":
      return assembleReflect(conductor, persona, state, projectDir);
    case "evolve":
      return assembleEvolve(conductor, persona, state, projectDir);
    case "meta":
      return assembleMeta(conductor);
    default:
      throw new Error(`Unknown step: ${step}`);
  }
}

async function assembleExecute(
  conductor: string,
  persona: string,
  goal: string,
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const executionProtocol = extractSection(conductor, "Execution Protocol");
  const iter = state.iteration ?? 1;

  // Load relevant skills
  const skills = await loadRelevantSkills();

  // Last reflection summary (brief context)
  const lastReflection = await safeRead(
    path.join(projectDir, "reflections", `iter-${String(iter - 1).padStart(3, "0")}.md`)
  );
  const reflectionBrief = lastReflection
    ? lastReflection.slice(0, 1000) + (lastReflection.length > 1000 ? "\n...(truncated)" : "")
    : "";

  return `You are a research & synthesis expert executing a task. Follow the protocols below precisely.

Your working directory is: ${projectDir}

## Execution Protocol
${executionProtocol}

## Your Expert Persona
${persona}

## Project Goal
${goal}

## Current Iteration: ${iter}

## Task
${state.currentTask ?? "Continue researching the project goal. Build on previous work and deepen the analysis."}

${skills ? `## Relevant Skills\n${skills}` : ""}

${reflectionBrief ? `## Last Reflection Summary\n${reflectionBrief}` : ""}

## Instructions
1. Research the task using web search and web fetch tools
2. Save ALL source URLs to references/links.md (append, don't overwrite)
3. Write your synthesis to output/
4. Write a detailed experiment log to experiments/exp-${String(iter).padStart(3, "0")}.md following this format:
   - Hypothesis: what you expected
   - Method: what you did
   - References Used: each source with what you extracted
   - Result: output summary and self-assessed quality
   - Analysis: what worked (WHY), what didn't (WHY), key insight
5. Be thorough. Explain your reasoning. If you can't explain HOW you found something, it doesn't count.
`;
}

async function assembleReflect(
  conductor: string,
  persona: string,
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const reflectionProtocol = extractSection(conductor, "Reflection Protocol");
  const iter = state.iteration ?? 1;
  const iterStr = String(iter).padStart(3, "0");

  const trace = await safeRead(
    path.join(projectDir, "traces", `iter-${iterStr}-execute.md`)
  );
  const experiment = await safeRead(
    path.join(projectDir, "experiments", `exp-${iterStr}.md`)
  );
  const rubrics = await safeRead(path.join(SEA_ROOT, "eval", "rubrics.md"));

  // Last 3 scores
  const allScores = await readJsonl<Score>(
    path.join(projectDir, "metrics", "scores.jsonl")
  );
  const recentScores = lastN(allScores, 3);

  return `You are a research quality analyst. Evaluate the execution trace below.

Your working directory is: ${projectDir}

## Reflection Protocol
${reflectionProtocol}

## Expert Persona (for context)
${persona}

## Iteration: ${iter}

## Scoring Rubrics
${rubrics}

## Execution Trace
${trace}

## Experiment Log
${experiment}

${recentScores.length > 0 ? `## Recent Scores\n${JSON.stringify(recentScores, null, 2)}` : ""}

## Instructions
1. Score this iteration on each rubric dimension (1-10): Accuracy, Coverage, Coherence, Insight Quality
2. Compute the weighted overall score
3. Analyze what worked and WHY, what failed and WHY
4. Identify any patterns that could become reusable skills
5. Write your reflection to reflections/iter-${iterStr}.md
6. IMPORTANT: At the very end of your reflection file, include a machine-readable scores block:
\`\`\`json
{"accuracy": N, "coverage": N, "coherence": N, "insightQuality": N, "overall": N}
\`\`\`
`;
}

async function assembleEvolve(
  conductor: string,
  persona: string,
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const evolutionProtocol = extractSection(conductor, "Evolution Protocol");
  const iter = state.iteration ?? 1;

  // Last 3 reflections
  const reflections: string[] = [];
  for (let i = Math.max(1, iter - 2); i <= iter; i++) {
    const r = await safeRead(
      path.join(projectDir, "reflections", `iter-${String(i).padStart(3, "0")}.md`)
    );
    if (r) reflections.push(r);
  }

  // Last 5 lineage entries
  const lineage = await readJsonl(
    path.join(projectDir, "lineage", "changes.jsonl")
  );
  const recentLineage = lastN(lineage, 5);

  // Score trend
  const allScores = await readJsonl<Score>(
    path.join(projectDir, "metrics", "scores.jsonl")
  );
  const trend = lastN(allScores, 5).map((s) => s.overall);

  return `You are an evolution agent. Improve the expert persona based on reflection data.

Your working directory is: ${projectDir}

## Evolution Protocol
${evolutionProtocol}

## Current Persona
${persona}

## Iteration: ${iter}

## Recent Reflections
${reflections.join("\n\n---\n\n")}

${recentLineage.length > 0 ? `## Recent Lineage\n${JSON.stringify(recentLineage, null, 2)}` : ""}

${trend.length > 0 ? `## Score Trend\n${trend.join(" → ")}` : ""}

## Instructions
1. Read the reflections and identify the SINGLE highest-leverage improvement
2. Propose a specific, surgical change to persona.md
3. Explain your reasoning thoroughly (WHY this change, what evidence supports it)
4. Write the updated persona.md (the versioner will preserve the old one)
5. Append a lineage entry to lineage/changes.jsonl:
\`\`\`json
{"iteration": ${iter}, "timestamp": "${new Date().toISOString()}", "target": "persona.md", "versionBefore": "v${String(state.personaVersion ?? 1).padStart(3, "0")}", "versionAfter": "v${String((state.personaVersion ?? 1) + 1).padStart(3, "0")}", "changeType": "TYPE", "changeSummary": "SUMMARY", "reasoning": "WHY", "scoreBefore": ${trend[trend.length - 1] ?? "null"}, "scoreAfter": null}
\`\`\`
`;
}

async function assembleMeta(conductor: string): Promise<string> {
  const metaProtocol = extractSection(conductor, "Meta-Evolution Protocol");

  // Read lineage across all projects
  const projectsDir = path.join(SEA_ROOT, "projects");
  let projectNames: string[] = [];
  try {
    projectNames = await readdir(projectsDir);
  } catch {
    // no projects yet
  }

  const allLineage: string[] = [];
  const allScoreTrends: Record<string, number[]> = {};

  for (const name of projectNames) {
    const lineage = await readJsonl(
      path.join(projectsDir, name, "lineage", "changes.jsonl")
    );
    if (lineage.length > 0) {
      allLineage.push(`### ${name}\n${JSON.stringify(lastN(lineage, 5), null, 2)}`);
    }
    const scores = await readJsonl<Score>(
      path.join(projectsDir, name, "metrics", "scores.jsonl")
    );
    if (scores.length > 0) {
      allScoreTrends[name] = scores.map((s) => s.overall);
    }
  }

  return `You are the meta-evolution agent. Improve the SEA Conductor itself.

Your working directory is: ${SEA_ROOT}

## Meta-Evolution Protocol
${metaProtocol}

## Current Conductor
${conductor}

## Lineage Across Projects
${allLineage.join("\n\n") || "No project lineage yet."}

## Score Trends Across Projects
${Object.keys(allScoreTrends).length > 0 ? JSON.stringify(allScoreTrends, null, 2) : "No scores yet."}

## Instructions
1. Analyze patterns across ALL projects
2. What reflection/evolution strategies are working?
3. What conductor protocols need improvement?
4. Propose specific changes to CLAUDE.md (the versioner will preserve the old one)
5. IMPORTANT: Do NOT modify the "Safety Rails" section — it is immutable
6. Write the updated CLAUDE.md
7. Explain every change and why it will compound across future projects
`;
}

async function loadRelevantSkills(): Promise<string> {
  const skillsDir = path.join(SEA_ROOT, "skills");
  try {
    const files = await readdir(skillsDir);
    const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "registry.md");
    if (mdFiles.length === 0) return "";

    const skills: string[] = [];
    for (const file of mdFiles.slice(0, 5)) {
      // Load max 5 skills to stay within context
      const content = await safeRead(path.join(skillsDir, file));
      if (content) skills.push(content);
    }
    return skills.join("\n\n---\n\n");
  } catch {
    return "";
  }
}
