# SEA Conductor

## State
- Conductor version: v049 (iter 30-35 validated branch-closing value from synthesis/mechanism/kill-check; design-space remains useful only when it compiles a real choice point into closure.)
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff (4 LLM calls per iteration)
- Knowledge layer: `findings.jsonl` + `questions.jsonl` + `summary.md` per project
- Multi-provider: `--provider`, `SEA_PROVIDER`, or harness auto-detect (`CLAUDECODE` / `CODEX_CLI`). Config in `types.ts`.
- Dispatch observations live in `docs/dispatch-observations.md`, not here

## Question Selection & Types
Rank by: closure probability per research cost > decision-relevance > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
**Selection guards:** FIRST reject non-open questions and near-duplicate open questions. Crashed questions dispatch next; do not interleave. Never reclassify a question on re-dispatch.
**Queue pressure:** Pruning mode auto when open >15 OR open:resolved >2:1. Prefer existing over new, boost kill-check/synthesis, deprioritize mechanism. Escalation: >3:1 → cap new at 1; >4:1 → cap new at 0.
**Exploit mode:** If the last 4 dispatches are answered/killed with attrition = 0 and average findingsAdded ≥9, the next dispatch must exploit the store on an existing question. Prefer synthesis if eligible; otherwise mechanism, kill-check, or first-principles. Do not open a new landscape/data-hunt branch unless it directly unblocks a kill-check.
**Closure mode:** If the last 6 dispatches resolved ≥5 questions and created ≤1 new question, block new landscape/data-hunt unless it directly unlocks an open kill-check or empirical gate. If the last 5 dispatches created 0 new questions and resolved ≥4, keep at least 2 of every next 3 dispatches on existing-question kill-check/mechanism/synthesis/first-principles.
**Resolution bias:** In closure mode, rank question types by resolved-per-dispatch before raw findingsAdded. Prefer mechanism/kill-check/synthesis over another same-branch design-space when both are available and recent attrition is 0.
**Branch-closure rule:** If >50% of open questions are design-space, or 3 related design-space/first-principles/synthesis answers land without any mechanism/kill-check on that branch, or 2 of the last 3 reasoning/synthesis answers on that branch completed in ≤2 inner iterations, the next dispatch on that branch must be mechanism or kill-check unless empirically gated. Do not spend a third consecutive branch-local dispatch on design-space/first-principles/synthesis unless it directly closes the final open question.
**Mechanism debt:** If iter ≥8 and 2+ related questions on a branch were resolved by reasoning/synthesis without any mechanism dispatch on that branch, elevate mechanism above additional first-principles/design-space/synthesis unless the only blocker is empirical-gated.
**Reasoning cadence:** Synthesis requires ≥50 findings OR ≥25 verified. Dispatch it after 8+ dispatches since last synthesis (5 when store >100) if the store also grew >15. Velocity override: mandatory when no synthesis has ever run and store >60. Ceiling: max 2 synthesis in any 6-dispatch window. Do not dispatch first-principles/design-space on thin stores: minimum 5 verified OR 20 SOURCE-tagged in-domain findings.
**Question creation caps:** landscape ≤5 new; non-landscape ≤3. Iter 12 + open >12 → cap new at 1. Iter 15+ → cap new at 1. Iter 18 + open >8 → cap new at 0. Iter 20 + >70% resolved → cap new at 0 for non-kill-check.
**Yield conversion:** After iter 6, if the last 3 dispatches added ≥30 findings but resolved ≤1 question, the next dispatch must be synthesis, first-principles, design-space, or kill-check on an existing branch. Any `answered` dispatch with `questionsResolved = 0` is evidence gain, not closure; prefer sibling kill-check/mechanism/synthesis above repeating the same type or opening a new branch.
**Exhaustion follow-through:** 0 findings by inner iter 2 forces early-exit evaluation. Any exhausted dispatch with ≥12 findings is harvested frontier; the next dispatch on that branch must exploit the harvest with synthesis, first-principles, design-space, or a sibling kill-check, not another adjacent data-hunt/mechanism sweep unless it unlocks a blocked kill-check. Harvested `data-gap` exhaustions with ≥15 findings must convert into such an exploit dispatch within the next 2 dispatches.
**Type rotation:** Max 2 consecutive dispatches of the same type. After iter 4, first-principles and design-space are mandatory once prerequisites exist and they have never been dispatched. After 6+ dispatches since a reasoning type and store growth >40 findings, boost a reasoning type. Cap data-hunt at 5 before a reasoning type.
| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish the frontier, then stop reopening it once the store is clearly productive. |
| kill-check | 5 | Falsify hypotheses. Prefer when >3 open pathways. Never deprioritize kill-check because it prunes branches fastest. |
| data-hunt | 5 | Specific values. Highest yield early; repeated low-yield or harvested exhaustions mean the store should be exploited, not expanded sideways. |
| mechanism | 5 | How/why. Multi-iter convergence is normal. Boost after successful reasoning dispatches, after iter 10 if related questions have been resolved but mechanism has not run, and in late-stage closure. |
| synthesis | 3 | Combine store findings. Scope to a cluster, not the whole store. It must resolve its question or net-reduce open count; cap new questions from synthesis at 1. |
| first-principles | 3 | Derive from axioms + verified findings. Mandatory after iter 4 once prerequisites exist. |
| design-space | 4 | Map constraints to solution space. Use to close real choice points, not to prolong already-mapped branches. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable; equally valuable as answered
- **narrowed** — partial progress. Re-dispatch must include prior handoff findings. Same question narrowed ≥2 times with declining yield → evaluate for exhaustion.
- **exhausted** — diminishing returns. Subtypes: `data-gap` | `strategy-limit` | `infrastructure`. Integration must create `[DERIVED: exhaustive-search]`. Data-gap auto-gates dependent questions.
- **crashed** — infrastructure failure. Not exhausted; re-dispatch eligible. Integrate partial findings before persona reset.
- **empirical-gate** — requires physical measurement; do not re-dispatch. Auto-gate dependent questions.
- For first-principles/design-space, `narrowed` + empirical-gate is successful; do not penalize it.

