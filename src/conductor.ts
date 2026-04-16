import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { atomicAppendJsonl } from "./file-lock.js";
import { createHash } from "node:crypto";
import path from "node:path";
import { createExpert } from "./expert-factory.js";
import { runExpertLoop } from "./expert-loop.js";
import { runAndTrace } from "./runner.js";
import { snapshotFile } from "./versioner.js";
import {
  snapshotStores,
  diffStores,
  detectClobber,
  restoreStores,
} from "./store-snapshot.js";
import { applySelectionGuards } from "./selection-guards.js";
import { applyQuestionCaps } from "./question-caps.js";
import { readConductorMetrics } from "./metrics.js";
import {
  readFindings,
  readQuestions,
  updateQuestion,
  graduateFindings,
  enforceSummarySize,
  enforceSummaryFreshness,
  deduplicateFindings,
  aggregateReferences,
  normalizeQuestionIds,
  enforceDerivationChains,
  enforceSourceUrls,
} from "./knowledge.js";
import {
  assembleQuestionSelectionPrompt,
  assembleHandoffIntegrationPrompt,
  assembleConductorMetaPrompt,
} from "./conductor-context.js";
import { appendSpan } from "./metrics.js";
import { hashPersona, upsertLibraryEntry } from "./expert-library.js";
import type {
  ConductorState,
  ConductorConfig,
  QuestionSelection,
  ExpertConfig,
  ExpertHandoff,
  ConductorMetric,
  QuestionType,
} from "./types.js";
import { existsSync } from "node:fs";
import { DEFAULT_CONDUCTOR_CONFIG, QUESTION_TYPE_ITERATION_CAP, conductorFile, conductorFileCandidates } from "./types.js";

import type { Provider } from "./types.js";

const SEA_ROOT = process.cwd();

/** Resolve the conductor playbook path, falling back across providers. */
function resolveConductorPath(provider?: Provider): string {
  for (const name of conductorFileCandidates(provider)) {
    const p = path.join(SEA_ROOT, name);
    if (existsSync(p)) return p;
  }
  return path.join(SEA_ROOT, conductorFile(provider));
}

let stopping = false;

