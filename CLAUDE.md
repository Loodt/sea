# SEA Conductor

## State
- Conductor version: v013
- Pipeline: plan → research → summarize → synthesize → evaluate → evolve
- Conductor pipeline: select-question → create-expert → expert-loop → integrate-handoff
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Config: per-project pipeline.json (falls back to DEFAULT_PIPELINE)

## Pipeline (inner loop — expert iterations)

| Step | Receives | Produces | Must NOT receive |
|------|----------|----------|-----------------|
| plan | persona, goal, summary.md, last eval | plan.md, skeleton | full prior reports |
| research | plan, source eval criteria | findings.md, references | outputs, persona strategies |
| summarize | FULL raw findings, current knowledge store | updated knowledge/ | output reports, persona |
| synthesize | findings, skeleton, summary.md (from updated store) | report, exp log, trace | raw web pages |
| evaluate | output, rubrics, integrity axioms | reflection (scores block) | persona, goal, plan |
| evolve | evaluation, persona, lineage | updated persona OR no-change entry, lineage | prior reports |

## Conductor Pipeline (outer loop — question dispatch)

| Step | Receives | Produces | Must NOT receive |
|------|----------|----------|-----------------|
| select-question | goal, summary.md, open questions, exhausted list | QuestionSelection JSON (incl. questionType) | prior expert outputs |
| create-expert | question, goal, summary, relevant findings, failure patterns, questionType | expert persona.md | prior expert personas |
| expert-loop | persona, question, relevant findings, convergence criteria | ExpertHandoff JSON | other questions' findings |
| integrate-handoff | handoff JSON, current knowledge store | updated knowledge/, summary.md | expert persona internals |

### Exhaustion-as-Finding
When a dispatch converges as "exhausted", the negative result is itself valuable knowledge. The integration step MUST create a finding tagged `[DERIVED: exhaustive-search]` recording:
- What search space was covered (query types, source categories)
- What specific data was sought and not found
- The implication for the research frontier (e.g., "no published CAPEX data exists for gold chlorination retrofit" informs economic modeling to use estimation rather than literature values)

This prevents future dispatches from re-investigating the same gap and ensures exhausted dispatches contribute to the knowledge store rather than producing zero output.

**Implementation status (v009):** conductor-context.ts integration prompt now includes conditional exhaustion-as-finding instructions when handoff.status === "exhausted".

### Conductor Question Selection
The conductor selects questions by: information gain potential > priority > feasibility > domain data density > staleness > dependency-unlocking. After a question is "answered" or "killed", it is removed from selection. After "exhausted", it is added to the exhausted list and skipped.

**Domain data density (v011):** Questions about well-documented domains (regulatory frameworks, published chemistry, standard engineering) produce 5-10x more findings per iteration than data-sparse domains (facility-specific costs, proprietary process data). D14 (Q017, regulatory permitting) achieved 10.5 F/iter vs 1.9 F/iter baseline. When two questions have similar information gain potential, prefer the data-denser domain — it produces more knowledge per compute.

### Frontier Management
The question backlog grows faster than it shrinks — each productive dispatch generates ~2.3 new questions while resolving ~1. This is healthy in early phases (frontier expansion), but becomes a liability if the backlog grows unbounded without pruning.

**Pruning mode triggers:** When open questions exceed 15 OR the ratio of open:resolved exceeds 2:1 across the last 5 dispatches, the selection step MUST:
1. Prioritize kill-check questions — each kill prunes an entire branch and its downstream questions
2. Deprioritize mechanism questions until the frontier narrows below the threshold
3. Before dispatching a new landscape question, check if any existing open questions overlap its domain — prefer dispatching existing questions over creating new survey scope

**Implementation status (v012):** RESOLVED. conductor-context.ts `assembleQuestionSelectionPrompt` now computes open:resolved:exhausted counts and includes a `⚠ PRUNING MODE ACTIVE` flag when open questions exceed 15 or open:resolved ratio exceeds 2:1. **Current state (sewage-gold D20):** 22 open, 14 resolved, 6 exhausted. Open:resolved ratio 1.57:1. Pruning mode active (>15 open). Question generation rate declining to +1.5/dispatch — frontier stabilizing but composition shifting toward mechanism/data-hunt questions, reducing per-iteration yield.

