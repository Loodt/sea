# SEA Conductor

## State
- Conductor version: v042
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff (4 LLM calls per iteration)
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Multi-provider: `--provider`, `SEA_PROVIDER`, or harness auto-detect (CLAUDECODE / CODEX_CLI). Config in `types.ts`.
- Dispatch observations live in `docs/dispatch-observations.md`, not here

## Question Selection & Types
Rank by: decision-relevance per research cost > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
**Selection guards:** FIRST reject non-open questions and near-duplicate open questions before considering new ones. Crashed questions dispatch next; do not interleave.
**Pruning mode:** auto when open >15 OR open:resolved >2:1. Prioritize kill-check/synthesis, deprioritize mechanism, prefer existing over new. Escalation: >3:1 → cap new at 1; >4:1 → cap new at 0.
**Store maturity:** When total findings >60 OR verified >30, boost synthesis priority (not above never-dispatched questions). When newQuestionsCreated = 0 for 2+ consecutive dispatches AND iter ≥4, treat frontier as mapped and boost synthesis/first-principles. Auto-generate synthesis if none and store >50 findings; regenerate if store grew >30 since last.
**Synthesis cadence:** After 8+ dispatches since last synthesis (or 0 ever) AND store >40 findings AND grew >15 since last synthesis, synthesis is mandatory next. At store >100, reduce gap to 5. Velocity override: mandatory when 0 synthesis ever dispatched AND store >60. Post-exhaustion acceleration: after synthesis exhaustion, re-dispatch once store grows ≥50% past exhaustion size. Ceiling: max 2 synthesis in any 6-dispatch window.
**Synthesis scope:** Synthesis must resolve its question or net-reduce open count. Cap new questions from synthesis at 1. If synthesis creates >1 new without resolving, next synthesis must narrow to a finding cluster (≥10 related findings), not the whole store. If synthesis exhausts 2× in one project, dispatch first-principles before retrying synthesis.
**Question creation caps:** landscape ≤5 new; non-landscape ≤3. Iter 12 + open >12 → cap new at 1. Iter 15+ → cap new at 1 unconditionally. Iter 18 + open >8 → cap new at 0. Iter 20 + >70% resolved → cap new at 0 for non-kill-check.
**Compression bias:** After iter 6, if the last 3 dispatches added ≥30 findings but resolved ≤1 question, next dispatch must be synthesis, first-principles, or design-space. After iter 12 with >80 findings, boost synthesis + reasoning types over further data-gathering.
**Closure lane:** If the last 5 dispatches created 0 new questions and resolved ≥4, enter closure mode. In closure mode, prioritize the oldest or highest-dependency existing open questions; at least 2 of every next 3 dispatches must be kill-check, mechanism, synthesis, or first-principles on existing questions. New questions require a concrete unblock justification.
**Closure pressure:** If the last 2 dispatches added ≥25 findings and resolved 0 questions, or the last 5 dispatches exceed 18 findings per resolved question, the next dispatch must target an existing question with synthesis, first-principles, design-space, or kill-check. Do not open a new landscape/data-hunt in that state.
**Type rotation:** Same type dispatched ≥3× with latest yield <50% of its project average → deprioritize. After iter 4, first-principles and design-space are mandatory once prerequisites exist and they have never been dispatched. After 6+ dispatches since last reasoning type and store grew >40 findings, boost a reasoning type. Cap data-hunt at 5× before a reasoning type.
**Exhaustion handling:** Any question type with 0 findings by inner iter 2 forces early-exit evaluation. ≥2 LOW-YIELD (<10 findings) data-hunt exhaustions in a project deprioritize remaining data-hunts; >5 open data-hunts triggers this preemptively. ≥2 low-yield exhaustions in the last 4 dispatches means the next dispatch must be synthesis or first-principles.
**Frontier-hit exploitation:** Any exhausted dispatch with ≥12 findings and 0 resolved is a harvest-without-closure event. The very next dispatch must exploit that cluster via synthesis, first-principles, or design-space scoped to those findings. Do not chain a second adjacent data-hunt/mechanism/kill-check harvest on the same branch until exploitation runs, unless it directly unlocks a blocked kill-check.
**Strategy-limit follow-through:** A strategy-limit exhaustion with ≥15 findings and 0 resolved creates a branch cooldown. The next dispatch on that branch cannot be data-hunt or mechanism; it must be kill-check, synthesis, or first-principles using the harvested cluster.
**Resolved-harvest follow-through:** Any exhausted dispatch with ≥15 findings and ≥1 question resolved still counts as harvested frontier. The next dispatch should target a sibling/open question in that cluster with kill-check, synthesis, or first-principles, not a fresh landscape/data-hunt, unless the branch is fully closed.
**Late-stage mix:** At iter 15+ with store >80 findings and open >6, data-hunt + landscape combined may occupy at most 1 of every 3 dispatches until open drops to 6 or fewer.
**Fast-answer bias:** If 3 of the last 5 answered dispatches finished in ≤2 inner iterations, boost those types against comparable open questions. Treat this as evidence of an efficient frontier and harvest it before opening harder branches.
| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish frontier. |
| kill-check | 5 | Falsify hypotheses. Prefer when >3 open pathways. If strategy-limit exhausts with 0 resolved, rotate to synthesis/reasoning before retrying that branch. |
| data-hunt | 5 | Specific values. Highest yield early; repeated high-yield exhaustions mean the frontier is harvested and the store should be exploited. |
| mechanism | 5 | How/why. Multi-iter convergence is normal. After iter 10, boost if open with 0 dispatches and ≥3 related questions resolved. |
| synthesis | 3 | Combine store findings. Requires ≥50 findings OR ≥25 verified. Scope to a cluster, not the whole store. |
| first-principles | 3 | Derive from axioms + verified findings. Mandatory after iter 4 once prerequisites exist. |
| design-space | 4 | Map constraints to solution space. Auto-generate when ≥3 mechanism/data-hunt questions resolved. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable; equally valuable as answered
- **narrowed** — partial progress. Re-dispatch must include prior handoff findings. Same question narrowed ≥2 consecutive dispatches with declining yield → evaluate for exhaustion.
- **exhausted** — diminishing returns. Subtypes: data-gap | strategy-limit | infrastructure. Integration must create `[DERIVED: exhaustive-search]`. Data-gap auto-gates dependent questions.
- **crashed** — infrastructure failure. Not exhausted; re-dispatch eligible. Integrate partial findings before persona reset.
- **empirical-gate** — requires physical measurement; do not re-dispatch. Auto-gate dependent questions.
- For first-principles/design-space, `narrowed` + empirical-gate is successful; do not penalize.

