# SEA Conductor

## State
- Conductor version: v067
- Outer loop: select-question -> create-expert -> expert-loop -> integrate-handoff (4 LLM calls per iteration)
- Knowledge layer: `findings.jsonl` + `questions.jsonl` + `summary.md` per project
- Multi-provider: `--provider`, `SEA_PROVIDER`, or harness auto-detect (`CLAUDECODE` / `CODEX_CLI`). Config in `types.ts`
- Dispatch-pattern evidence lives outside agent context in `dispatch-patterns.md` and `docs/dispatch-observations.md`

## Question Selection & Types
Rank by: closure probability per research cost > decision relevance > information gain > priority > feasibility > data density > staleness > dependency unlocking.
**Selection guards:** Reject non-open and near-duplicate open questions first. Never reclassify on re-dispatch. `answered`, `killed`, `exhausted`, and `empirical-gate` IDs stay quarantined until a new blocker, failed verification, or dependency change explicitly reopens them.
**Crash priority:** Crashed questions dispatch next and do not interleave. If a crash produced >=5 findings, its re-dispatch outranks any new branch until it resolves, exhausts, or crashes twice consecutively.
**Pressure modes:** Pruning mode triggers when open >15 OR open:resolved >2:1; prefer existing branches, boost `kill-check`, `mechanism`, and branch-local reasoning, cap new questions at 1 when >3:1 and 0 when >4:1. Closure sprint triggers when the last 8 dispatches have attrition = 0 and resolved >=6; stay on existing branches, block new `landscape`/`data-hunt` unless they directly unlock an open `kill-check` or empirical gate, and keep at least 2 of every next 3 dispatches on `kill-check`, `mechanism`, `synthesis`, or final-decision reasoning.
**Late-stage bias:** In closure sprint, with metric quarantine, or once >70% of questions are resolved, break ties by branch/open-count reduction, then `questionsResolved`, then inner-iteration efficiency, then `findingsAdded`. Treat `answered` + 0 resolved as evidence gain, not closure.
**Observed-yield bias:** Recent multi-project evidence treats `kill-check` and `mechanism` as the default highest-yield closure types, with `synthesis` next when a branch already has a productive store. `landscape` is mainly for early mapping or certification/regulatory branch creation.
**Bootstrap exploitation:** Treat the first productive `landscape` or `data-hunt` on a branch as a wedge, not a lane. If it answers with >=10 findings or creates the branch's main decision queue, the next same-branch dispatch must be `kill-check` or `mechanism` unless the branch still lacks a falsifiable or causal target.
**Metric fallback:** If any of the last 10 metric events has missing/empty `eventId`, missing `openQuestionsDelta`, negative `newQuestionsCreated`, `EVENT_ID_COLLISION`, or `METRIC_SEMANTICS_DRIFT`, creation metrics are quarantined. Compute pressure, branch expansion, and thin-closure checks from the live question store plus branch open-count deltas only until semantics are repaired.
**Reasoning prerequisites:** `first-principles` and `design-space` require at least 5 verified OR 20 SOURCE-tagged in-domain findings. `synthesis` requires >=50 findings OR >=25 verified, becomes mandatory after 8 dispatches since last synthesis (5 when store >100) if store growth since then >15, and is capped at 2 uses in any 6-dispatch window.
**Type routing:** Max 2 consecutive dispatches of the same type. After iter 4, `first-principles` and `design-space` are mandatory once prerequisites exist and they have never been dispatched. Cap `data-hunt` at 5 before a reasoning type.
**Reasoning discipline:** In thin-closure mode, or after 2 same-branch reasoning answers inside 4 dispatches, prefer `kill-check`, `mechanism`, or branch-reducing `synthesis` over more same-branch `design-space`/`first-principles` unless the reasoning dispatch closes the final live decision, converts a blocker into `empirical-gate`, or directly unlocks an immediate sibling `kill-check`/`mechanism`. If >=4 of the last 6 answered dispatches are `design-space`/`first-principles` and median `findingsAdded <=6`, the next same-branch dispatch must harden or prune.
**Branch routing:** If >50% of open questions are `design-space`, if 3 related reasoning/synthesis answers land without a sibling `mechanism`/`kill-check`, or if a branch closes 2+ related questions through reasoning without any hardening pass, elevate `mechanism` or `kill-check` above more branch-local reasoning unless the only blocker is empirical measurement.
**Data-hunt admission:** After iter 12, or in closure sprint, dispatch `data-hunt` only when the missing value can still change branch viability, acceptance criteria, or empirical-gate labeling. Otherwise absorb the uncertainty into `synthesis`, `first-principles`, or `design-space`.
**Harvest discipline:** Any `exhausted` dispatch with >=12 findings is a harvested frontier. The next dispatch on that branch, or within the next 2 dispatches for `data-gap`/`strategy-limit`, must exploit the harvest with `synthesis`, `first-principles`, `design-space`, `mechanism`, or a sibling `kill-check`. Do not open a fresh `landscape` or `data-hunt` branch while a harvested frontier remains inside its exploit window.
**Yield conversion:** After iter 6, if the last 3 dispatches added >=30 findings but resolved <=1 question, if 2 of the last 5 dispatches ended `exhausted` with findingsAdded >=8 and resolved 0, or if 2 same-branch answered dispatches landed with attrition = 0 and median findingsAdded >=10, the next dispatch must be exploitative reasoning, `kill-check`, or `mechanism` on that existing branch.
**Question creation caps:** `landscape` <=5 new; non-`landscape` <=3. Iter 12 + open >12 -> cap 1. Iter 15+ -> cap 1. Iter 18 + open >8 -> cap 0. Iter 20 + >70% resolved -> cap 0 for non-`kill-check`.
| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey, then stop reopening once the store is clearly productive |
| kill-check | 5 | Fastest branch-pruner; never deprioritize it when >3 open pathways exist |
| data-hunt | 5 | Specific values; repeated exhaustions mean exploit the store instead of expanding sideways |
| mechanism | 5 | Highest-confidence branch hardener after survey or reasoning passes |
| synthesis | 3 | Best harvested-frontier converter and final-mile consolidator; must resolve the question or net-reduce open count |
| first-principles | 3 | Derive from axioms plus verified findings; use to close decision boundaries, not restate mature branches |
| design-space | 4 | Map constraints to concrete choices only when it closes a live decision |
| divergence | 3 | Experimental white-space provocation after iter >=6 and clustered dispatches |

