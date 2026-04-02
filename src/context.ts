import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { StepType, ProjectState, Score, PipelineConfig, Provider } from "./types.js";
import { CONTEXT_BUDGETS, DEFAULT_PIPELINE, conductorFile, conductorFileCandidates } from "./types.js";
import { getIntegritySnippets } from "./integrity.js";
import { readSummary, readFindings, readQuestions, informationGain } from "./knowledge.js";
import { readScores } from "./metrics.js";

const SEA_ROOT = process.cwd();

// ── Utilities ──

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Read conductor playbook, trying provider's preferred file then falling back. */
async function readConductorPlaybook(provider?: Provider): Promise<string> {
  for (const name of conductorFileCandidates(provider)) {
    const content = await safeRead(path.join(SEA_ROOT, name));
    if (content) return content;
  }
  return "";
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

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

function extractHeadings(md: string): string {
  return md
    .split("\n")
    .filter((l) => /^#{1,3}\s/.test(l))
    .join("\n");
}

// ── Context Monitoring ──

function measurePrompt(prompt: string, step: StepType): string {
  const chars = prompt.length;
  const budget = CONTEXT_BUDGETS[step];
  const pct = Math.round((chars / budget) * 100);
  console.log(`   [context] ${step}: ${(chars / 1024).toFixed(1)}KB / ${(budget / 1024).toFixed(0)}KB (${pct}%)`);
  if (chars > budget) {
    console.warn(`   ⚠ ${step} prompt exceeds budget — truncation may be needed`);
  }
  return prompt;
}

// ── Pipeline Config ──

export async function loadPipeline(projectDir: string): Promise<PipelineConfig> {
  try {
    const raw = await readFile(path.join(projectDir, "pipeline.json"), "utf-8");
    return JSON.parse(raw) as PipelineConfig;
  } catch {
    return DEFAULT_PIPELINE;
  }
}

// ── Main Entry Point ──

export async function assemblePrompt(
  step: StepType,
  projectName: string,
  provider?: Provider
): Promise<string> {
  const projectDir = path.join(SEA_ROOT, "projects", projectName);
  const conductor = await readConductorPlaybook(provider);
  const persona = await safeRead(path.join(projectDir, "persona.md"));
  const goal = await safeRead(path.join(projectDir, "goal.md"));
  const state: ProjectState = JSON.parse(
    (await safeRead(path.join(projectDir, "state.json"))) || "{}"
  );

  let prompt: string;

  switch (step) {
    case "plan":
      prompt = await assemblePlan(persona, goal, state, projectDir);
      break;
    case "research":
      prompt = await assembleResearch(state, projectDir);
      break;
    case "synthesize":
      prompt = await assembleSynthesize(persona, goal, state, projectDir);
      break;
    case "evaluate":
      prompt = await assembleEvaluate(state, projectDir);
      break;
    case "evolve":
      prompt = await assembleEvolve(conductor, persona, state, projectDir);
      break;
    case "summarize":
      prompt = await assembleSummarize(state, projectDir);
      break;
    case "meta":
      prompt = await assembleMeta(conductor, conductorFile(provider));
      break;
    default:
      throw new Error(`Unknown step: ${step}`);
  }

  return measurePrompt(prompt, step);
}

// ── PLAN ──
// Reads: persona + goal + knowledge summary + last eval + failure patterns
// Outputs: research plan with specific questions, skeleton, search queries

async function assemblePlan(
  persona: string,
  goal: string,
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const iter = state.iteration ?? 1;
  const iterStr = String(iter).padStart(3, "0");

  // Compressed knowledge — not full reports
  const summary = await readSummary(projectDir);

  // Last evaluation key points (truncated)
  const lastEval = await safeRead(
    path.join(projectDir, "reflections", `iter-${String(iter - 1).padStart(3, "0")}.md`)
  );
  const evalBrief = lastEval ? truncate(lastEval, 1500) : "";

  // Failure patterns relevant to this project
  const failurePatterns = await loadFailurePatterns();

  const integrity = getIntegritySnippets("plan");

  return `You are a research planner. Create a focused research plan for this iteration.

Your working directory is: ${projectDir}

## Your Expert Persona
${persona}

## Project Goal
${goal}

## Current Iteration: ${iter}

## Task
${state.currentTask ?? "Continue researching the project goal. Build on prior knowledge and address open questions."}

## Current Knowledge
${summary || "(No prior findings yet — this is the first iteration)"}

${evalBrief ? `## Last Evaluation Summary\n${evalBrief}` : ""}

${failurePatterns ? `## Known Failure Patterns (avoid these)\n${failurePatterns}` : ""}

${integrity}

## Instructions
1. Review the knowledge summary and identify the highest-priority gaps
2. Write a research plan to scratch/iter-${iterStr}-plan.md with:
   - **Objective:** What specific questions this iteration will answer (max 3-4)
   - **Search queries:** Specific web searches to execute (5-10 queries)
   - **Sections needed:** What sections the final output should have (headings only)
   - **Prior findings to build on:** Which verified findings to use as inputs
   - **Open questions to address:** Which questions from the knowledge store to target
3. Write a minimal output skeleton to scratch/iter-${iterStr}-skeleton.md (headings only, <20 lines)
4. Create initial protocol scaffolds:
   - experiments/exp-${iterStr}.md with hypothesis + planned method (5-10 lines)
5. Do NOT do any web searching — that is the research step's job
`;
}

// ── RESEARCH ──
// Reads: plan only (+ persona source evaluation criteria)
// Outputs: tagged findings in scratch file

async function assembleResearch(
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const iter = state.iteration ?? 1;
  const iterStr = String(iter).padStart(3, "0");

  // Read the plan from the previous step
  const plan = await safeRead(
    path.join(projectDir, "scratch", `iter-${iterStr}-plan.md`)
  );

  // Read just the source evaluation section from persona (not the whole thing)
  const persona = await safeRead(path.join(projectDir, "persona.md"));
  const sourceEval = extractSection(persona, "Source Evaluation");

  const integrity = getIntegritySnippets("research");

  return `You are a research agent. Execute the research plan below. Gather data, not opinions.

Your working directory is: ${projectDir}

## Research Plan
${plan || "No plan found. Research the project goal broadly using web search."}

${sourceEval ? `## Source Evaluation Criteria\n${sourceEval}` : ""}

${integrity}

## Instructions
1. Execute the search queries from the plan using web search and web fetch
2. For EACH finding, save it to scratch/iter-${iterStr}-findings.md with:
   - The claim (one sentence)
   - The epistemic tag: [SOURCE: url], [DERIVED: method], [ESTIMATED: basis], [ASSUMED], or [UNKNOWN]
   - Key data points (numbers, dates, names)
   - Brief context
3. Append ALL source URLs to references/links.md (append, don't overwrite)
4. Do NOT synthesize or write the final report — that is the synthesize step's job
5. Do NOT read prior output files — work from the plan only
6. Focus on answering the specific questions in the plan
7. If you find contradictions with the plan's stated prior findings, note them explicitly
8. Prefer [UNKNOWN] over guessing. Flag gaps for the next iteration.
`;
}

// ── SYNTHESIZE ──
// Reads: findings + skeleton + knowledge summary
// Outputs: the deliverable report + completed protocol artifacts

async function assembleSynthesize(
  persona: string,
  goal: string,
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const iter = state.iteration ?? 1;
  const iterStr = String(iter).padStart(3, "0");

  const findings = await safeRead(
    path.join(projectDir, "scratch", `iter-${iterStr}-findings.md`)
  );
  const skeleton = await safeRead(
    path.join(projectDir, "scratch", `iter-${iterStr}-skeleton.md`)
  );
  const summary = await readSummary(projectDir);

  // Just the synthesis approach and output format from persona
  const synthApproach = extractSection(persona, "Synthesis Approach");
  const outputFormat = extractSection(persona, "Output Format");

  const integrity = getIntegritySnippets("synthesize");

  return `You are a synthesis agent. Write the deliverable report from the research findings below.

Your working directory is: ${projectDir}

## Synthesis Approach
${synthApproach || "Structure output as a clear technical report. Lead with key findings."}

## Output Format
${outputFormat || "Structured report with sections matching the skeleton below."}

## Output Skeleton
${skeleton || "(No skeleton provided — use section headings from the goal)"}

## Research Findings (from this iteration)
${findings || "(No findings file found — synthesize from the knowledge summary only)"}

## Prior Knowledge Summary
${summary || "(First iteration — no prior knowledge)"}

## Project Goal (for alignment)
${truncate(goal, 1000)}

${integrity}

## Finding ID Discipline
When referencing findings in the report, use ONLY IDs that exist in knowledge/findings.jsonl (the summarize step just updated it). Read the file to see available IDs. Do NOT invent finding IDs — if a claim isn't in the store, present it without an ID or tag it [DERIVED].

## Instructions
1. Read knowledge/findings.jsonl to see the current finding IDs available for reference
2. Write the report to output/ following the skeleton structure
3. Carry forward epistemic tags from findings — do NOT strip them
4. Where you add new claims in synthesis (comparisons, conclusions), tag them as [DERIVED: synthesis of findings] or [ESTIMATED: based on X]
5. Anchor every comparison: compared to what, by how much, under what conditions
6. After writing the deliverable, IMMEDIATELY complete protocol artifacts:
   - Update experiments/exp-${iterStr}.md with results + analysis (what worked, what didn't, WHY)
   - Write trace to traces/iter-${iterStr}-execute.md
7. Do NOT do web searches — work only from the findings and knowledge summary
8. Flag any critical gaps as [UNKNOWN] — these become questions for the next iteration
`;
}

// ── EVALUATE ──
// Reads: output + rubrics + integrity axioms (NOT the persona or goal framing)
// This is the independent critic — structurally separated from the producer

async function assembleEvaluate(
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const iter = state.iteration ?? 1;
  const iterStr = String(iter).padStart(3, "0");

  // Read what was produced
  const trace = await safeRead(
    path.join(projectDir, "traces", `iter-${iterStr}-execute.md`)
  );
  const experiment = await safeRead(
    path.join(projectDir, "experiments", `exp-${iterStr}.md`)
  );

  // Read this iteration's output file (fall back to latest if naming differs)
  const outputDir = path.join(projectDir, "output");
  let outputContent = await safeRead(path.join(outputDir, `iter-${iterStr}-report.md`));
  if (!outputContent) {
    try {
      const files = await readdir(outputDir);
      const iterFiles = files.filter((f) => f.includes(iterStr) && f.endsWith(".md")).sort();
      if (iterFiles.length > 0) {
        outputContent = await safeRead(path.join(outputDir, iterFiles[0]));
      } else {
        // Last resort: latest file
        const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
        if (mdFiles.length > 0) {
          outputContent = await safeRead(path.join(outputDir, mdFiles[mdFiles.length - 1]));
        }
      }
    } catch {
      // no output dir
    }
  }
  outputContent = truncate(outputContent, 12000);

  // Rubrics (from eval/)
  const rubrics = await safeRead(path.join(SEA_ROOT, "eval", "rubrics.md"));

  // Recent scores for trend context
  const allScores = await readScores(projectDir);
  const recentScores = lastN(allScores, 3);

  // Knowledge metrics for stagnation detection
  const findings = await readFindings(projectDir);
  const questions = await readQuestions(projectDir);
  const gain = informationGain(findings, questions, iter);

  const integrity = getIntegritySnippets("evaluate");

  return `You are an independent research quality critic. Evaluate the output below. Your job is to find flaws, not validate effort.

Your working directory is: ${projectDir}

${integrity}

## Scoring Rubrics
${rubrics}

## Output to Evaluate
${outputContent || "(No output file found for this iteration)"}

## Execution Trace
${truncate(trace, 2000)}

## Experiment Log
${truncate(experiment, 1500)}

## Iteration: ${iter}

${recentScores.length > 0 ? `## Recent Score Trend\n${JSON.stringify(recentScores.map((s) => ({ iter: s.iteration, overall: s.overall })))}` : ""}

## Information Gain This Iteration
- New findings: ${gain.newFindings}
- Resolved questions: ${gain.resolvedQuestions}
- Contradictions detected: ${gain.contradictions}
${gain.newFindings === 0 && gain.resolvedQuestions === 0 ? "\n**⚠ STAGNATION WARNING:** Zero new findings and zero resolved questions. This iteration may not have added value. Flag this for the evolve step." : ""}

## Instructions
1. Score this iteration on each rubric dimension (1-10):
   - **Accuracy** (0.25): Are claims factually correct? Are sources cited? Check epistemic tags — are they present and accurate?
   - **Coverage** (0.20): Are the key aspects addressed? What's missing?
   - **Coherence** (0.15): Is it well-structured and logical?
   - **Insight Quality** (0.20): Are there novel connections? Or just restating sources?
   - **Process Compliance** (0.20): Were protocol artifacts produced (trace, exp log, claim tags, references)? Were epistemic tags used?
2. Compute weighted overall score
3. Check for unanchored comparisons ("promising", "significant" without baseline/magnitude)
4. Check claim tags: are they present? Do [SOURCE] tags point to real references?
5. Analyze what worked (WHY) and what failed (WHY)
6. Write reflection to reflections/iter-${iterStr}.md
7. IMPORTANT: At the end of the reflection, include a machine-readable scores block:
\`\`\`json
{"accuracy": N, "coverage": N, "coherence": N, "insightQuality": N, "processCompliance": N, "overall": N}
\`\`\`
   (The loop infrastructure will parse this block and persist scores — do NOT write to scores.jsonl yourself.)
`;
}

// ── EVOLVE ──
// Reads: evaluation + persona + lineage + failure patterns
// Outputs: updated persona, lineage entry, optional failure pattern

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
    if (r) reflections.push(truncate(r, 2000));
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

  // Failure and success patterns
  const failurePatterns = await loadFailurePatterns();
  const successPatterns = await loadSuccessPatterns();

  const integrity = getIntegritySnippets("evolve");

  return `You are an evolution agent. Improve the expert persona based on evaluation data.

Your working directory is: ${projectDir}

## Evolution Protocol
${evolutionProtocol}

${integrity}

## Current Persona
${persona}

## Iteration: ${iter}

## Recent Evaluations
${reflections.join("\n\n---\n\n")}

${recentLineage.length > 0 ? `## Recent Lineage\n${JSON.stringify(recentLineage, null, 2)}` : ""}

${trend.length > 0 ? `## Score Trend\n${trend.join(" → ")}` : ""}

${failurePatterns ? `## Known Failure Patterns\n${failurePatterns}` : ""}

${successPatterns ? `## Known Success Patterns\n${successPatterns}` : ""}

## Recent Changes (for novelty assessment)
${recentLineage.length > 0 ? recentLineage.map((e: any) => `- ${e.changeSummary}`).join("\n") : "No prior changes."}

## Instructions
1. Check failure-patterns/ — is the issue you see already documented? If so, apply the known fix.
2. Read the evaluations and generate 3 CANDIDATE changes (not just 1). For each, output a JSON block:
\`\`\`json
{"id": N, "changeType": "behavioral|strategic|no-change|exploratory", "description": "...", "hypothesis": "...", "noveltyScore": N, "performanceScore": N, "compositeScore": N}
\`\`\`
   Scoring rules:
   - performanceScore (0-10): expected impact on weakest dimension
   - noveltyScore (0-10): distance from the "Recent Changes" above (0 = nearly identical, 10 = completely new approach)
   - compositeScore = performanceScore * 0.7 + noveltyScore * 0.3
${iter % 5 === 0 ? "\n   **DIVERSITY BUDGET ACTIVE:** At least ONE candidate MUST have noveltyScore >= 7 and changeType 'exploratory'. This triggers every 5th iteration to escape local optima.\n" : ""}
3. Select the candidate with the highest compositeScore
4. **Size check:** If persona exceeds 60 lines, consolidation is mandatory before any addition
5. Apply the selected change to persona.md — explain your reasoning (WHY this change, what evidence supports it)
6. Write the updated persona.md (the versioner will preserve the old one)
7. If you discovered a new generalizable failure mode, write it to failure-patterns/
8. Append a lineage entry to lineage/changes.jsonl:
\`\`\`json
{"iteration": ${iter}, "timestamp": "${new Date().toISOString()}", "target": "persona.md", "versionBefore": "v${String(state.personaVersion ?? 1).padStart(3, "0")}", "versionAfter": "v${String((state.personaVersion ?? 1) + 1).padStart(3, "0")}", "changeType": "TYPE", "changeSummary": "SUMMARY", "reasoning": "WHY", "scoreBefore": ${trend[trend.length - 1] ?? "null"}, "scoreAfter": null}
\`\`\`
`;
}

// ── SUMMARIZE ──
// Reads: output + current knowledge store
// Outputs: updated findings.jsonl, questions.jsonl, summary.md

async function assembleSummarize(
  state: ProjectState,
  projectDir: string
): Promise<string> {
  const iter = state.iteration ?? 1;
  const iterStr = String(iter).padStart(3, "0");

  // Current knowledge state
  const findings = await readFindings(projectDir);
  const questions = await readQuestions(projectDir);

  // The findings from research step (just produced — this is the primary input)
  const rawFindings = await safeRead(
    path.join(projectDir, "scratch", `iter-${iterStr}-findings.md`)
  );

  // Previous iteration's evaluation (for question resolution context)
  const prevIterStr = String(iter - 1).padStart(3, "0");
  const prevEval = iter > 1
    ? await safeRead(path.join(projectDir, "reflections", `iter-${prevIterStr}.md`))
    : "";
  const evalBrief = prevEval ? truncate(prevEval, 1000) : "";

  const integrity = getIntegritySnippets("summarize");

  // Max existing finding ID for safe ID assignment
  const maxFindingId = findings.length > 0
    ? Math.max(...findings.map((f) => parseInt(f.id.replace(/\D/g, ""), 10) || 0))
    : 0;
  const maxQuestionId = questions.length > 0
    ? Math.max(...questions.map((q) => parseInt(q.id.replace(/\D/g, ""), 10) || 0))
    : 0;

  return `You are the knowledge manager. Persist research findings to the structured knowledge store BEFORE synthesis runs.

Your working directory is: ${projectDir}

${integrity}

## CRITICAL: This step runs BEFORE synthesis
The synthesize step reads from the knowledge store you update here. Any finding you persist now will be available for the report. Any finding you miss will not exist for synthesis to reference. This is the ONLY opportunity to persist this iteration's research.

## Current Knowledge Store
- ${findings.length} existing findings (${findings.filter((f) => f.status === "verified").length} verified, ${findings.filter((f) => f.status === "provisional").length} provisional)
- ${questions.length} existing questions (${questions.filter((q) => q.status === "open").length} open)
- Max finding ID: F${String(maxFindingId).padStart(3, "0")} — new findings start at F${String(maxFindingId + 1).padStart(3, "0")}
- Max question ID: Q${String(maxQuestionId).padStart(3, "0")} — new questions start at Q${String(maxQuestionId + 1).padStart(3, "0")}

## Research Findings (this iteration)
${rawFindings || "(No findings file found)"}

${evalBrief ? `## Previous Evaluation Summary (for question resolution context)\n${evalBrief}` : ""}

## Current Iteration: ${iter}

## Instructions
1. Read knowledge/findings.jsonl to confirm the current max ID (should be F${String(maxFindingId).padStart(3, "0")})
2. Extract new findings from the research. For each, APPEND a JSONL entry to knowledge/findings.jsonl:
   \`{"id": "F${String(maxFindingId + 1).padStart(3, "0")}", "claim": "...", "tag": "SOURCE|DERIVED|ESTIMATED|ASSUMED", "source": "url or null", "confidence": 0.0-1.0, "domain": "...", "iteration": ${iter}, "status": "provisional", "verifiedAt": null, "supersededBy": null}\`
   Increment the ID for each finding. NEVER reuse an existing ID.
3. Check if any existing provisional findings were confirmed or contradicted by this iteration's research. Update their status in findings.jsonl.
4. Extract new open questions. APPEND to knowledge/questions.jsonl starting at Q${String(maxQuestionId + 1).padStart(3, "0")}:
   \`{"id": "Q${String(maxQuestionId + 1).padStart(3, "0")}", "question": "...", "priority": "high|medium|low", "context": "...", "domain": "...", "iteration": ${iter}, "status": "open", "resolvedAt": null, "resolvedBy": null}\`
5. Check if any open questions were answered. Update their status.
6. Write an updated knowledge/summary.md (max 2KB) with:
   - Verified findings (bullet list)
   - Key provisional findings
   - High-priority open questions
   - Brief status line (counts)
   This is what the SYNTHESIZE agent reads next — keep it dense and current.
`;
}

// ── META ──
// Reads: lineage across projects, integrity principles, score trends

async function assembleMeta(conductor: string, filename: string = "CLAUDE.md"): Promise<string> {
  const metaProtocol = extractSection(conductor, "Meta-Evolution Protocol");

  const projectsDir = path.join(SEA_ROOT, "projects");
  let projectNames: string[] = [];
  try {
    projectNames = await readdir(projectsDir);
  } catch {
    // no projects
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

  // Integrity principles for meta-review
  const integrity = await safeRead(path.join(SEA_ROOT, "eval", "integrity.md"));

  return `You are the meta-evolution agent. Improve the SEA Conductor itself.

Your working directory is: ${SEA_ROOT}

## Meta-Evolution Protocol
${metaProtocol}

## Current Conductor
${conductor}

## Integrity Principles
${truncate(integrity, 4000)}

## Lineage Across Projects
${allLineage.join("\n\n") || "No project lineage yet."}

## Score Trends Across Projects
${Object.keys(allScoreTrends).length > 0 ? JSON.stringify(allScoreTrends, null, 2) : "No scores yet."}

## Instructions
1. Analyze patterns across ALL projects
2. What evaluation/evolution strategies are working?
3. What conductor protocols need improvement?
4. Are the integrity principles being addressed? Which should be woven deeper?
5. Propose specific changes to ${filename} (the versioner will preserve the old one)
6. IMPORTANT: Do NOT modify the "Safety Rails" section — it is immutable
7. Write the updated ${filename}
8. Explain every change and why it will compound across future projects
`;
}

// ── Failure Patterns ──

async function loadFailurePatterns(): Promise<string> {
  const dir = path.join(SEA_ROOT, "failure-patterns");
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return "";

    const patterns: string[] = [];
    for (const file of mdFiles) {
      const content = await safeRead(path.join(dir, file));
      // Extract just the description and prevention — not the full file
      const desc = extractSection(content, "Description");
      const prevention = extractSection(content, "Prevention");
      if (desc) {
        patterns.push(`**${file.replace(".md", "")}:** ${truncate(desc, 200)}\nPrevention: ${truncate(prevention, 300)}`);
      }
    }
    return patterns.join("\n\n");
  } catch {
    return "";
  }
}

async function loadSuccessPatterns(): Promise<string> {
  const dir = path.join(SEA_ROOT, "success-patterns");
  try {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) return "";

    const patterns: string[] = [];
    for (const file of mdFiles) {
      const content = await safeRead(path.join(dir, file));
      const stratMatch = content.match(/## Strategy\n+([\s\S]*?)(?=\n##)/);
      if (stratMatch) {
        const strat = stratMatch[1].trim().split("\n")[0];
        patterns.push(`- **${file.replace(".md", "")}:** ${strat}`);
      }
    }
    return patterns.join("\n");
  } catch {
    return "";
  }
}