## Expert Pacing & Library
Search budget per iteration by question type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iterations get budget + 2. Budget does not limit file reads or knowledge-store writes.
Personas live in `expert-library/library.jsonl`. Utility = avgIG × log(dispatches + 1). Factory selects persona with utility >2.0; adapts if parent score ≥5.0, otherwise creates fresh. High-scoring personas (≥2.0, dispatches ≥2) promote to `global-expert-library.jsonl`.

## Finding Graduation
Provisional → verified when confidence ≥0.85, tag = SOURCE with URL, age ≥3 dispatches, and not contradicted. Fast-track: SOURCE with confidence ≥0.90 graduates after 2 dispatches.
DERIVED graduates when confidence ≥0.90, derivationChain has ≥2 premises, all premises are verified, age ≥3, and not contradicted. Trust cascade: axioms → SOURCE → DERIVED.
`[DERIVED]` without derivationChain is knowledge debt; integration must downgrade it to `[ESTIMATED]`.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker, forced handoff. Recovery: zero prior-file loading, single question, 2 attempts → infrastructure. Crash scores never trigger rollback.
- **Conductor crash gate:** 2+ different questions crash consecutively → systemic failure, pause and diagnose.
- **Persistence gate:** Persisted findings must match produced findings; log `PERSISTENCE_GAP` if not. Summarize before synthesize; finding IDs must exist in `findings.jsonl`.
- **Completion gate:** All questions resolved (0 open) → status `completed`. Conductor skips completed.
- **Verification floor:** After 8+ dispatches with verified/total <30%, boost kill-check and synthesis. Also trigger when >75% questions are resolved. Completed project <30% → log `LOW_VERIFICATION_COMPLETION`.
- **Lineage gate:** Evolve must produce a lineage entry every iteration, including no-change holds.
- **Inner yield gate:** If inner iter ≥3 and the previous inner iteration added 0 findings, force convergence assessment.
- **Same-type cap:** Max 2 consecutive dispatches of any single question type. Third consecutive selection is blocked; force rotation.
- **Re-dispatch block:** Never dispatch answered, killed, empirical-gated, or exhausted questions. Never reclassify question type on re-dispatch. Log `ANSWERED_REDISPATCH` on any violation.
- **Dispatch gap gate:** If iteration advances without dispatch, log `DISPATCH_GAP`. 2+ gaps in 5 iterations → diagnose selector.
- **Harvest chain gate:** 2 harvest-without-closure events inside 3 dispatches without an intervening exploitative reasoning dispatch → log `HARVEST_CHAIN` and force synthesis/first-principles/design-space next.
- **Closure drift gate:** In closure mode, if a dispatch opens a new question without resolving or unblocking an existing branch, log `CLOSEOUT_DRIFT` and force an existing-question dispatch next.
- **Question integrity:** IDs must be unique. If `questionsAfter = 0` but `questionsBefore > 0`, treat as `QUESTION_STORE_WIPE`, restore from pre-dispatch snapshot, then normalize IDs.
- **Exhausted unresolved gate:** exhausted + 0 questionsResolved → integration must close the question as exhausted/deferred or log `EXHAUSTED_UNRESOLVED`.
- **Summary size gate:** `summary.md` ≤2KB via `enforceSummarySize()`.