## Expert Convergence
- **answered** - resolved with well-evidenced findings
- **answered** with `questionsResolved = 1` in <=2 inner iterations is efficient closure even if findings are modest
- **killed** - non-viable; equally valuable as answered
- **narrowed** - partial progress; re-dispatch must include prior handoff findings. Same question narrowed >=2 times with declining yield -> evaluate for exhaustion
- **exhausted** - diminishing returns. Subtypes: `data-gap` | `strategy-limit` | `infrastructure`. Integration must create `[DERIVED: exhaustive-search]`. Data-gap auto-gates dependent questions and may create at most 1 concrete dependent question
- **crashed** - infrastructure failure. Not exhaustion; re-dispatch eligible. Integrate partial findings before persona reset
- **empirical-gate** - requires physical measurement; do not re-dispatch. Auto-gate dependent questions
- For `first-principles`/`design-space`, `narrowed` + `empirical-gate` is successful and should not be penalized

## Expert Pacing & Library
Search budget per iteration by question type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iterations get budget + 2. Budget does not limit file reads or knowledge-store writes.
Personas live in `expert-library/library.jsonl`. Utility = avgIG x log(dispatches + 1). Factory selects persona with utility >2.0; adapt if parent score >=5.0, otherwise create fresh. High-scoring personas (>=2.0, dispatches >=2) promote to `global-expert-library.jsonl`.

## Finding Graduation
Provisional -> verified when confidence >=0.85, tag = SOURCE with URL, age >=3 dispatches, and not contradicted. Fast-track: SOURCE with confidence >=0.90 graduates after 2 dispatches.
DERIVED graduates when confidence >=0.90, derivationChain has >=2 premises, all premises are verified, age >=3, and not contradicted. Trust cascade: axioms -> SOURCE -> DERIVED.
`[DERIVED]` without derivationChain is knowledge debt; integration must downgrade it to `[ESTIMATED]`.

