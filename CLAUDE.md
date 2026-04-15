# SEA Conductor

## State
- Conductor version: v047 (jarvis-architecture iter 0-26: 27/48 answered, 1 exhausted, avg 16.4 f/dispatch; 170 findings (53 verified, 31%). 20 open (18 dispatchable) — 13 design-space at 3.25× cap. Kill-check: 9/27 dispatches at 10.9 avg yield vs mechanism 24.0 at 7%)
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff (4 LLM calls per iteration)
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Multi-provider: `--provider`, `SEA_PROVIDER`, or harness auto-detect. Config in `types.ts`.

## Question Selection & Types
Rank by: decision-relevance per research cost > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
**Selection guards:** FIRST reject non-open questions and near-duplicate open questions. Crashed questions dispatch next. Never reclassify type on re-dispatch. Empirical-gate questions excluded from effective open count for convergence gates.
**Queue pressure:** Pruning mode when dispatchable open >15 OR open:resolved >2:1. Boost kill-check/synthesis, deprioritize mechanism, prefer existing over new. Escalation: >3:1 → cap new at 1; >4:1 → cap new at 0.
**Store maturity:** Total findings >60 OR verified >30 → boost synthesis below never-dispatched. newQuestionsCreated = 0 for 2+ dispatches and iter ≥4 → frontier mapped; boost synthesis/first-principles on existing.
**Exploit mode:** Last 4 dispatches answered/killed with attrition = 0 and avg findingsAdded ≥9 → next must exploit store: synthesis if eligible, else mechanism or first-principles. No new landscape/data-hunt unless it unblocks kill-check.
**Mechanism promotion:** First-principles/design-space answered in ≤2 inner iters and related open mechanism exists → boost above new landscape/data-hunt. iter ≥8 and 2+ branch questions resolved by reasoning without mechanism on that branch → elevate mechanism. Fast reasoning wins → operational understanding before more derivation.
**Hot-streak conversion:** 2 of last 3 dispatches are reasoning/synthesis answers in ≤2 inner iters and related mechanism/kill-check is open → dispatch that branch-closer next.
**Synthesis cadence:** Requires ≥50 findings OR ≥25 verified. After 8+ dispatches since last (5 when >100) if store grew >15. Velocity: mandatory when 0 ever run and store >60. Ceiling: max 2 in 6-dispatch window. Must resolve its question or net-reduce open count; new questions capped at 1. 2× exhaustion in project → first-principles before retry.
**Question creation caps:** landscape ≤5; non-landscape ≤3. Iter 12 + open >12 → 1. Iter 15+ → 1. Iter 18 + open >8 → 0. Iter 20 + >70% resolved → 0 for non-kill-check.
**Closure mode:** After iter 6: last 3 added ≥30 findings but resolved ≤1 → force synthesis/first-principles/design-space. Last 5 created 0 new and resolved ≥4 → closure mode (≥2 of 3 dispatches on existing consolidation). Last 6 resolved ≥5 and created ≤1 → late-stage: block new landscape/data-hunt unless it unlocks kill-check or empirical gate.
**Type-queue drain:** Type >2× cap in open queue → next synthesis scoped to that type's consolidation. >3× → drain mode: kill-check also targets that type. Block type creation when open > cap for that type.
**Kill-check yield guard:** Kill-check ≥30% of total dispatches AND avg yield <60% of project avg → max 1 kill-check in 6-dispatch window. Prefer mechanism/data-hunt for branch validation when they have higher expected yield.
**Type rotation:** Max 2 consecutive same-type dispatches. After iter 4, first-principles and design-space mandatory once prerequisites exist and never dispatched. 6+ dispatches since reasoning type + store growth >40 → boost reasoning. Cap data-hunt at 5 before reasoning type. Open questions with 0 dispatches at iter >10 → priority boost regardless of type.
**Yield decay + exhaustion:** Same type ≥3× and latest yield <50% of type avg → deprioritize and rotate. ≥2 low-yield (<10) exhaustions in 4 dispatches → force synthesis or first-principles. 0 findings by inner iter 2 → early-exit. Exhausted ≥12 findings = harvested frontier → next on branch must be synthesis/reasoning/kill-check, not another data-hunt.
| Type | Cap | Guidance |
|------|-----|----------|
| landscape | 5 | Broad survey. Dispatch first; stop reopening once store is productive. |
| kill-check | 5 | Falsify hypotheses. Prefer >3 open pathways. Yield-guard throttles overuse. |
| data-hunt | 5 | Specific values. Highest yield early. Low-yield exhaustion = frontier, not wall. |
| mechanism | 5 | How/why. Multi-iter convergence normal. Boost after reasoning wins or iter 10+. |
| synthesis | 3 | Combine findings. Scope to cluster. Must net-reduce questions. |
| first-principles | 3 | Axioms + verified. Mandatory after iter 4. <5 findings = thin prerequisites. |
| design-space | 4 | Constraints → solutions. Auto-generate when ≥3 mechanism/data-hunt resolved. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable; equally valuable as answered
- **narrowed** — partial. Re-dispatch includes prior handoff. ≥2 narrowed with declining yield → evaluate for exhaustion.
- **exhausted** — diminishing returns (data-gap | strategy-limit | infrastructure). Integration creates `[DERIVED: exhaustive-search]`. Data-gap auto-gates dependents.
- **crashed** — infrastructure failure. Re-dispatch eligible. Integrate partial findings before persona reset.
- **empirical-gate** — requires physical measurement; do not re-dispatch. Auto-gate dependents.
- For first-principles/design-space: narrowed + empirical-gate is successful.