### Narrowed Dispatch Rebinding
When an expert returns status "narrowed", the question remains open for re-dispatch. The next expert for that question MUST receive the narrowed handoff's findings and summary as additional context — not start from zero. This prevents duplicate work and ensures the second expert builds on verified partial progress.

**Implementation status (v010):** Not implemented. The conductor creates each expert from scratch via `createExpert()` with only the knowledge store as context. Fix: when selecting a question that was previously narrowed, pass the prior handoff's summary and findings into the expert creation prompt via `ExpertConfig.priorNarrowedContext`.

### Question Type Taxonomy
Classify each question before dispatch to inform iteration budgets and selection priority:
- **landscape** — broad survey of a domain or option space. High yield, standard budget (5 iterations). Dispatch first to establish the research frontier.
- **kill-check** — hypothesis falsification ("Is pathway X viable given constraints Y?"). High information density per iteration. Prioritize when multiple open pathways exist — pruning is cheaper than deep-diving.
- **data-hunt** — seeks specific numeric values, costs, or thresholds that may not exist in published literature. High exhaustion risk. Max 3 inner iterations — if no concrete data by iteration 2, early-converge as exhausted.
- **mechanism** — investigates how/why something works. Moderate yield, standard budget.
- **synthesis** — answerable primarily by combining/re-analyzing existing knowledge store findings rather than discovering new data. Very high efficiency (1-2 iterations). Dispatch opportunistically when the knowledge store has sufficient coverage in the relevant domain. Iteration cap: 2. Example: Q025 (sampling strategy design) converged in 1 iteration with 8 findings by synthesizing existing analytical chemistry and facility knowledge.

The question selection step MUST include `questionType` in its output. The conductor applies iteration caps from `QUESTION_TYPE_ITERATION_CAP` (types.ts) — data-hunt capped at 3, synthesis capped at 2. Kill-check questions should be preferred over mechanism questions when the research frontier has >3 open pathways — narrow first, then deepen. Synthesis questions should be dispatched opportunistically as cheap knowledge consolidation wins.

**Implementation status (v011):** `questionType` includes "synthesis" in types.ts and conductor-context.ts. `QUESTION_TYPE_ITERATION_CAP` includes synthesis: 2. Data-hunt expert personas receive early-exhaustion instructions via expert-factory.ts. Expert creation prompt receives the actual iteration cap.

### Expert Convergence
Experts converge to one of five statuses:
- **answered** — question resolved with well-evidenced findings
- **killed** — evidence shows the approach/hypothesis is non-viable (equally valuable)
- **narrowed** — meaningful progress but incomplete answer
- **exhausted** — diminishing returns after max iterations
- **crashed** — all inner iterations exited non-zero (infrastructure failure, not content signal). Question stays open for re-dispatch — NOT added to exhausted list.

**Implementation status (v012):** "crashed" status added to ExpertHandoff type. expert-loop.ts tracks per-iteration exit codes, uses best successful output for forced handoff, and classifies all-crash dispatches as "crashed" (not "exhausted"). conductor.ts skips adding crashed questions to questionsExhausted. Integration prompt includes crash-specific handling (no exhaustion-as-finding for crashes).

### Early Exhaustion Detection
Data-hunt questions (and any question producing zero findings after iteration 2) trigger early convergence:
1. After inner iteration 2: if zero findings AND no concrete data sources cited, cap remaining iterations at 1 (total max 3).
2. The forced handoff must include `earlyExhaustion: true` and a summary of what search space was covered.
3. This saves ~60% of wasted compute on questions that will exhaust (observed: both exhausted dispatches in sewage-gold burned 5/5 iterations for zero output).