export function requestConductorStop(): void {
  stopping = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a single conductor iteration (v038 persona architecture):
 * 1. Select question (conductor LLM call — strategic exploration)
 * 2. Create expert persona (conductor LLM call — domain framing)
 * 3. Run expert loop (expert LLM calls — research + finding validation)
 * 4. Integrate handoff (conductor LLM call — merge into knowledge store)
 *
 * Rollback from v035 hybrid after EXP-013 deployment validation showed
 * 4× domain coverage drop and verification regression when persona was removed.
 * Persona is structured-context utilization, not overhead.
 */
export async function runConductorIteration(
  projectName: string,
  config: ConductorConfig = DEFAULT_CONDUCTOR_CONFIG,
  forceQuestionId?: string
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

  const dispatchStart = Date.now();
  const dispatchStartTime = new Date().toISOString();

  // ═══ CALL 1: Question Selection ═══
  // priorMetrics is used by both the selector-guard path and the post-integration
  // question-cap enforcement, so read once before the override branch.
  const priorMetrics = await readConductorMetrics(projectDir);
  let selection: QuestionSelection;
  if (forceQuestionId) {
    // Manual override: bypass selector LLM call and selection guards.
    // Used when the selector is structurally unable to pick the intended
    // question (e.g. infrastructure debt #1 — empirical-gate exclusion
    // violated, or a specific branch needs force-closing).
    console.log(`📋 SELECT — manual override (--question ${forceQuestionId})`);
    const allQs = await readQuestions(projectDir);
    const target = allQs.find((q) => q.id === forceQuestionId);
    if (!target) {
      throw new Error(`--question ${forceQuestionId}: question not found in store`);
    }
    if (target.status !== "open") {
      throw new Error(`--question ${forceQuestionId}: status is "${target.status}", must be "open"`);
    }
    if (!target.questionType) {
      throw new Error(`--question ${forceQuestionId}: questionType is missing on the question record`);
    }
    const qType = target.questionType;
    selection = {
      questionId: target.id,
      question: target.question,
      reasoning: `Manual dispatch via --question ${forceQuestionId} (selector bypassed)`,
      relevantFindingIds: [],
      suggestedExpertType: `${target.domain} ${qType} specialist`,
      estimatedIterations: QUESTION_TYPE_ITERATION_CAP[qType] ?? config.maxExpertIterations,
      questionType: qType,
    };
    await appendSpan(projectDir, {
      id: `conductor-${cIterStr}-select`,
      step: "select-question",
      parentId: `conductor-${cIterStr}`,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 0,
      promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
      exitCode: 0, findingsProduced: 0,
      metadata: { event: "SELECTOR_MANUAL_OVERRIDE", forcedQuestionId: forceQuestionId },
    });
  } else {
    console.log("📋 SELECT — choosing highest-value question...");
    const selectStart = Date.now();
    const rawSelection = await selectQuestion(projectDir, cIter, state.questionsExhausted, config);
    await appendSpan(projectDir, {
      id: `conductor-${cIterStr}-select`,
      step: "select-question",
      parentId: `conductor-${cIterStr}`,
      startTime: new Date(selectStart).toISOString(),
      endTime: new Date().toISOString(),
      durationMs: Date.now() - selectStart,
      promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
      exitCode: 0, findingsProduced: 0,
    });

    // Pre-dispatch selection guards: non-open re-dispatch, re-dispatch type-mismatch,
    // same-type cap. Converts prompt rules (CLAUDE.md) into code enforcement.
    const recentTypes = priorMetrics
      .slice(-3)
      .reverse()
      .map((m) => m.questionType)
      .filter((t): t is QuestionType => !!t);
    const allQuestionsForGuards = await readQuestions(projectDir);
    const guardResult = applySelectionGuards(rawSelection, allQuestionsForGuards, recentTypes, priorMetrics);
    selection = guardResult.selection;
    for (const intervention of guardResult.interventions) {
      console.log(`   ⚠ ${intervention.rule}: ${intervention.reason}`);
      await appendSpan(projectDir, {
        id: `conductor-${cIterStr}-guard-${intervention.rule}`,
        step: "select-question",
        parentId: `conductor-${cIterStr}`,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 0,
        promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
        exitCode: 0, findingsProduced: 0,
        metadata: {
          event: "SELECTION_GUARD_INTERVENED",
          rule: intervention.rule,
          originalQuestionId: intervention.originalQuestionId,
          originalType: intervention.originalType,
          correctedQuestionId: intervention.correctedQuestionId,
          correctedType: intervention.correctedType,
          reason: intervention.reason,
        },
      });
    }
  }

  console.log(`   ✓ Selected: ${selection.questionId} — ${truncateLine(selection.question, 60)}`);
  console.log(`   Type: ${selection.questionType} | Expert: ${selection.suggestedExpertType}`);

  // ═══ CALL 2: Create Expert (cap iterations by question type) ═══
  const typeCap = QUESTION_TYPE_ITERATION_CAP[selection.questionType] ?? config.maxExpertIterations;
  const effectiveMaxIter = Math.min(config.maxExpertIterations, typeCap);
  console.log("\n🧬 CREATE — building expert persona...");
  if (effectiveMaxIter < config.maxExpertIterations) {
    console.log(`   Question type "${selection.questionType}" → capped at ${effectiveMaxIter} iterations`);
  }
  const createStart = Date.now();
  const expertConfig = await createExpert(selection, projectDir, cIter, effectiveMaxIter, config.provider);
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-create`,
    step: "create-expert",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(createStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - createStart,
    promptChars: 0, outputChars: expertConfig.persona.length, promptTokensEst: 0,
    outputTokensEst: Math.ceil(expertConfig.persona.length / 4),
    exitCode: 0, findingsProduced: 0,
  });

  // Snapshot knowledge store BEFORE expert loop (experts write directly to findings.jsonl)
  const findingsBeforeDispatch = (await readFindings(projectDir)).length;
  const questionsBeforeDispatch = (await readQuestions(projectDir)).length;

  // ═══ CALL 3: Dispatch Expert Loop (with one retry on zero-finding crash) ═══
  console.log(`\n🔬 DISPATCH — expert running (max ${effectiveMaxIter} iterations)...`);
  const expertStart = Date.now();
  let handoff = await runExpertLoop(expertConfig);

  if (handoff.status === "crashed" && handoff.findings.length === 0) {
    console.log(`\n🔄 RETRY — expert crashed with no findings, retrying with fresh persona...`);
    const retryConfig = await createExpert(selection, projectDir, cIter, effectiveMaxIter, config.provider);
    await writeFile(
      path.join(retryConfig.expertDir, "persona.md"),
      retryConfig.persona,
      "utf-8"
    );
    handoff = await runExpertLoop(retryConfig);
    if (handoff.status === "crashed") {
      console.log(`   ⚠ Retry also crashed — accepting crash result`);
    } else {
      console.log(`   ✓ Retry succeeded: ${handoff.status}`);
    }
  }

  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-dispatch`,
    step: "dispatch-expert",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(expertStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - expertStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: handoff.status === "crashed" ? 1 : 0,
    findingsProduced: handoff.findings.length,
    metadata: { status: handoff.status, iterationsRun: handoff.iterationsRun },
  });

  // Increment expert dispatch count immediately (survives integration crashes)
  await incrementExpertDispatches(projectDir);

  // ═══ CALL 4: Integrate Handoff (skip for zero-finding crashes) ═══
  const integrateStart = Date.now();
  if (handoff.status === "crashed" && handoff.findings.length === 0) {
    console.log("\n📥 INTEGRATE — skipped (crash with no findings)");
  } else {
    console.log("\n📥 INTEGRATE — merging results into knowledge store...");

    // Snapshot knowledge store BEFORE integration rewrite (infrastructure debt #1).
    // Iter-18 destroyed 224 findings via integration clobber — deterministic guard.
    const preIntegrationSnapshot = await snapshotStores(projectDir, cIter, "pre-integration");

    await integrateHandoff(projectDir, handoff, cIter, config);

    // Diff against snapshot; auto-restore on clobber.
    const integrationDiff = await diffStores(projectDir, preIntegrationSnapshot);
    const clobberVerdict = detectClobber(integrationDiff);
    if (clobberVerdict.isClobber) {
      console.log(`   ⚠ STORE_CLOBBER detected (${clobberVerdict.severity}) — restoring pre-integration snapshot.`);
      for (const reason of clobberVerdict.reasons) {
        console.log(`     - ${reason}`);
      }
      await restoreStores(projectDir, preIntegrationSnapshot);
      await appendSpan(projectDir, {
        id: `conductor-${cIterStr}-clobber-restore`,
        step: "integrate-handoff",
        parentId: `conductor-${cIterStr}`,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 0,
        promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
        exitCode: 1, findingsProduced: 0,
        metadata: {
          event: "STORE_CLOBBER_RESTORED",
          severity: clobberVerdict.severity,
          reasons: clobberVerdict.reasons,
          diff: integrationDiff,
          snapshotDir: preIntegrationSnapshot.dir,
        },
      });
    } else if (clobberVerdict.severity === "warning") {
      console.log(`   ⚠ Integration warning (non-blocking):`);
      for (const reason of clobberVerdict.reasons) {
        console.log(`     - ${reason}`);
      }
    }

    // Enforce question status writes from handoff.questionUpdates in case integration
    // missed any (defense against integration-call drift).
    if (handoff.questionUpdates?.length > 0) {
      const currentQuestions = await readQuestions(projectDir);
      for (const update of handoff.questionUpdates) {
        const q = currentQuestions.find((cq) => cq.id === update.id);
        if (q && update.status && q.status !== update.status && update.status !== "open") {
          console.log(`   ℹ Enforcing ${update.status} for ${update.id} (integration drift)`);
          await updateQuestion(projectDir, update.id, {
            status: update.status,
            resolvedAt: cIter,
          });
        }
      }
    }

    // Normalise duplicate question IDs (expert write + integration re-append can collide)
    const questionIdsNormalized = await normalizeQuestionIds(projectDir);
    if (questionIdsNormalized > 0) {
      console.log(`   ✓ Reassigned ${questionIdsNormalized} duplicate question IDs`);
    }

    // Post-integration question-store caps: per-type queue cap, iter-boundary
    // convergence cap, per-dispatch new-question cap. Converts CLAUDE.md
    // prompt rules into code enforcement (infra debt #1 + #3).
    const capActions = await applyQuestionCaps(
      projectDir,
      {
        conductorIteration: cIter,
        landscapeDispatch: selection.questionType === "landscape",
      },
      priorMetrics
    );
    for (const action of capActions) {
      console.log(`   ⚠ ${action.rule}: ${action.reason}`);
      await appendSpan(projectDir, {
        id: `conductor-${cIterStr}-cap-${action.rule}`,
        step: "integrate-handoff",
        parentId: `conductor-${cIterStr}`,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 0,
        promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
        exitCode: 0, findingsProduced: 0,
        metadata: {
          event: "QUESTION_CAP_TRIMMED",
          rule: action.rule,
          removedQuestionIds: action.removedQuestionIds,
          effectiveCap: action.effectiveCap,
          observedCount: action.observedCount,
        },
      });
    }

    // Deduplicate findings (expert writes directly + integration may re-append)
    const deduped = await deduplicateFindings(projectDir);
    if (deduped > 0) {
      console.log(`   ✓ Deduplicated ${deduped} findings from knowledge store`);
    }

    // Enforce [DERIVED] findings must carry derivationChain — downgrade to [ESTIMATED] if not
    const downgraded = await enforceDerivationChains(projectDir);
    if (downgraded > 0) {
      console.log(`   ⚠ Downgraded ${downgraded} [DERIVED] finding(s) to [ESTIMATED]: missing derivationChain`);
    }

    // Enforce [SOURCE] findings must carry a real URL — downgrade to [UNKNOWN] if not.
    // Bare labels ("sprout-social-2026") and bundle citations previously slipped through.
    const sourceDowngraded = await enforceSourceUrls(projectDir);
    if (sourceDowngraded > 0) {
      console.log(`   ⚠ Downgraded ${sourceDowngraded} [SOURCE] finding(s) to [UNKNOWN]: source URL missing or invalid`);
      await appendSpan(projectDir, {
        id: `conductor-${cIterStr}-source-url-missing`,
        step: "integrate-handoff",
        parentId: `conductor-${cIterStr}`,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 0,
        promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
        exitCode: 0, findingsProduced: 0,
        metadata: {
          event: "SOURCE_URL_MISSING",
          downgradedCount: sourceDowngraded,
        },
      });
    }

    // Aggregate source URLs into references/links.md
    await aggregateReferences(projectDir);

    const summaryResized = await enforceSummarySize(projectDir);
    if (summaryResized) {
      console.log("   ✓ Summary regenerated to stay within 2KB");
    }
    const summaryRefreshed = await enforceSummaryFreshness(projectDir);
    if (summaryRefreshed) {
      console.log("   ✓ Summary refreshed from current knowledge store");
    }

    // Update wiki output (non-fatal — wiki is derived, not source of truth)
    try {
      const { updateWiki } = await import("./wiki.js");
      const wikiResult = await updateWiki(projectDir);
      if (wikiResult.written > 0 || wikiResult.archived > 0 || wikiResult.backfilled > 0) {
        console.log(`   ✓ Wiki: ${wikiResult.written} written, ${wikiResult.skipped} unchanged, ${wikiResult.archived} archived${wikiResult.backfilled > 0 ? `, ${wikiResult.backfilled} backfilled` : ""}`);
      }
    } catch (err) {
      console.log(`   ⚠ Wiki update failed: ${(err as Error).message}`);
    }

    // Update global wiki (non-fatal — derived from project knowledge store)
    try {
      const { updateGlobalWikiFromProject } = await import("./global-wiki.js");
      const globalResult = await updateGlobalWikiFromProject(projectDir, projectName);
      if (globalResult.promoted > 0 || globalResult.revoked > 0) {
        console.log(`   ✓ Global wiki: ${globalResult.promoted} promoted, ${globalResult.revoked} revoked, ${globalResult.skipped} skipped`);
      }
    } catch (err) {
      console.log(`   ⚠ Global wiki update failed: ${(err as Error).message}`);
    }

    // Update global expert library (non-fatal — promotes high-scoring experts cross-project)
    try {
      const { promoteExpertsToGlobal } = await import("./global-expert-library.js");
      const expertResult = await promoteExpertsToGlobal(projectDir, projectName);
      if (expertResult.promoted > 0) {
        console.log(`   ✓ Global experts: ${expertResult.promoted} promoted`);
      }
    } catch (err) {
      console.log(`   ⚠ Global expert library update failed: ${(err as Error).message}`);
    }

    // Refresh audit report so output docs track the live store after each dispatch.
    try {
      const { runAudit } = await import("./audit.js");
      await runAudit(projectDir);
      console.log("   ✓ Audit report refreshed");
    } catch (err) {
      console.log(`   ⚠ Audit refresh failed: ${(err as Error).message}`);
    }
  }

  // Compute dispatch-level delta (captures findings written by expert + integration)
  const findingsAfterDispatch = (await readFindings(projectDir)).length;
  const questionsAfterDispatch = (await readQuestions(projectDir)).length;
  const fileDelta = findingsAfterDispatch - findingsBeforeDispatch;
  const handoffDelta = handoff.findings?.length || 0;
  const delta = {
    findingsAdded: Math.max(fileDelta, handoffDelta),
    questionsAdded: questionsAfterDispatch - questionsBeforeDispatch,
  };
  if (fileDelta === 0 && handoffDelta > 0) {
    console.log(`   ℹ File delta was 0 but handoff reports ${handoffDelta} findings (expert wrote directly)`);
  }
  if (delta.findingsAdded > 0 || delta.questionsAdded > 0) {
    console.log(`   ✓ Dispatch delta: +${delta.findingsAdded} findings, +${delta.questionsAdded} questions`);
  }
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}-integrate`,
    step: "integrate-handoff",
    parentId: `conductor-${cIterStr}`,
    startTime: new Date(integrateStart).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - integrateStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: 0, findingsProduced: delta.findingsAdded,
  });

  // Parent span for entire conductor iteration
  await appendSpan(projectDir, {
    id: `conductor-${cIterStr}`,
    step: "conductor-iteration",
    startTime: dispatchStartTime,
    endTime: new Date().toISOString(),
    durationMs: Date.now() - dispatchStart,
    promptChars: 0, outputChars: 0, promptTokensEst: 0, outputTokensEst: 0,
    exitCode: handoff.status === "crashed" ? 1 : 0,
    findingsProduced: delta.findingsAdded,
    metadata: { questionId: selection.questionId, status: handoff.status },
  });

  // Update expert library with dispatch results
  // Landscape and reasoning dispatches produce questions as key output — count both as IG
  const effectiveIG = (selection.questionType === "landscape" || selection.questionType === "first-principles" || selection.questionType === "design-space")
    ? delta.findingsAdded + delta.questionsAdded
    : delta.findingsAdded;
  const pHash = hashPersona(expertConfig.persona);
  const personaRelPath = path.relative(projectDir, path.join(expertConfig.expertDir, "persona.md"));
  await upsertLibraryEntry(
    projectDir,
    pHash,
    selection.questionType,
    selection.question.slice(0, 100),
    selection.suggestedExpertType,
    effectiveIG,
    personaRelPath,
    expertConfig.adaptedFromHash
  );

  // Record success pattern for high-IG dispatches (type-aware thresholds)
  const SUCCESS_PATTERN_THRESHOLD = 5;
  const LANDSCAPE_QUESTION_THRESHOLD = 3;
  const isSuccessfulDispatch =
    handoff.status === "answered" && delta.findingsAdded >= SUCCESS_PATTERN_THRESHOLD;
  const isSuccessfulLandscape =
    selection.questionType === "landscape" &&
    (handoff.status === "answered" || handoff.status === "narrowed") &&
    delta.questionsAdded >= LANDSCAPE_QUESTION_THRESHOLD;
  if (isSuccessfulDispatch || isSuccessfulLandscape) {
    await recordSuccessPattern(selection, expertConfig, handoff, delta, cIter);
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

  // Integration-phase attrition (task #8 curation rate — separate from findingsAdded which reports expert yield)
  const handoffReported = handoff.findings?.length ?? 0;
  const persistedDelta = fileDelta;
  const attritionRate =
    handoffReported > 0
      ? Math.max(0, Math.min(1, (handoffReported - persistedDelta) / handoffReported))
      : 0;
  if (handoffReported > 0 && persistedDelta < handoffReported) {
    console.log(`   ⚠ ATTRITION: expert reported ${handoffReported} findings, ${persistedDelta} persisted (${(attritionRate * 100).toFixed(1)}% attrition)`);
  }

  // Enforce exhaustionReason schema: exhausted status MUST carry a reason
  let effectiveExhaustionReason = handoff.exhaustionReason;
  if (handoff.status === "exhausted" && !effectiveExhaustionReason) {
    console.log(`   ⚠ SCHEMA_VIOLATION: exhausted status without reason; defaulting to strategy-limit`);
    effectiveExhaustionReason = "strategy-limit";
  }

  // Observability: EXHAUSTED_UNRESOLVED (meta-evolution rule: exhausted outcome must close its question)
  if (handoff.status === "exhausted" && handoff.questionUpdates.length === 0) {
    console.log(`   ⚠ EXHAUSTED_UNRESOLVED: ${selection.questionId} exhausted but integration did not close it`);
  }

  // Log metric
  await appendConductorMetric(projectDir, {
    conductorIteration: cIter,
    questionId: selection.questionId,
    expertStatus: handoff.status,
    findingsAdded: delta.findingsAdded,
    findingsPersisted: persistedDelta,
    attritionRate,
    questionsResolved: handoff.questionUpdates.length,
    newQuestionsCreated: delta.questionsAdded,
    innerIterationsRun: handoff.iterationsRun,
    timestamp: new Date().toISOString(),
    ...(effectiveExhaustionReason ? { exhaustionReason: effectiveExhaustionReason } : {}),
    questionType: selection.questionType,
  });

  // Lineage gate: write an entry every iteration (including no-change holds).
  // Deterministic in-code write — does not depend on LLM tool use.
  const noChangeHold =
    handoff.status === "answered" && delta.findingsAdded === 0 && delta.questionsAdded === 0;
  const changeType =
    handoff.status === "exhausted" ? "exhaustion" :
    handoff.status === "killed" ? "strategic" :
    handoff.status === "crashed" ? "infrastructure" :
    handoff.status === "narrowed" ? "narrowed" :
    noChangeHold ? "no-change" : "progress";
  await appendLineageEntry(projectDir, {
    iteration: cIter,
    target: "iteration",
    changeType,
    changeSummary: `${selection.questionType} dispatch on ${selection.questionId}: ${handoff.status}, +${delta.findingsAdded}f, +${delta.questionsAdded}q`,
    reasoning: (handoff.summary || "(no summary)").slice(0, 400),
    scoreBefore: null,
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
  const activeProvider = config.provider ?? "claude";
  console.log(`\n🎼 SEA Conductor v038 — Project: ${projectName}`);
  console.log(`   Provider: ${activeProvider}`);
  console.log(`   Architecture: Conductor (select → create → dispatch → integrate)`);
  console.log(`   Max expert iterations: ${config.maxExpertIterations}`);
  console.log(`   Meta every: ${config.metaEveryN} conductor iterations`);
  console.log(`   Cooldown: ${config.cooldownMs / 1000}s`);
  console.log(`   Press Ctrl+C to stop gracefully\n`);

  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stop requested. Finishing current dispatch...");
    requestConductorStop();
  });

  let totalIterations = 0;
  const projectDir = path.join(SEA_ROOT, "projects", projectName);

  while (!stopping) {
    const loopState = await readConductorState(projectDir);
    if (loopState.conductorIteration > config.maxConductorIterations) {
      console.log(
        `\n🛑 Max conductor iteration reached (${config.maxConductorIterations}).`
      );
      break;
    }

    // Completion gate: stop if no open questions remain (fresh project guard: only if any exist)
    {
      const allQ = await readQuestions(projectDir);
      const openQuestions = allQ.filter((q) => q.status === "open");
      if (openQuestions.length === 0 && allQ.length > 0) {
        const cState = await readConductorState(projectDir);
        cState.status = "completed";
        cState.updatedAt = new Date().toISOString();
        await writeFile(
          path.join(projectDir, "state.json"),
          JSON.stringify(cState, null, 2),
          "utf-8"
        );
        console.log(
          `\n✅ Completion gate — all questions resolved. Project status set to "completed".`
        );
        break;
      }
    }

    const result = await runConductorIteration(projectName, config);
    totalIterations++;

    // Meta-evolution check
    const state = await readConductorState(projectDir);

    if (state.conductorIteration % config.metaEveryN === 0) {
      console.log("\n🧠 META — evolving conductor...");
      await snapshotFile(
        resolveConductorPath(config.provider),
        path.join(SEA_ROOT, "conductor-history")
      );
      const metaPrompt = await assembleConductorMetaPrompt(
        projectDir,
        state.conductorIteration,
        config.provider
      );
      await runAndTrace(
        metaPrompt,
        SEA_ROOT,
        path.join(projectDir, "traces"),
        `conductor-${String(state.conductorIteration).padStart(3, "0")}-meta`,
        config.provider ? { provider: config.provider } : undefined
      );
      console.log("   ✓ Conductor updated");
      await appendLineageEntry(projectDir, {
        iteration: state.conductorIteration,
        target: resolveConductorPath(config.provider),
        changeType: "meta-evolution",
        changeSummary: `meta ran at iter ${state.conductorIteration} (every ${config.metaEveryN})`,
        reasoning: "see conductor-history snapshot for diff; trace at traces/conductor-*-meta",
        scoreBefore: null,
      });
    }

    // Convergence check (advisory — never auto-stops)
    try {
      const { readConductorMetrics, detectConvergenceSignals } = await import("./metrics.js");
      const { readFindings: readF, readQuestions: readQ } = await import("./knowledge.js");
      const [cMetrics, cFindings, cQuestions] = await Promise.all([
        readConductorMetrics(projectDir),
        readF(projectDir),
        readQ(projectDir),
      ]);
      const convergence = detectConvergenceSignals(cFindings, cQuestions, cMetrics);
      if (convergence.isConverging) {
        console.log(`\n⚡ Convergence signals (${convergence.recommendation.toUpperCase()}):`);
        for (const signal of convergence.signals) {
          console.log(`   - ${signal}`);
        }
        if (convergence.recommendation === "stop") {
          // Write convergence report
          const reportDir = path.join(projectDir, "output");
          await mkdir(reportDir, { recursive: true });
          const report = [
            "# Convergence Report",
            "",
            `*Generated: ${new Date().toISOString()}*`,
            `*Conductor iteration: ${state.conductorIteration}*`,
            "",
            "## Signals",
            "",
            ...convergence.signals.map((s) => `- ${s}`),
            "",
            `## Recommendation: ${convergence.recommendation.toUpperCase()}`,
            "",
            "The knowledge frontier appears exhausted. Review wiki/index.md and output/ before continuing.",
            "",
          ].join("\n");
          await writeFile(path.join(reportDir, "convergence-report.md"), report, "utf-8");
          console.log(`   → Report written to output/convergence-report.md`);
        }
      }
    } catch (err) {
      // Convergence check is advisory — never block the loop
    }

    if (!stopping) {
      const nextState = await readConductorState(projectDir);
      if (nextState.conductorIteration > config.maxConductorIterations) {
        continue;
      }
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
  exhaustedQuestionIds: string[],
  config?: ConductorConfig
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
    `conductor-${String(conductorIteration).padStart(3, "0")}-select`,
    config?.provider ? { provider: config.provider } : undefined
  );

  // Parse QuestionSelection from output
  const selection = parseQuestionSelection(result.stdout);

  if (!selection) {
    const rateLimit = detectProviderRateLimit(result.stderr);
    if (rateLimit) {
      throw new Error(
        `Provider rate-limited during question selection (provider=${config?.provider ?? "auto"}): ${rateLimit}. ` +
          `Wait for the quota to reset or top up credits, then resume. Trace: ${path.join("traces", `conductor-${String(conductorIteration).padStart(3, "0")}-select.md`)}`
      );
    }
    throw new Error(
      `Failed to parse question selection from conductor output (exit=${result.exitCode}, stdout=${result.stdout.length}B, stderr=${result.stderr.length}B). Check the trace file.`
    );
  }

  return selection;
}