## Hard Rules
- Launch `sea conduct` as a background task; wait for notification, do not poll.
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
- Do not dispatch first-principles/design-space on thin stores: minimum 5 verified OR 20 SOURCE-tagged in-domain findings. Synthesis requires ≥50 findings OR ≥25 verified.
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
**Meta-evolution:** Read lineage + metrics, identify cross-project patterns, verify protocol against code, then propose changes. Safety Rails are IMMUTABLE.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Infrastructure Debt
Open gaps that require code, not heuristics:
1. **Re-dispatch guard** (HIGH) — answered/exhausted questions still reappear and sometimes change type. Need a pre-dispatch code filter that rejects non-open questions and type drift.
2. **Question creation cap enforcement** (HIGH) — late-stage caps are still prompt-level. Need post-dispatch trimming to enforce per-iteration creation ceilings.
3. **SOURCE fast-track graduation** (MEDIUM) — playbook says SOURCE ≥0.90 confidence graduates after 2 dispatches; `knowledge.ts` still defaults to 3.
4. **Early-exit rule** (MEDIUM) — zero-finding searches at inner iter 2 should trigger code-level convergence evaluation, not only prompt guidance.
5. **Observability logging** (MEDIUM) — ensure `PERSISTENCE_GAP`, `HOLLOW_ANSWER`, `LOW_VERIFICATION_COMPLETION`, `DISPATCH_GAP`, and `EXHAUSTED_UNRESOLVED` are emitted consistently.
6. **Resolution-aware selector scoring** (MEDIUM) — selector context still underweights harvest-without-closure and findings:resolution imbalance. Add rolling queue-compression signals.
7. **Harvest-chain enforcement** (MEDIUM) — branch cooldown and exploit-next rules are still text-only. Need selector-state tracking for recent harvest-without-closure events and branch-local blocking.
8. **Closure-mode enforcement** (MEDIUM) — closeout behavior is still heuristic-only. Need selector-state tracking for zero-churn resolved streaks so late-stage iterations stay on existing questions.
9. **Resolved-harvest sibling routing** (MEDIUM) — high-yield exhaustions that resolve one question still leave exploitable clusters. Need branch-local sibling selection after partial closure, not just after 0-resolved harvests.

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