## Step Gates
- **Crash gate:** 2 consecutive crashes -> circuit breaker and forced handoff. Recovery: zero prior-file loading, single question, 2 attempts -> infrastructure. Crash scores never trigger rollback
- **Persistence gate:** Persisted findings must match produced findings; log `PERSISTENCE_GAP` if not. Summarize before synthesize; persisted IDs must exist in `findings.jsonl`
- **Closure-quality gate:** answered + 0 findingsAdded -> `HOLLOW_ANSWER`. answered + `questionsResolved = 1` + `findingsAdded <=4` -> `THIN_CLOSURE` unless it is the final open question on that branch. Repeated thin or non-closing answers on the same branch force the next dispatch to harden or prune unless only one open question remains
- **Closure-integrity gate:** Two harvested frontiers inside 3 dispatches without an exploitative follow-up -> `HARVEST_CHAIN` and force exploitative reasoning next. In closure sprint, opening a new question without resolving or unblocking an existing branch -> `CLOSEOUT_DRIFT`. Reopening the same branch within 2 dispatches after a <=2-iteration closure without a new blocker, verification failure, or sibling dependency -> `CLOSURE_CHURN`
- **Survey-overhang gate:** After a same-branch `landscape` or `data-hunt` answer with `findingsAdded >=10` and attrition = 0, another survey-type dispatch on that branch before a sibling `kill-check`/`mechanism` logs `SURVEY_OVERHANG` unless the missing fact is explicitly decision-critical
- **Survey-overhang follow-up:** If `SURVEY_OVERHANG` is justified (explicit decision-critical missing fact), the next same-branch dispatch must be `kill-check` or `mechanism` (no third survey in a row).
- **Reasoning-drift gate:** In thin-closure mode, or when 3 of the last 5 answered closures resolve with `findingsAdded <=4`, a same-branch `first-principles`/`design-space` dispatch that does not reduce sibling uncertainty logs `FINAL_MILE_REASONING_DRIFT`; the next dispatch on that branch must be `kill-check`, `mechanism`, or `synthesis`
- **Design/harvest drift gate:** Dispatching more same-branch `design-space` or `synthesis` against branch-closure routing logs `DESIGN_SPACE_OVERHANG` or `SYNTHESIS_SPIN`. Opening a fresh `landscape`/`data-hunt` branch while any harvested frontier remains inside its exploit window logs `HARVEST_DRIFT`. A harvested-frontier exploit that neither cites >=3 harvested findings nor reduces open count logs `HARVEST_UNDERUSED`
- **Verification floor:** After iter 8 with verified/total <30%, or once >60% of questions are resolved, boost `kill-check` and `synthesis` and penalize low-leverage `design-space`. Completed project <30% verified -> `LOW_VERIFICATION_COMPLETION`
- **Dispatch integrity:** Never dispatch `answered`, `killed`, `empirical-gate`, or `exhausted` questions. If iteration advances without dispatch, log `DISPATCH_GAP`. If `questionsAfter = 0` but `questionsBefore > 0`, treat as `QUESTION_STORE_WIPE`, restore from snapshot, then normalize IDs
- **Metric gate:** Metrics are dispatch-event records, not iteration-unique records. Persist `eventId` and dedupe by event identity (fallback identity = `${conductorIteration}:${questionId}`), never by `conductorIteration` alone. `newQuestionsCreated` is gross kept creation count and must never be negative; net open movement belongs in `openQuestionsDelta` (may be negative). Violations log `EVENT_ID_COLLISION` or `METRIC_SEMANTICS_DRIFT`
- **Exhaustion gate:** exhausted + 0 questionsResolved must close the question as exhausted/deferred or log `EXHAUSTED_UNRESOLVED`
- **Store-growth gate:** If the last 8 dispatches have attrition = 0 and findingsPersisted/findingsAdded >=0.95, treat the store as healthy and prefer closure-quality corrections over exploratory expansion
- **Completion / lineage / summary gate:** All questions resolved (0 open) -> status `completed`. Evolve must produce a lineage entry every iteration, including no-change holds. `summary.md` <=2KB via `enforceSummarySize()`
- **Crash salvage gate:** A crashed dispatch with findingsAdded >=5 must persist those findings and cite them in the next handoff for that question, or log `CRASH_FINDINGS_DROPPED`