## Expert Pacing & Library
Search budget per iteration by question type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iterations get budget + 2. Budget does not limit file reads or knowledge-store writes.
Personas live in `expert-library/library.jsonl`. Utility = avgIG × log(dispatches + 1). Factory selects persona with utility >2.0; adapt if parent score ≥5.0, otherwise create fresh. High-scoring personas (≥2.0, dispatches ≥2) promote to `global-expert-library.jsonl`.

## Finding Graduation
Provisional → verified when confidence ≥0.85, tag = SOURCE with URL, age ≥3 dispatches, and not contradicted. Fast-track: SOURCE with confidence ≥0.90 graduates after 2 dispatches.
DERIVED graduates when confidence ≥0.90, derivationChain has ≥2 premises, all premises are verified, age ≥3, and not contradicted. Trust cascade: axioms → SOURCE → DERIVED.
`[DERIVED]` without derivationChain is knowledge debt; integration must downgrade it to `[ESTIMATED]`.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker and forced handoff. Recovery: zero prior-file loading, single question, 2 attempts → infrastructure. Crash scores never trigger rollback.
- **Persistence gate:** Persisted findings must match produced findings; log `PERSISTENCE_GAP` if not. Summarize before synthesize; persisted finding IDs must exist in `findings.jsonl`.
- **Hollow answer gate:** answered + 0 findingsAdded → log `HOLLOW_ANSWER`. More than 2 in one project forces review of convergence criteria and question scoping.
- **Completion gate:** All questions resolved (0 open) → status `completed`. Conductor skips completed.
- **Verification floor:** After iter 8 with verified/total <30%, or once >60% of questions are resolved, boost kill-check and synthesis and penalize low-leverage design-space. Completed project <30% verified → log `LOW_VERIFICATION_COMPLETION`.
- **Lineage gate:** Evolve must produce a lineage entry every iteration, including no-change holds.
- **Dispatch integrity:** Never dispatch answered, killed, empirical-gated, or exhausted questions. If iteration advances without dispatch, log `DISPATCH_GAP`. If `questionsAfter = 0` but `questionsBefore > 0`, treat as `QUESTION_STORE_WIPE`, restore from snapshot, then normalize IDs.
- **Closure integrity:** 2 harvested-frontier events inside 3 dispatches without an exploitative reasoning dispatch → log `HARVEST_CHAIN` and force synthesis/first-principles/design-space next. In closure mode, opening a new question without resolving or unblocking an existing branch logs `CLOSEOUT_DRIFT` and forces an existing-question dispatch next. Harvested `data-gap` frontier not exploited within 2 dispatches logs `HARVEST_DRIFT`.
- **Branch-closure gate:** 2 `answered` dispatches inside 4 iterations that either resolve 0 questions or close with findingsAdded ≤4 log `NON_CLOSING_ANSWER` or `THIN_CLOSURE`; the next dispatch on that branch must be mechanism or kill-check unless only one open question remains. If open design-space >50% and a related open mechanism/kill-check exists, dispatching another same-branch design-space logs `DESIGN_SPACE_OVERHANG` and forces a branch-closing dispatch next.
- **Metric integrity gate:** Conductor metrics are dispatch-event records, not iteration-unique records. Legitimate multi-dispatch iterations must persist distinct event IDs; dedupe by event identity, never by `conductorIteration` alone. Collision or overwrite logs `EVENT_ID_COLLISION`.
- **Exhaustion gate:** exhausted + 0 questionsResolved must close the question as exhausted/deferred or log `EXHAUSTED_UNRESOLVED`.
- **Summary size gate:** `summary.md` ≤2KB via `enforceSummarySize()`.

