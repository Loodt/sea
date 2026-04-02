import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assemblePrompt, loadPipeline } from "./context.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import {
  parseScoresFromText,
  parseScoresFromFile,
  appendScore,
  readScores,
} from "./metrics.js";
import { checkAndRollback, advanceIteration } from "./safety.js";
import { initKnowledge, readFindings, readQuestions, informationGain } from "./knowledge.js";
import { appendSpan } from "./metrics.js";
import { existsSync } from "node:fs";
import type { ProjectState, LoopConfig, PipelineStep, Score, Span, Provider } from "./types.js";
import { DEFAULT_LOOP_CONFIG, padVersion, conductorFile, conductorFileCandidates } from "./types.js";

const SEA_ROOT = process.cwd();

/** Resolve the conductor playbook path, falling back across providers. */
function resolveConductorPath(provider?: Provider): string {
  for (const name of conductorFileCandidates(provider)) {
    const p = path.join(SEA_ROOT, name);
    if (existsSync(p)) return p;
  }
  // Fallback to provider's preferred (will be created by meta-evolution)
  return path.join(SEA_ROOT, conductorFile(provider));
}

let stopping = false;

export function requestStop(): void {
  stopping = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single iteration through the configured pipeline.
 * Default: plan → research → synthesize → evaluate → evolve → summarize
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

  console.log(
    `\n━━━ Iteration ${iter} (persona v${String(state.personaVersion).padStart(3, "0")}) ━━━\n`
  );

  // Ensure knowledge + scratch dirs exist
  await initKnowledge(projectDir);
  await mkdir(path.join(projectDir, "scratch"), { recursive: true });

  // Load pipeline config
  const pipeline = await loadPipeline(projectDir);
  const enabledSteps = pipeline.steps.filter((s) => s.enabled !== false);

  let score: number | null = null;

  for (const step of enabledSteps) {
    const result = await runStep(step, projectName, projectDir, iter, iterStr, state, config);

    // After evaluate step: parse scores
    if (step.type === "evaluate") {
      score = await handleScoring(result, projectDir, iter, iterStr, state);
    }

    // Before evolve step: snapshot persona
    if (step.type === "evolve") {
      await snapshotFile(
        path.join(projectDir, "persona.md"),
        path.join(projectDir, "persona-history")
      );
    }
  }

  // Advance state
  const hasEvolve = enabledSteps.some((s) => s.type === "evolve");
  const newState = await advanceIteration(projectDir, hasEvolve);

  // Check for regression
  const rolledBack = await checkAndRollback(projectDir, config);

  // Print the story
  await printIterationStory(projectDir, iter, iterStr, score, newState, rolledBack);

  return { iteration: iter, score };
}

async function runStep(
  step: PipelineStep,
  projectName: string,
  projectDir: string,
  iter: number,
  iterStr: string,
  state: ProjectState,
  config?: Partial<LoopConfig>
): Promise<string> {
  const labels: Record<string, string> = {
    plan: "📋 PLAN — creating research plan...",
    research: "🔍 RESEARCH — gathering data...",
    synthesize: "📝 SYNTHESIZE — writing report...",
    evaluate: "⚖️  EVALUATE — scoring output...",
    evolve: "🧬 EVOLVE — improving persona...",
    summarize: "📚 SUMMARIZE — updating knowledge store...",
  };

  console.log(labels[step.type] ?? `▶ ${step.type}...`);

  const prompt = await assemblePrompt(step.type, projectName, config?.provider);

  // Axiom 1: evaluate step can use a different model
  const runOpts = {
    ...(config?.provider ? { provider: config.provider } : {}),
    ...(step.type === "evaluate" && config?.evaluateModel ? { model: config.evaluateModel } : {}),
  };

  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `iter-${iterStr}-${step.type}`,
    runOpts
  );

  if (result.exitCode !== 0) {
    console.log(`   ⚠ ${step.type} exited with code ${result.exitCode}`);
  } else {
    console.log(`   ✓ ${step.type} complete`);
  }

  // Emit structured span
  const findingsCount = (result.stdout.match(/\[(SOURCE|DERIVED|ESTIMATED)/g) || []).length;
  await appendSpan(projectDir, {
    id: `pipeline-${iterStr}-${step.type}`,
    step: step.type,
    startTime: result.startTime,
    endTime: result.endTime,
    durationMs: result.durationMs,
    promptChars: prompt.length,
    outputChars: result.stdout.length,
    promptTokensEst: Math.ceil(prompt.length / 4),
    outputTokensEst: Math.ceil(result.stdout.length / 4),
    exitCode: result.exitCode,
    findingsProduced: findingsCount,
  });

  // Print a brief summary of what the step produced
  const brief = summarizeStepOutput(step.type, result.stdout, projectDir, iterStr);
  if (brief) {
    console.log(`   → ${brief}`);
  }

  return result.stdout;
}