## Hard Rules
- Launch `sea conduct` / `sea loop` as background tasks; wait for notification, do not poll
- Keep stdout/stderr visible for short commands (<5 min). For hours-scale Codex runs, prefer a visible separate terminal; if redirected, immediately emit exact tail commands. Do not use `tee` as the default split-stream strategy
- On Windows Codex, prefer explicit `--provider codex` launch in visible `cmd.exe`; do not use PowerShell's `npx` shim. Preferred pattern: `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', 'cd /d <repo> && node dist/cli.js --provider codex <conduct|loop> <project>') -PassThru`
- Context budgets per agent: `types.ts` `CONTEXT_BUDGETS`. Personas stay full length; iter 1 uses file reference + critical sections (~6KB cap)
- Knowledge store is the source of truth, not `output/` reports
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`. Prefer `[UNKNOWN]` over an untagged guess
- Evaluate agent is an independent critic and never sees persona or goal framing
- One evolution change at a time: hypothesis + measurement + rollback trigger. Rollback-first on >15% score drop from the 3-iteration rolling average, excluding crashes; wait at least 2 iterations before judging
- Evolve: 2 heuristic failures on the same issue -> classify as infrastructure and stop retrying heuristics
- Summarize must receive full raw findings; never truncate (32KB budget). Pattern library: load all failure patterns. New generalizable patterns go in `failure-patterns/` or `success-patterns/`
- Expert store writes are idempotent: F9XX IDs sequential, dedupe by ID and claim text. For `landscape`/`first-principles`/`design-space`, IG = findingsAdded + questionsAdded
- Reasoning-type findings use `[DERIVED]` with derivationChain. No `[SOURCE]` without URL. Findings without epistemic tags must not be persisted
- Kill signals prune entire branches; never deprioritize `kill-check`. Metric `questionType` must match the question record type; no silent reclassification at dispatch
- The selector must never dispatch a previously `answered` question ID. Branch continuation after closure requires a distinct reopened/dependent record with explicit lineage to the closed question

## Evolution Protocol
Valid outcomes:
1. **Behavioral change** - modify persona. Requires hypothesis, measurement, rollback trigger
2. **Strategic advancement** - update targets when questions are resolved or blocked
3. **No-change hold** - declare working. Record lineage with reasoning. Default to hold when composite >=6.5 and findingsAdded >=5; in thin-closure mode, also default to hold when closure is clean and the only issue is modest findings per dispatch
**Stagnation:** 2 consecutive non-crash iterations with zero findings and zero resolved -> classify as exhausted, blocked, or wrong.
**Empirical plateau:** >2 questions exhausted as "needs measurement" and remaining open questions depend on them -> flag project empirical-gated.
**Escalation enforcement:** Same heuristic failure across 2+ projects -> escalate to infrastructure debt, not another persona heuristic.
**Meta-evolution:** Read lineage + metrics, identify cross-project patterns, verify protocol against code, then propose changes. Prefer tightening selector and gates over adding new prompt heuristics when the current expert types are already closing questions. In late-stage clean-closure runs, treat repeated low-yield reasoning closures as routing debt first, not persona debt. If a proposed rule depends on durable counters, branch lineage, or event identity, escalate it to infrastructure debt after one failed prompt-only retry. Safety Rails are IMMUTABLE.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Infrastructure Debt
Open gaps that require code, not heuristics:
1. **Branch-local state & closure observability** (HIGH) - hardening debt, harvested-frontier exploit windows, closure churn, same-branch drift, thin-closure mode, sibling-uncertainty reduction, and branch-local closure stats still rely partly on prompt compliance instead of durable branch state
2. **Metric semantics & event identity** (HIGH) - remaining: backfill legacy metrics + hard collision detection; keep expanding the clean split (`newQuestionsCreated` gross, `openQuestionsDelta` net, plus `closureType` / sibling deltas) so resumed runs, crash backfills, and same-iteration multi-dispatch cases cannot collide or report negative creation

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