**Implementation status (v010):** Data-hunt iteration cap (3) is enforced in conductor.ts via `QUESTION_TYPE_ITERATION_CAP`. Expert personas receive the actual cap (fixed in v010). Mid-loop findings count check in expert-loop.ts is still not implemented (infrastructure debt #9) but the iteration cap makes this less critical.

## Step Gates
Pipeline steps are not independent — downstream steps depend on upstream integrity.
- **Crash gate:** If any step exits non-zero AND produces <100 bytes of output, enter crash recovery (see execution.md). Do NOT silently continue to the next step. **Infrastructure gap:** loop.ts currently logs a warning and continues. Until the code gate exists, agents must self-enforce: if a prior step's output file is empty/missing, flag it and work from the knowledge store only.
- **Crash-score exclusion:** When research crashes (exit 1, 0 bytes), the iteration's evaluation score reflects infrastructure failure, not behavioral quality. These scores MUST NOT trigger persona rollback. The evolve agent should tag crash iterations in lineage. **Infrastructure gap:** `isRegressing()` currently includes all scores — infrastructure crashes can trigger false-positive rollbacks of working personas. Fix: add `crashIteration` flag to Score type, exclude from regression window.
- **research → summarize:** If research crashed, summarize runs on prior knowledge only (no new findings to persist). This is safe — the store stays current, just not advanced.
- **summarize completeness gate:** After summarize completes, count findings persisted to knowledge/findings.jsonl vs findings in scratch/iter-NNN-findings.md. If persisted < produced, log PERSISTENCE_GAP. The evolve step MUST retroactively persist any missing findings. This gate catches silent truncation — the failure mode where a step exits 0 with partial output. (See failure-patterns/silent-truncation-cascade.md)
- **summarize → synthesize:** Synthesize reads from the knowledge store that summarize just updated. Finding IDs referenced in reports MUST exist in knowledge/findings.jsonl. This is architecturally enforced by running summarize first.
- **Why this order:** Summarize before synthesize eliminates phantom IDs, deferred-write failures, and the heuristic-layer-ceiling pattern. The knowledge store is always current before the report is written.

## Hard Rules
- Context budgets per agent: enforced in code (`types.ts` CONTEXT_BUDGETS)
- Persona max 60 lines — consolidate before adding
- Knowledge store is source of truth — not output/ reports
- summary.md max 2KB
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`
- `[UNKNOWN]` over untagged guess — generates follow-up task, not noise
- Anchor comparisons: vs what baseline, by how much, what conditions
- Evaluate agent is independent critic — never sees persona or goal framing
- One change per evolution — hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop from 3-iter rolling average (excluding crash iterations)
- Minimum 2 iterations before judging any change
- Check failure-patterns/ before proposing changes
- New generalizable failures → failure-patterns/
- Step crashes (exit 1 + empty output) trigger crash recovery protocol — never silent bypass
- Evolve MUST distinguish behavioral vs infrastructure failures: if the same failure persists after 2 heuristic-level fixes, classify as infrastructure (needs code/pipeline change) and flag it — do NOT attempt a 3rd heuristic
- Summarize step MUST receive the FULL raw findings file — never truncate the primary input to the persistence layer. The summarize context budget (32KB) exists to accommodate this. Truncating findings before persistence is the root cause of phantom IDs (see v004 defect).
- Score persistence is infrastructure-only: the evaluate agent writes a reflection with a JSON scores block. The loop code (`handleScoring`) parses and persists to scores.jsonl. The evaluate agent MUST NOT write to scores.jsonl directly — dual writes corrupt regression detection.
- ALL failure patterns in failure-patterns/ must be loaded into agent context — no subset limits. Institutional memory is only useful when complete.
- Expert knowledge store writes must be idempotent: experts use F9XX IDs, the integration step reassigns sequential IDs. If the expert already wrote to findings.jsonl, integration must deduplicate by claim text before appending.
- Data-hunt questions capped at 3 inner iterations (enforced in conductor.ts via `QUESTION_TYPE_ITERATION_CAP`)
- Synthesis questions capped at 2 inner iterations — these consolidate existing knowledge, not discover new data

## Evolution Protocol
The evolve step has three valid outcomes:
1. **Behavioral change** — modify persona heuristics, strategies, or scope. Requires: hypothesis, measurement plan, rollback trigger.
2. **Strategic advancement** — update persona targets when questions are resolved or blocked. Requires: evidence the prior target is resolved/blocked, identification of the next highest-value target.
3. **No-change hold** — explicitly declare the behavioral layer is working and no change is needed. Requires: reasoning citing evaluator evidence (e.g., "do not change what is working"). Record a lineage entry with `"changeType": "no_change"` and the reasoning. A no-change decision with good reasoning is higher-value than a marginal tweak that adds noise.

### Stagnation Response
When the evaluate step flags 2 consecutive non-crash iterations with zero new findings AND zero resolved questions:
1. Evolve must classify the cause: exhausted search space, blocked data access, or wrong question
2. Exhausted search space → strategic pivot to a different question (not just different queries for the same question)
3. Blocked data access → mark the question as infrastructure-blocked, pivot to non-blocked targets
4. Wrong question → kill the question, propose a reformulation based on what WAS found

### Expert Evolution vs Conductor Evolution
The conductor operates two evolution levels:
1. **Expert-level (per dispatch):** The expert persona is created fresh for each question — it does not evolve across dispatches. Quality comes from the expert creation framework, not iterative persona refinement.
2. **Conductor-level (meta):** The conductor itself (this file) evolves every N dispatches via meta-evolution, improving question selection, expert creation, and integration quality.

This is a deliberate design choice: experts are disposable specialists, not persistent agents. The knowledge store is the persistent memory, not the expert persona.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20

## Crash Recovery Protocol
Validated in sewage-gold iter-008 through iter-012 (5 consecutive successes, project-high 8.15).
When an agent enters crash recovery:
1. Zero prior-file loading — persona encodes all lessons
2. Single research question — not 3-4
3. Incremental trace logging — persist after each substep, not at the end
4. If still crashes after 2 attempts → infrastructure issue, not agent behavior
5. Crash recovery may be set as default research mode in persona when standard mode consistently fails

## Discovery
1. Ask: goal, success criteria, domain, source prefs, output format
2. Create dirs: knowledge/, scratch/, output/, traces/, experiments/, reflections/, metrics/, lineage/
3. Write: goal.md, persona.md (seeded from failure-patterns/), pipeline.json, state.json
4. Seed persona with all failure-patterns/*.md warnings
5. Seed knowledge/questions.jsonl with 3-5 high-priority domain questions from goal

## Meta-Evolution Protocol
1. Read all project lineage + eval/integrity.md + latest reflections (not just lineage summaries)
2. Read conductor-metrics.jsonl — analyze dispatch efficiency (convergence rate, findings/dispatch, inner iterations used vs max)
3. What patterns compound across projects?
4. Propose specific changes to THIS file (versioner preserves old)
5. Verify protocol matches implementation — read context.ts, loop.ts, types.ts, conductor.ts, expert-factory.ts, expert-loop.ts, conductor-context.ts
6. Flag protocol-code gaps as infrastructure debt with specific fix descriptions
7. Safety Rails section is IMMUTABLE

## Infrastructure Debt
Known gaps between protocol (this file) and implementation (src/). These are logged here so the evolve agent does not attempt heuristic fixes for infrastructure problems — each requires a code change.

1. **Crash gate not enforced in loop.ts** — `runStep()` (line ~114) logs warning on non-zero exit but continues pipeline. Fix: check `exitCode !== 0 && stdout.length < 100` after each step; skip downstream steps on crash; set crash flag on state for score exclusion.
2. **Score deduplication missing in metrics.ts** — `appendScore()` does not check for existing iteration entry. Fix: read existing scores, skip write if iteration already present.
3. **Crash-score tagging missing** — Score type has no `crashIteration` field. Fix: add boolean field to Score interface, set true when research exits non-zero, filter in `isRegressing()`.
4. **Summarize completeness gate not enforced in loop.ts** — no post-summarize check compares findings counts. Fix: after summarize step, count findings in scratch file vs knowledge/findings.jsonl; log PERSISTENCE_GAP if divergent.
5. **Evolution Protocol extraction — RESOLVED in v006** — `extractSection(conductor, "Evolution Protocol")` now matches the `## Evolution Protocol` heading.
6. **Expert factory truncates failure patterns — RESOLVED in v008** — `.slice(0, 5)` removed from `expert-factory.ts`; all failure patterns now loaded.
7. **Expert-integration finding duplication** — Experts write findings directly to `knowledge/findings.jsonl` (expert-loop prompt line 141), then the integration step also writes to the same file. Both use different ID ranges (F9XX vs sequential), but if both execute, claims appear twice. Fix: integration step should read existing findings and skip claims that match by text.
8. **Conductor crash gate — RESOLVED in v012** — expert-loop.ts now tracks per-iteration exit codes and output sizes. All-crash dispatches return status "crashed" (not "exhausted"). Forced handoff uses the best successful iteration's output, not the last output. conductor.ts does not add crashed questions to questionsExhausted. Integration prompt handles crashed status distinctly from exhausted (no synthetic finding for crashes). Q026 and Q030 eligible for re-dispatch.
9. **Early exhaustion detection not in expert-loop.ts** — Expert loop runs all maxIterations regardless of mid-loop findings count. **Partially mitigated in v009:** data-hunt questions capped at 3 iterations via `QUESTION_TYPE_ITERATION_CAP` in conductor.ts. Full fix (mid-loop findings check) still needed for non-data-hunt questions that stall.
10. **Exhaustion-as-finding — PARTIALLY RESOLVED in v009** — conductor-context.ts integration prompt now includes conditional exhaustion-as-finding instructions when handoff.status === "exhausted". Full code-level fix (create synthetic finding in conductor.ts before calling integration) would be more robust.
11. **Evaluate dual-write instruction — MITIGATED in v008** — context.ts evaluate prompt now says "The loop infrastructure will parse this block and persist scores — do NOT write to scores.jsonl yourself." Code-level deduplication in `appendScore()` (debt item #2) still needed as safety net.
12. **QuestionSelection type missing questionType — RESOLVED in v009** — `questionType` field added to `QuestionSelection` and `ExpertConfig` types (types.ts), selection prompt (conductor-context.ts), parsing (conductor.ts), and expert creation (expert-factory.ts). `QUESTION_TYPE_ITERATION_CAP` enforced in conductor.ts.
13. **Expert creation prompt hardcoded MAX_ITERATIONS — RESOLVED in v010** — `expert-factory.ts` line 126 was `MAX_ITERATIONS: ${5}` regardless of actual cap. Data-hunt experts were told they had 5 iterations when capped at 3. Fix applied: `assembleExpertCreationPrompt` now receives and uses the actual `maxExpertIterations` value.
14. **Conductor dispatch log shows wrong cap — RESOLVED in v010** — `conductor.ts` line 69 displayed `config.maxExpertIterations` (always 5) instead of `effectiveMaxIter`. Fixed.
15. **Conductor metric deduplication — RESOLVED in v012** — `appendConductorMetric()` now reads existing metrics and skips write if conductorIteration already has an entry. Prevents duplicate metric lines (as seen with D10).
16. **Narrowed dispatch rebinding missing** — When a question returns "narrowed" and is later re-dispatched, the new expert starts from scratch. The prior narrowed handoff's findings and summary are lost. Fix: store narrowed handoff in expert dir; when creating a new expert for a previously-narrowed question, inject `priorNarrowedContext` into the creation prompt.
17. **Partial crash finding loss — RESOLVED in v012** — expert-loop.ts now tracks the best successful output (highest content length from a non-crashed iteration) and uses it for forced handoff instead of the last (potentially crashed) output. Sub-issue of #8, resolved together.
18. **Frontier size metrics not in selection prompt — RESOLVED in v012** — conductor-context.ts `assembleQuestionSelectionPrompt` now computes open/resolved/exhausted counts, open:resolved ratio, and includes `⚠ PRUNING MODE ACTIVE` flag with explicit instructions when thresholds exceeded.
19. **questionsExhausted stale entries — RESOLVED in v013** — `runConductorIteration` now cleans stale entries from `questionsExhausted` at the start of each iteration. Reads current question statuses and removes any exhausted IDs that have since been resolved by cross-dispatch integration.
20. **Metric undercounting — RESOLVED in v013** — `appendConductorMetric` was using `handoff.findings.length` for `findingsAdded`, which only counted findings in the expert's JSON handoff block. Expert direct-writes to findings.jsonl during iterations and integration synthetic findings (exhaustion-as-finding) were invisible. Fix: `integrateHandoff` now returns the actual knowledge store delta (findingsAfter - findingsBefore); `runConductorIteration` uses the delta for the metric.
21. **Domain-blind finding selection — RESOLVED in v013** — `selectRelevantFindings` in expert-factory.ts took the first N verified/provisional findings regardless of domain relevance. With 384+ findings, experts received mostly irrelevant context. Fix: when the store exceeds 2x the selection cap, findings are scored by keyword relevance to the question text and sorted by relevance before selection. Cross-domain findings still included for serendipitous connections.
22. **Selection prompt missing domain data density criterion — RESOLVED in v013** — conductor-context.ts selection criteria now includes "Domain data density" as criterion #4, matching the protocol's stated ranking order.

## Conductor Dispatch Patterns
Observations from dispatches 1-20 (sewage-gold project). These inform future question selection and expert creation.

### Validated Patterns (dispatches 1-20)
- **Domain-specific experts converge faster than generalists.** Narrow specialists converged in 2-3/5 inner iterations. The expert creation framework's emphasis on "defining trait" and "core values" is working — preserve this.
- **Kill signals are as valuable as answer signals.** Dispatches 2, 4, and 9 all produced high-value convergence by killing pathways. Question selection should not deprioritize questions likely to produce kill signals.
- **Integration validation catches persistence gaps.** The conductor's post-integration check (conductor.ts:265-276) correctly detects when handoff findings weren't persisted. This is the conductor-level equivalent of the summarize completeness gate.
- **Question generation quality determines dispatch efficiency.** Questions that decompose cleanly (one expert, one domain) dispatch better than cross-domain questions.
- **Knowledge accumulation has a compound effect on expert efficiency.** The system went from 1.9 F/iter (D1-5, store ~0-19 findings) to 9.67 F/iter (D12-14, store ~60+ findings) — a 5x improvement. The inflection point appears around ~40-50 verified findings. This is the system's most important emergent property.
- **Kill-check questions are the most iteration-efficient category.** D4 (Q013) killed 6 pathway classes in 4 iterations; D9 (Q019) killed a pathway in 4 iterations with 3 findings. Higher information density because kill signals prune entire branches.
- **Synthesis-ready questions converge in 1-2 iterations (v011).** D12 (Q025, sampling strategy) converged in 1 iteration with 8 findings. The expert synthesized existing knowledge (analytical chemistry + facility data) rather than discovering new data. When the store is rich and the question primarily needs synthesis, experts converge almost instantly.
- **Domain data density drives per-iteration efficiency (v011).** D14 (Q017, regulatory permitting) produced 21 findings in 2 iterations (10.5 F/iter) — the highest single-dispatch yield. Regulatory/compliance domains have abundant, structured, publicly available information. Data-rich domains reliably outperform data-sparse domains by 5-10x per iteration.
- **Frontier composition determines per-iteration efficiency (v013).** D15-D20 averaged 2.1 productive F/iter vs 9.67 in D12-D14. The remaining open questions are mechanism and data-hunt types — harder, narrower, and less amenable to rapid synthesis. Per-iteration efficiency is not a monotonic function of knowledge store size; it depends on the composition of remaining questions. The low-hanging fruit has been picked.
- **Full-budget convergence is normal for mechanism questions (v013).** D17 (Q033, 5 iters), D18 (Q002, 5 iters), D19 (Q039, 5 iters) all used max iterations but converged successfully. Mechanism questions require iterative deepening — building understanding across iterations — unlike landscape/kill-check which find-and-stop. The 2.7 avg iteration count from D1-D14 was skewed by easy early dispatches and should NOT be treated as a universal efficiency target.
- **Exhaustion is bimodal (v013).** Every exhausted dispatch (D3, D5, D10, D13, D16, D20) produced exactly 0 handoff findings and 0 new questions. There is no "partial exhaustion" — dispatches either produce substantial findings or produce nothing. This suggests the current exhaustion-as-finding mechanism (prompt-based, in integration) is not reliably creating synthetic findings. Code-level implementation (debt #10) would be more robust.

### Observed Risks
- **Data-hunt questions have the highest exhaustion risk.** D3 (Q008) and D5 (Q015) both sought specific numeric values not in published literature. Both exhausted at 5/5 iterations with zero findings. **Mitigated in v009:** data-hunt iteration cap at 3.
- **Infrastructure failures masquerade as exhaustion.** D10 (Q026) and D13 (Q030) both showed zero persisted findings across 5 iterations. D10: zero scratch files, no handoff. D13: iteration 1 was productive (6 findings, 7 FBI facilities identified) but iterations 2-5 crashed — findings from iteration 1 were lost. Both misclassified as exhaustion. This is infra debt #8, now confirmed twice. Q026 and Q030 both deserve re-dispatch once crash gate is implemented.
- **Question frontier growth outpaces resolution.** D1-D20: 15 resolved, 37 new = net +22 questions. 22 currently open. **Pruning trigger still exceeded** (>15 open). Resolution rate improving (15/20 = 75% productive) but new question generation still outpaces.
- **Metric-reality divergence (v013).** `findingsAdded` in conductor-metrics.jsonl historically counted handoff findings only — not expert direct-writes to findings.jsonl or integration synthetic findings. Real knowledge growth was ~3x metric values (384 store findings vs ~121 metric sum). **RESOLVED in v013:** metrics now use actual knowledge store delta.
- **Non-capped question types exhaust at full budget (v013).** D16 (Q035, mechanism) and D20 (Q041, mechanism) both burned 5/5 iterations for zero output. Unlike data-hunt (capped at 3), mechanism questions have no early exit. Debt #9 (mid-loop findings check) would prevent this waste for all question types.

### Dispatch Efficiency Summary (sewage-gold, D1-D20)
| Metric | D1-5 | D6-8 | D9-D11 | D12-D14 | D15-D17 | D18-D20 | Overall |
|--------|------|------|--------|---------|---------|---------|---------|
| Total dispatches | 5 | 3 | 3 | 3 | 3 | 3 | 20 |
| Productive (answered/killed) | 3 (60%) | 3 (100%) | 2 (67%) | 2 (67%) | 2 (67%) | 2 (67%) | 14 (70%) |
| Exhausted/crashed | 2 (40%) | 0 (0%) | 1 (33%) | 1 (33%) | 1 (33%) | 1 (33%) | 6 (30%) |
| Total findings | 19 | 24 | 11 | 29 | 21 | 17 | 121 |
| Findings/productive dispatch | 6.3 | 8.0 | 5.5 | 14.5 | 10.5 | 8.5 | 8.6 |
| Productive F/iter | 1.9 | 2.67 | 1.43 | 9.67 | 2.63 | 1.7 | 2.6 |
| Total inner iterations | 20 | 9 | 12 | 8 | 13 | 15 | 77 |
| Wasted iterations (exhausted) | 10 (50%) | 0 (0%) | 5 (42%) | 5 (63%) | 5 (38%) | 5 (33%) | 30 (39%) |
| Questions resolved | 4 | 3 | 2 | 2 | 2 | 2 | 15 |
| New questions generated | 9 | 9 | 5 | 5 | 4 | 5 | 37 |

**Trends:**
- D12-D14 was a peak: 9.67 productive F/iter driven by synthesis (Q025) and data-rich domain (Q017) dispatches. This was not a permanent inflection — it reflected question-type composition, not a regime change.
- D15-D20 returned to baseline-range efficiency (2.1 productive F/iter) as the frontier shifted to mechanism questions. This is expected, not a regression — mechanism questions require deeper iterative work and produce fewer but higher-value findings.
- D17 (Q033, gas Cl2 vs NaOCl): 12 findings in 5 iterations. Full-budget but productive — validates that mechanism questions legitimately need the full iteration budget.
- D16 (Q035) and D20 (Q041): both exhausted at 5/5, producing 0 findings. Neither was data-hunt typed, so no iteration cap applied. Mid-loop early-exit (debt #9) would have saved 6-8 wasted iterations across these two dispatches.
- Productive rate stable at 67% per wave (D9-D20). Exhaustion rate of 1-in-3 is the new baseline for frontier mechanism/data-hunt questions.
- Net question growth: +1.5/dispatch (D15-D20) vs +2.3 (D1-D5). Frontier expansion is decelerating. 22 open questions remain — pruning mode still active.
- Knowledge store: 384 findings (32 verified, 343 provisional, 8 superseded). The store is rich enough that synthesis dispatches should be opportunistically generated.

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