async function handleScoring(
  stdout: string,
  projectDir: string,
  iter: number,
  iterStr: string,
  state: ProjectState
): Promise<number | null> {
  // Try parsing from stdout first
  let scores = parseScoresFromText(stdout, iter, state.personaVersion);

  // Fallback: parse from the reflection file
  if (!scores) {
    scores = await parseScoresFromFile(
      path.join(projectDir, "reflections", `iter-${iterStr}.md`),
      iter,
      state.personaVersion
    );
  }

  if (scores) {
    await appendScore(projectDir, scores);
    console.log(
      `   ✓ Scores — acc: ${scores.accuracy} | cov: ${scores.coverage} | coh: ${scores.coherence} | ins: ${scores.insightQuality} | proc: ${scores.processCompliance} | overall: ${scores.overall.toFixed(1)}`
    );
    return scores.overall;
  }

  console.log("   ⚠ Could not parse scores from evaluation");
  return null;
}

/**
 * Continuous loop: pipeline steps → repeat.
 * META step runs every N iterations.
 */
export async function runLoop(
  projectName: string,
  config: LoopConfig = DEFAULT_LOOP_CONFIG
): Promise<void> {
  console.log(`\n🌊 SEA Loop — Project: ${projectName}`);
  console.log(
    `   Cooldown: ${config.cooldownMs / 1000}s | Meta every: ${config.metaEveryN} iters`
  );
  console.log(`   Pipeline: plan → research → synthesize → evaluate → evolve → summarize`);
  console.log(`   Press Ctrl+C to stop gracefully\n`);

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

    // META (every N iterations)
    if (state.iteration % config.metaEveryN === 0) {
      console.log("\n🧠 META — evolving conductor...");

      await snapshotFile(
        resolveConductorPath(config.provider),
        path.join(SEA_ROOT, "conductor-history")
      );

      const metaPrompt = await assemblePrompt("meta", projectName, config.provider);
      await runAndTrace(
        metaPrompt,
        SEA_ROOT,
        path.join(projectDir, "traces"),
        `iter-${String(state.iteration - 1).padStart(3, "0")}-meta`,
        config.provider ? { provider: config.provider } : undefined
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

// ── Step Summaries ──

/**
 * Extract a brief summary from a pipeline step's output.
 * Shows WHAT happened, not THAT it ran.
 */
function summarizeStepOutput(
  stepType: string,
  stdout: string,
  projectDir: string,
  iterStr: string
): string {
  if (!stdout || stdout.length < 50) return "";

  switch (stepType) {
    case "plan": {
      // Count search queries and questions
      const queries = (stdout.match(/search.*?["'`]/gi) || []).length;
      const questions = stdout.split("\n").filter(
        (l) => l.trim().startsWith("- ") && l.includes("?")
      ).length;
      if (queries > 0 || questions > 0) {
        return `${questions} research questions, ${queries} search queries planned`;
      }
      return "";
    }

    case "research": {
      // Count findings with epistemic tags
      const tagged = stdout.split("\n").filter((l) =>
        /\[(SOURCE|DERIVED|ESTIMATED|ASSUMED|UNKNOWN)/.test(l)
      ).length;
      const urls = (stdout.match(/https?:\/\/[^\s)]+/g) || []).length;
      if (tagged > 0) {
        return `${tagged} tagged findings from ${urls} sources`;
      }
      return urls > 0 ? `${urls} sources gathered` : "";
    }

    case "synthesize": {
      // Find the report's key conclusion or first substantive line
      const lines = stdout.split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (/key\s+find|conclusion|executive\s+summ|main\s+result|bottom\s+line/i.test(t)) {
          const next = lines[lines.indexOf(line) + 1]?.trim();
          if (next && next.length > 20 && !next.startsWith("#")) {
            return next.replace(/^[-*]\s*/, "").replace(/\*\*/g, "").slice(0, 120);
          }
        }
      }
      // Fallback: report size
      const kb = (stdout.length / 1024).toFixed(0);
      const sections = lines.filter((l) => /^##\s/.test(l)).length;
      return `${kb}KB report with ${sections} sections`;
    }

    case "evaluate": {
      // Score line is already printed by handleScoring, so extract the top issue
      const lines = stdout.split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (/weak|gap|miss|fail|improv|issue|concern|flag/i.test(t) && t.length > 30) {
          return t.replace(/^[-*#>\d.]+\s*/, "").replace(/\*\*/g, "").slice(0, 120);
        }
      }
      return "";
    }

    case "evolve": {
      // Parse evolution candidates for novelty-pressure logging
      const candidates = parseEvolutionCandidates(stdout);
      if (candidates.length > 0) {
        const maxScore = Math.max(...candidates.map((c) => c.compositeScore));
        const parts = candidates.map((c) => {
          const star = c.compositeScore === maxScore ? "\u2605" : " ";
          return `${star}[${c.changeType}] "${c.description.slice(0, 40)}" (p:${c.performanceScore} n:${c.noveltyScore} c:${c.compositeScore.toFixed(1)})`;
        });
        return `${candidates.length} candidates: ${parts.join(" | ")}`;
      }
      // Fallback: what changed in the persona
      const lines = stdout.split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (/added|removed|changed|updated|consolidated|replaced/i.test(t) && t.length > 20) {
          return t.replace(/^[-*#>\d.]+\s*/, "").replace(/\*\*/g, "").slice(0, 120);
        }
      }
      return "";
    }

    case "summarize": {
      // Count what was added to the knowledge store
      const newFindings = (stdout.match(/"id":\s*"F\d+"/g) || []).length;
      const newQuestions = (stdout.match(/"id":\s*"Q\d+"/g) || []).length;
      const resolved = (stdout.match(/"status":\s*"resolved"/g) || []).length;
      const parts: string[] = [];
      if (newFindings > 0) parts.push(`${newFindings} findings`);
      if (newQuestions > 0) parts.push(`${newQuestions} questions`);
      if (resolved > 0) parts.push(`${resolved} resolved`);
      return parts.length > 0 ? `Knowledge store: +${parts.join(", +")}` : "";
    }

    default:
      return "";
  }
}

/**
 * Parse evolution candidates from evolve step output.
 * Extracts JSON blocks that match the EvolutionCandidate shape.
 */
function parseEvolutionCandidates(text: string): import("./types.js").EvolutionCandidate[] {
  const candidates: import("./types.js").EvolutionCandidate[] = [];
  const jsonBlockRe = /```json\s*\n([\s\S]*?)\n\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = jsonBlockRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (typeof parsed.performanceScore === "number" && typeof parsed.noveltyScore === "number") {
        candidates.push({
          id: parsed.id ?? candidates.length + 1,
          changeType: parsed.changeType ?? "behavioral",
          description: parsed.description ?? "",
          hypothesis: parsed.hypothesis ?? "",
          noveltyScore: parsed.noveltyScore,
          performanceScore: parsed.performanceScore,
          compositeScore: parsed.compositeScore ?? (parsed.performanceScore * 0.7 + parsed.noveltyScore * 0.3),
        });
      }
    } catch { /* not a candidate JSON */ }
  }
  return candidates;
}

// ── Iteration Story ──

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract narrative headlines from iteration artifacts and print a
 * human-readable story block to the terminal.
 */
async function printIterationStory(
  projectDir: string,
  iter: number,
  iterStr: string,
  score: number | null,
  newState: ProjectState,
  rolledBack: boolean
): Promise<void> {
  const BAR = "━";
  const width = 64;

  // Gather narrative data from files already on disk
  const [findings, questions, allScores, lineageRaw, reflectionRaw] = await Promise.all([
    readFindings(projectDir),
    readQuestions(projectDir),
    readScores(projectDir),
    safeRead(path.join(projectDir, "lineage", "changes.jsonl")),
    safeRead(path.join(projectDir, "reflections", `iter-${iterStr}.md`)),
  ]);

  // Score delta
  const prevScore = allScores.length >= 2 ? allScores[allScores.length - 2].overall : null;
  const scoreDelta =
    score !== null && prevScore !== null
      ? score - prevScore
      : null;
  const deltaStr =
    scoreDelta !== null
      ? scoreDelta >= 0
        ? ` (+${scoreDelta.toFixed(1)})`
        : ` (${scoreDelta.toFixed(1)})`
      : "";

  // Information gain this iteration
  const gain = informationGain(findings, questions, iter);
  const openQs = questions.filter((q) => q.status === "open");
  const verified = findings.filter((f) => f.status === "verified").length;

  // Extract key narrative lines from the reflection
  const headlines = extractHeadlines(reflectionRaw);

  // Last lineage entry (what persona learned)
  let personaLearned = "";
  if (lineageRaw.trim()) {
    const entries = lineageRaw.trim().split("\n");
    const last = entries[entries.length - 1];
    try {
      const entry = JSON.parse(last);
      personaLearned = entry.changeSummary || "";
    } catch {
      // ignore
    }
  }

  // Print the story block
  console.log(`\n${BAR.repeat(width)}`);
  console.log(`  Iteration ${iter} Complete`);
  console.log(BAR.repeat(width));

  if (headlines.discovery) {
    console.log(`\n  Discovery:  ${wrapIndent(headlines.discovery, 14, width - 4)}`);
  }
  if (headlines.surprise) {
    console.log(`\n  Surprise:   ${wrapIndent(headlines.surprise, 14, width - 4)}`);
  }
  if (headlines.lead) {
    console.log(`\n  New lead:   ${wrapIndent(headlines.lead, 14, width - 4)}`);
  }
  if (headlines.gap) {
    console.log(`\n  Open:       ${wrapIndent(headlines.gap, 14, width - 4)}`);
  }

  // If no headlines extracted, show a brief status instead
  if (!headlines.discovery && !headlines.surprise && !headlines.lead && !headlines.gap) {
    if (gain.newFindings > 0) {
      console.log(`\n  ${gain.newFindings} new findings added to knowledge store`);
    } else {
      console.log(`\n  (No narrative extracted — check reflections/iter-${iterStr}.md)`);
    }
  }

  // Stats line
  const parts: string[] = [];
  if (score !== null) parts.push(`Score: ${score.toFixed(1)}${deltaStr}`);
  parts.push(`Findings: ${findings.length} (${verified} verified)`);
  if (openQs.length > 0) parts.push(`Open Qs: ${openQs.length}`);
  console.log(`\n  ${parts.join("  |  ")}`);

  // Persona change
  if (rolledBack) {
    console.log(`  Persona: rolled back to ${padVersion(newState.personaVersion)}`);
  } else if (personaLearned) {
    console.log(`  Persona learned: ${truncateLine(personaLearned, width - 20)}`);
  }

  console.log(BAR.repeat(width));
}

/**
 * Extract narrative headlines from a reflection file.
 * Looks for "what worked" items, key findings, gaps, and surprises.
 */
function extractHeadlines(reflection: string): {
  discovery: string;
  surprise: string;
  lead: string;
  gap: string;
} {
  const result = { discovery: "", surprise: "", lead: "", gap: "" };
  if (!reflection) return result;

  const lines = reflection.split("\n");

  // Look for specific patterns in the reflection
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";

    // Key finding / discovery — look for "key finding", "main finding", "most important"
    if (!result.discovery && /key\s+find|main\s+find|most\s+important|central\s+(conclusion|finding)/i.test(line)) {
      result.discovery = extractContent(line, nextLine);
    }

    // Surprise — look for "surprising", "unexpected", "contradicts", "however"
    if (!result.surprise && /surpris|unexpect|contradict|however.*assumed|not.*expected/i.test(line)) {
      result.surprise = extractContent(line, nextLine);
    }

    // New lead / opportunity — look for "opportunity", "promising", "new approach", "novel"
    if (!result.lead && /opportunit|new\s+(approach|lead|pathway)|novel|piggyback|could\s+enable/i.test(line)) {
      result.lead = extractContent(line, nextLine);
    }

    // Gap / open question — look for "gap", "unknown", "no data", "needs verification"
    if (!result.gap && /\bgap\b|unknown|no\s+(data|published|measurement)|needs?\s+verif|open\s+question/i.test(line)) {
      result.gap = extractContent(line, nextLine);
    }
  }

  // Fallback: if no discovery found, take the first "what worked" bullet
  if (!result.discovery) {
    const workedMatch = reflection.match(/what\s+worked[\s\S]*?\n[-*]\s*\*?\*?(.+)/i);
    if (workedMatch) {
      result.discovery = cleanLine(workedMatch[1]);
    }
  }

  return result;
}

function extractContent(line: string, nextLine: string): string {
  // If the line has substantive content after a colon or dash, use it
  const colonSplit = line.split(/[:—]\s*/);
  if (colonSplit.length > 1 && colonSplit[colonSplit.length - 1].length > 20) {
    return cleanLine(colonSplit.slice(1).join(": "));
  }
  // If the line is a heading and the next line has content, use next line
  if (line.startsWith("#") || line.endsWith(":") || line.length < 30) {
    if (nextLine && nextLine.length > 10 && !nextLine.startsWith("#")) {
      return cleanLine(nextLine);
    }
  }
  return cleanLine(line);
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-*#>\d.]+\s*/, "")     // strip bullets, headings, numbers
    .replace(/\*\*/g, "")               // strip bold markdown
    .replace(/\[.*?\]/g, "")            // strip markdown links/tags
    .replace(/\s+/g, " ")              // collapse whitespace
    .trim()
    .slice(0, 200);                     // hard cap
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

function truncateLine(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