## Expert Pacing & Library
Search budget by type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iters: budget + 2. Budget does not limit file reads or store writes.
Personas in `expert-library/library.jsonl`. Utility = avgIG × log(dispatches + 1). Select >2.0; adapt if parent ≥5.0, else fresh. Promote (≥2.0, dispatches ≥2) to `global-expert-library.jsonl`.

## Finding Graduation
Provisional → verified: confidence ≥0.85, SOURCE with URL, age ≥3 dispatches, not contradicted. Fast-track: SOURCE ≥0.90 after 2 dispatches.
DERIVED: confidence ≥0.90, derivationChain ≥2 premises (all verified), age ≥3, not contradicted. Trust cascade: axioms → SOURCE → DERIVED.
`[DERIVED]` without derivationChain → integration downgrade to `[ESTIMATED]`.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker + forced handoff. Recovery: zero prior-file loading, single question, 2 attempts → infrastructure. Crash scores never trigger rollback.
- **Persistence gate:** Persisted must match produced (log `PERSISTENCE_GAP`). Summarize before synthesize; finding IDs must exist in `findings.jsonl`.
- **Hollow answer:** answered + 0 findingsAdded → log `HOLLOW_ANSWER`. >2 in project → review convergence.
- **Completion:** 0 open → `completed`. Conductor skips completed.
- **Verification floor:** 8+ dispatches with verified <30% OR >75% resolved → boost kill-check + synthesis. Completed <30% → `LOW_VERIFICATION_COMPLETION`.
- **Lineage:** Every iteration including holds. Missing lineage = silent drift.
- **Same-type cap:** 3rd consecutive dispatch of one type → hard block.
- **Dispatch integrity:** Never dispatch non-open. Iteration without dispatch → `DISPATCH_GAP`. 2+ gaps in 5 iters → diagnose selector.
- **Store integrity:** Pre-integration snapshot via `store-snapshot.ts`. Clobber (auto-restore): zero-out, >50% loss, or verified finding removed. `STORE_CLOBBER_RESTORED` logged.
- **Harvest/closure gate:** 2 harvested-frontier in 3 dispatches without reasoning → force synthesis/first-principles/design-space. Closure-mode new question without unblocking → `CLOSEOUT_DRIFT`.
- **Non-closing answer:** 2 answered with questionsResolved=0 in 4 iters → force existing-question kill-check/mechanism/synthesis.
- **Thin-closure:** 2 answered with resolved≥1 but findings≤4 in 4 iters → force mechanism or kill-check.
- **Exhaustion gate:** exhausted + 0 resolved → close as exhausted/deferred or log `EXHAUSTED_UNRESOLVED`.
- **Summary size:** ≤2KB via `enforceSummarySize()`.