// Detect common provider rate-limit / quota-exhausted patterns in stderr.
// Returns a short excerpt when matched, null otherwise.
function detectProviderRateLimit(stderr: string): string | null {
  if (!stderr) return null;
  const patterns = [
    /you['']?ve hit your usage limit[^\n]*/i,
    /rate[- ]?limit(?:ed)?[^\n]*/i,
    /quota (?:exceeded|exhausted)[^\n]*/i,
    /429[^\n]*too many requests[^\n]*/i,
    /try again (?:at|in) [^\n]+/i,
    /insufficient[_ ]?quota[^\n]*/i,
  ];
  for (const re of patterns) {
    const m = stderr.match(re);
    if (m) return m[0].trim().slice(0, 200);
  }
  return null;
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

const VALID_QUESTION_TYPES = ["landscape", "kill-check", "data-hunt", "mechanism", "synthesis", "first-principles", "design-space", "divergence"] as const;

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
  conductorIteration: number,
  config?: ConductorConfig
): Promise<void> {
  const prompt = await assembleHandoffIntegrationPrompt(projectDir, handoff);
  const iterStr = String(conductorIteration).padStart(3, "0");

  const result = await runAndTrace(
    prompt,
    projectDir,
    path.join(projectDir, "traces"),
    `conductor-${iterStr}-integrate`,
    config?.provider ? { provider: config.provider } : undefined
  );

  if (result.exitCode !== 0) {
    console.log(`   ⚠ Integration exited with code ${result.exitCode}`);
  } else {
    console.log(`   ✓ Integration complete`);
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

/**
 * Increment totalExpertDispatches immediately after expert dispatch.
 * Separated from advanceConductorState so it survives integration crashes.
 */
async function incrementExpertDispatches(projectDir: string): Promise<void> {
  const state = await readConductorState(projectDir);
  state.totalExpertDispatches += 1;
  state.updatedAt = new Date().toISOString();
  await writeFile(
    path.join(projectDir, "state.json"),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}

async function advanceConductorState(
  projectDir: string,
  handoff: ExpertHandoff
): Promise<ConductorState> {
  const state = await readConductorState(projectDir);

  state.conductorIteration += 1;
  // totalExpertDispatches already incremented by incrementExpertDispatches()
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

  // Deduplication: skip if this conductorIteration already logged
  try {
    const existing = await readFile(filePath, "utf-8");
    const alreadyLogged = existing.trim().split("\n").filter(Boolean).some((line) => {
      try { return JSON.parse(line).conductorIteration === metric.conductorIteration; } catch { return false; }
    });
    if (alreadyLogged) {
      console.log(`   ℹ Metric for conductor iteration ${metric.conductorIteration} already exists — skipping`);
      return;
    }
  } catch {
    // File doesn't exist yet — proceed to append
  }
  await atomicAppendJsonl(filePath, metric);
}

// ── Lineage ──
// Per-iteration audit trail. Reader paths: conductor-context.ts (cross-project meta input),
// context.ts (legacy evolve), loop.ts (legacy single-project loop). Format matches assembleEvolve's
// prompt template at context.ts:516.

interface LineageEntry {
  iteration: number;
  timestamp: string;
  target: string;
  changeType: string;
  changeSummary: string;
  reasoning: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
}

async function appendLineageEntry(
  projectDir: string,
  entry: Omit<LineageEntry, "timestamp" | "scoreAfter"> & { scoreAfter?: number | null }
): Promise<void> {
  const dir = path.join(projectDir, "lineage");
  await mkdir(dir, { recursive: true });
  const full: LineageEntry = {
    timestamp: new Date().toISOString(),
    scoreAfter: null,
    ...entry,
  };
  await atomicAppendJsonl(path.join(dir, "changes.jsonl"), full);
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

// ── Success Patterns ──

async function recordSuccessPattern(
  selection: QuestionSelection,
  expertConfig: ExpertConfig,
  handoff: ExpertHandoff,
  delta: { findingsAdded: number; questionsAdded: number },
  conductorIteration: number
): Promise<void> {
  const patternDir = path.join(SEA_ROOT, "success-patterns");
  await mkdir(patternDir, { recursive: true });

  const rawSlug = selection.suggestedExpertType.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const slug = rawSlug.length > 80
    ? rawSlug.slice(0, 80).replace(/-+$/, "") + "-" + createHash("sha1").update(rawSlug).digest("hex").slice(0, 8)
    : rawSlug;
  const fileName = `${selection.questionType}-${slug}-d${String(conductorIteration).padStart(2, "0")}.md`;

  const content = [
    `# Success Pattern: ${selection.questionType} — ${selection.suggestedExpertType}`,
    ``,
    `## Strategy`,
    `Expert type "${selection.suggestedExpertType}" for ${selection.questionType} question.`,
    `Question: ${selection.question}`,
    ``,
    `## When It Works`,
    `- Question type: ${selection.questionType}`,
    `- Converged in ${handoff.iterationsRun}/${expertConfig.maxIterations} iterations`,
    ``,
    `## Evidence`,
    `- Dispatch: D${conductorIteration}`,
    `- Question: ${selection.questionId}`,
    `- Findings produced: ${delta.findingsAdded}`,
    `- Iterations: ${handoff.iterationsRun}/${expertConfig.maxIterations}`,
    `- Status: ${handoff.status}`,
    ``,
    `## Key Decisions`,
    handoff.summary || "(no summary)",
  ].join("\n");

  await writeFile(path.join(patternDir, fileName), content, "utf-8");
  console.log(`   ✓ Success pattern recorded: ${fileName}`);
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