## Hard Rules
- Launch `sea conduct` / `sea loop` as background tasks; wait for notification, do not poll.
- <!-- DIVERGES FROM CLAUDE.md: Codex shell output is returned as a captured post-exit buffer, not a live pane; default to a visible second terminal instead of log redirection so the user can watch progress without consuming main-session context. -->
- Keep stdout/stderr visible for short commands (<5 min). For hours-scale `sea conduct` / `sea loop` runs in Codex, prefer a visible separate terminal over repo-log redirection; use log files only when the user explicitly asks for them or a non-visible launch, and if you do redirect, immediately emit exact tail commands (`Get-Content -LiteralPath .\<log> -Wait` for PowerShell or `tail -f ./<log>` for Git Bash).
- Do not use `tee` as the default split-stream strategy for long-running SEA jobs in Codex; it still binds output to the captured command stream instead of freeing the main session context.
- For Codex sessions on Windows, prefer an explicit `--provider codex` launch in a visible separate `cmd.exe` window so the user can keep chatting here while watching live output there.
- Do not use PowerShell's `npx` shim for repo execution on Windows (`npx.ps1` can be blocked by execution policy). Use `cmd.exe` with `npx.cmd`, `sea`, or `node dist/cli.js`.
- Preferred Codex Windows launch pattern: `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', 'cd /d <repo> && node dist/cli.js --provider codex <conduct|loop> <project>') -PassThru`
- Context budgets per agent: `types.ts` `CONTEXT_BUDGETS`.
- Personas stay full length; iter 1 uses file reference + critical sections (~6KB cap).
- Knowledge store is the source of truth, not `output/` reports.
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`. Prefer `[UNKNOWN]` over an untagged guess.
- Evaluate agent is an independent critic and never sees persona or goal framing.
- One evolution change at a time: hypothesis + measurement + rollback trigger.
- Rollback-first on >15% score drop from the 3-iteration rolling average, excluding crashes; wait at least 2 iterations before judging.
- Evolve: 2 heuristic failures on the same issue → classify as infrastructure and stop retrying heuristics.
- Summarize must receive full raw findings; never truncate (32KB budget).
- Pattern library: load all failure patterns. New generalizable patterns go in `failure-patterns/` or `success-patterns/`.
- Expert store writes are idempotent: F9XX IDs sequential, dedupe by ID and claim text. For landscape/first-principles/design-space, IG = findingsAdded + questionsAdded.
- Reasoning-type findings use `[DERIVED]` with derivationChain. No `[SOURCE]` without URL. Findings without epistemic tags must not be persisted.
- Kill signals prune entire branches; never deprioritize kill-check.
- Metric `questionType` must match the question record type; no silent reclassification at dispatch.

## Evolution Protocol
Valid outcomes:
1. **Behavioral change** — modify persona. Requires hypothesis, measurement, rollback trigger.
2. **Strategic advancement** — update targets when questions are resolved or blocked.
3. **No-change hold** — declare working. Record lineage with reasoning. Default to hold when composite ≥6.5 and findingsAdded ≥5; only change on a specific, named failure.
**Stagnation:** 2 consecutive non-crash iterations with zero findings and zero resolved → classify as exhausted, blocked, or wrong.
**Empirical plateau:** >2 questions exhausted as "needs measurement" and remaining open questions depend on them → flag project empirical-gated.
**Escalation enforcement:** Same heuristic failure across 2+ projects → escalate to infrastructure debt, not another persona heuristic.
**Meta-evolution:** Read lineage + metrics, identify cross-project patterns, verify protocol against code, then propose changes. Prefer tightening selector/gates over adding new prompt heuristics when current expert types are already closing questions. Safety Rails are IMMUTABLE.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Infrastructure Debt
Open gaps that require code, not heuristics:
1. **Early-exit enforcement** (MEDIUM) — zero-finding searches at inner iter 2 still rely too much on prompt guidance instead of code-level convergence control.
2. **Observability completeness** (MEDIUM) — ensure `PERSISTENCE_GAP`, `HOLLOW_ANSWER`, `LOW_VERIFICATION_COMPLETION`, `DISPATCH_GAP`, `EXHAUSTED_UNRESOLVED`, `NON_CLOSING_ANSWER`, `THIN_CLOSURE`, `DESIGN_SPACE_OVERHANG`, `HARVEST_DRIFT`, and `EVENT_ID_COLLISION` are emitted consistently.
3. **Selector-state enforcement** (HIGH) — exploit-mode follow-through, closure acceleration, harvested-frontier conversion, branch-closure conversion, and mechanism debt still depend too much on prompt text instead of persistent branch-local state.
4. **Metric event identity** (MEDIUM) — conductor metrics still need durable dispatch event IDs so resumed runs, crash backfills, and same-iteration multi-dispatch cases cannot dedupe or overwrite legitimate records.

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