## Hard Rules
- Launch `sea conduct` as background task; wait for notification, do not poll.
- Keep stdout/stderr visible for long-running commands.
- Context budgets: `types.ts` CONTEXT_BUDGETS.
- Personas full length; iter 1: file reference + critical sections (~6KB cap).
- Knowledge store is source of truth, not `output/` reports.
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`. Prefer `[UNKNOWN]` over untagged.
- Evaluate agent is independent critic; never sees persona or goal.
- One evolution change at a time: hypothesis + measurement + rollback trigger.
- Rollback-first on >15% score drop (3-iter rolling avg, exclude crashes); min 2 iters.
- 2 heuristic failures on same issue → classify as infrastructure.
- Summarize receives FULL raw findings (32KB budget).
- Pattern library: all failure patterns loaded. New → failure-patterns/ or success-patterns/.
- Store writes idempotent: sequential IDs, dedupe by ID + claim. Landscape/first-principles/design-space IG = findingsAdded + questionsAdded.
- Reasoning findings: `[DERIVED]` with derivationChain. No `[SOURCE]` without URL. Untagged → reject or `[UNKNOWN]`.
- Thin store guard: first-principles/design-space need ≥5 verified OR ≥20 SOURCE-tagged. Synthesis: ≥50 findings OR ≥25 verified.
- Kill signals prune branches; never deprioritize kill-check.
- questionType must match question record type; no silent reclassification.

## Evolution Protocol
Valid outcomes: (1) **Behavioral change** — persona mod with hypothesis + measurement + rollback trigger. (2) **Strategic advancement** — update targets. (3) **No-change hold** — default when composite ≥6.5 and findingsAdded ≥5.
**Stagnation:** 2 consecutive non-crash iters with 0 findings + 0 resolved → classify exhausted/blocked/wrong.
**Empirical plateau:** >2 exhausted "needs measurement" + remaining depend on them → project empirical-gated.
**Escalation:** Same heuristic failure across 2+ projects → infrastructure debt.
**Meta-evolution:** Lineage + metrics → cross-project patterns → verify vs code → propose. Safety Rails IMMUTABLE.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Infrastructure Debt
Code-required gaps:
1. **Selector-state enforcement** (HIGH) — Exploit mode, closure, non-closing answer, mechanism debt, thin-closure: all prompt-only. Need persistent branch-local state + code guard.
2. **SOURCE fast-track graduation** (MEDIUM) — Code uses 3-dispatch aging; playbook says 2 for ≥0.90 SOURCE.
3. **Observability** (MEDIUM) — PERSISTENCE_GAP, HOLLOW_ANSWER, DISPATCH_GAP, EXHAUSTED_UNRESOLVED: emit consistently.

### Closed
- ~~**Findings store snapshot/restore**~~ — `src/store-snapshot.ts` + wired into `conductor.ts` before integrate. Auto-restore on zero-out, >50% loss, or verified removal. `STORE_CLOBBER_RESTORED` span logs full diff.
- ~~**Type-creation enforcement + convergence caps**~~ — `src/question-caps.ts` runs post-integration: per-type queue cap (block when open > dispatch cap), iter-boundary caps (12/15/18/20), per-dispatch new-question cap (landscape ≤5, other ≤3). `QUESTION_CAP_TRIMMED` span per trim.
- ~~**Same-type cap + re-dispatch guard**~~ — `src/selection-guards.ts` runs pre-dispatch: non-open re-dispatch swap, re-dispatch type-mismatch correction (scoped to questions with prior metric only), same-type 3rd-consecutive swap. `SELECTION_GUARD_INTERVENED` span per intervention.
- ~~**Lineage writer**~~ — `appendLineageEntry` in `conductor.ts` runs after every iteration's metric write (changeType derived from outcome: progress/no-change/exhaustion/strategic/infrastructure/narrowed) and after meta-evolution (target = playbook path). Was prompt-only and never fired in conductor architecture (no separate evolve step). Historical iters of jarvis-architecture have no lineage; future iters populate `lineage/changes.jsonl`.

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
