# SEA Conductor

## State
- Conductor version: v057 (hold — extended validation iter 36). v051–v056 retreat: 6 straight prompt-only attempts to force FP/mechanism dispatch failed across 29 local-llm-stack iters; v057 demoted type-debt mandates to boosted priors, added `MANDATE_SKIPPED` log when selector bypasses a boosted prior without queue-pressure/yield-guard/same-type-cap override. Cumulative v057 evidence iter 20–35 (16 dispatches): 12.1 f/disp avg, 14 answered + 2 killed (both productive branch-closers: LQ025 NVK-silicon structural, LQ052 Maxwell PMU-firmware), 0 crashes, 0 exhausted, net −3 questions in recent 10 (closure working). Reasoning types firing organically without mandate pressure: synthesis iter 24+31 (iter-31 net-reduced −1q, cadence prior working), design-space iter 29 (prereqs met via type-rotation prior), kill-check carrying 50% of recent closure load with yield 12.8 > project avg — KC yield-guard correctly NOT firing. Still 0 FP/mechanism; evidence continues to say non-problem, not blocker. Holds: v054 synthesis-cadence prior, v053 design-space prior. Infra-debt #3 BLOCKING — no more prompt-only mandate revisions. INFRA-OBS iter-18 findingsPersisted=−343 pre-restore mask still open. Older-version rationale: `dispatch-patterns.md`.
- Outer loop: select → create-expert → expert-loop → integrate (4 LLM calls/iter). Knowledge: `findings.jsonl` + `questions.jsonl` + `summary.md` per project.
- Multi-provider: `--provider` / `SEA_PROVIDER` / auto-detect. Config: `types.ts`.

## Question Selection & Types
Rank by: decision-relevance per research cost > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
**Selection guards:** FIRST reject non-open questions and near-duplicate open questions. Crashed questions dispatch next. Never reclassify type on re-dispatch. Empirical-gate questions excluded from effective open count for convergence gates.
**Queue pressure:** Pruning mode when dispatchable open >15 OR open:resolved >2:1. Boost kill-check/synthesis, deprioritize mechanism, prefer existing over new. Escalation: >3:1 → cap new at 1; >4:1 → cap new at 0.
**Store maturity:** findings >60 OR verified >30 → boost synthesis below never-dispatched. newQuestionsCreated = 0 for 2+ dispatches and iter ≥4 → frontier mapped; boost synthesis/first-principles on existing.
**Exploit mode:** Last 4 dispatches answered/killed, attrition = 0, avg findingsAdded ≥9 → next must exploit store: synthesis if eligible, else mechanism or first-principles. No new landscape/data-hunt unless it unblocks kill-check.
**Mechanism promotion:** FP/design-space answered in ≤2 inner iters and related open mechanism exists → boost above new landscape/data-hunt. Iter ≥8 and 2+ branch questions resolved by reasoning without mechanism on that branch → elevate mechanism.
**Type-debt priors (DEMOTED from mandates in v057):** Iter ≥5, 0 FP ever + ≥5 verified findings → boost FP to top of rank. Iter ≥6, 0 mechanism ever + ≥3 reasoning-type answers → boost mechanism. 0 synthesis ever + ≥60 findings → boost synthesis. Synthesis-cadence: store ≥100 AND ≥8 dispatches since last synthesis AND store grew ≥30 since last → boost synthesis (ceiling 2 in 6-disp window). If selector skips any boosted type-debt prior without queue-pressure/yield-guard/same-type-cap override, log `MANDATE_SKIPPED` (feeds infra-debt #3). Prior clears once missing type dispatched ≥1 (FP/mechanism/DS: ≥5 findings; synthesis: resolves or net-reduces).
**Hot-streak:** 2 of last 3 dispatches are reasoning/synthesis answers in ≤2 inner iters and related mechanism/kill-check is open → dispatch that branch-closer next.
**Synthesis cadence:** Requires ≥50 findings OR ≥25 verified. After 8+ dispatches since last (5 when >100) if store grew >15. Ceiling: 2 in 6-dispatch window. Must resolve its question or net-reduce open count; new questions capped at 1. 2× exhaustion in project → FP before retry.
**Question creation caps:** landscape ≤5; non-landscape ≤3. Iter 12 + open >12 → 1. Iter 15+ → 1. Iter 18 + open >8 → 0. Iter 20 + >70% resolved → 0 for non-kill-check.
**Closure mode:** Iter ≥6: last 3 added ≥30 findings but resolved ≤1 → force synthesis/FP/design-space. Last 5 created 0 new and resolved ≥4 → closure (≥2 of 3 dispatches on consolidation). Last 6 resolved ≥5 + created ≤1 → late-stage: block new landscape/data-hunt unless it unlocks kill-check or empirical gate.
**Type-queue drain:** Type >2× cap in open queue → next synthesis scoped to that type's consolidation. >3× → drain mode: kill-check also targets that type. Block type creation when open > cap for that type.
**Kill-check yield guard:** Kill-check ≥30% of total dispatches AND avg yield <60% of project avg → max 1 kill-check in 6-dispatch window. Prefer mechanism/data-hunt for branch validation when yield higher.
**Type rotation:** Max 2 consecutive same-type dispatches. After iter 4, FP and design-space preferred once prerequisites exist and never dispatched. 6+ dispatches since reasoning type + store growth >40 → boost reasoning. Cap data-hunt at 5 before reasoning type. Open questions with 0 dispatches at iter >10 → priority boost regardless of type.
**Yield decay + exhaustion:** Same type ≥3× and latest yield <50% of type avg → deprioritize and rotate. ≥2 low-yield (<10) exhaustions in 4 dispatches → force synthesis or FP. 0 findings by inner iter 2 → early-exit. Exhausted ≥12 findings = harvested frontier → next on branch must be synthesis/reasoning/kill-check, not another data-hunt.
| Type | Cap | Guidance |
|------|-----|----------|
| landscape | 5 | Broad survey. Dispatch first; stop reopening once store is productive. |
| kill-check | 5 | Falsify hypotheses. Prefer >3 open pathways. Yield-guard throttles overuse. |
| data-hunt | 5 | Specific values. Highest yield early. Low-yield exhaustion = frontier, not wall. |
| mechanism | 5 | How/why. Multi-iter convergence normal. Boost after reasoning wins or iter 10+. |
| synthesis | 3 | Combine findings. Scope to cluster. Must net-reduce questions. |
| first-principles | 3 | Axioms + verified. Preferred after iter 4. <5 findings = thin prerequisites. |
| design-space | 4 | Constraints → solutions. Auto-generate when ≥3 mechanism/data-hunt resolved. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable; equally valuable as answered
- **narrowed** — partial. Re-dispatch includes prior handoff. ≥2 narrowed with declining yield → evaluate for exhaustion.
- **exhausted** — diminishing returns (data-gap | strategy-limit | infrastructure). Integration creates `[DERIVED: exhaustive-search]`. Data-gap auto-gates dependents.
- **crashed** — infrastructure failure. Re-dispatch eligible. Integrate partial findings before persona reset.
- **empirical-gate** — requires physical measurement; do not re-dispatch. Auto-gate dependents.
- For FP/design-space: narrowed + empirical-gate is successful.

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
- **Harvest/closure gate:** 2 harvested-frontier in 3 dispatches without reasoning → force synthesis/FP/design-space. Closure-mode new question without unblocking → `CLOSEOUT_DRIFT`.
- **Non-closing answer:** 2 answered with questionsResolved=0 in 4 iters → force existing-question kill-check/mechanism/synthesis.
- **Thin-closure:** 2 answered with resolved≥1 but findings≤4 in 4 iters → force mechanism or kill-check.
- **Exhaustion gate:** exhausted + 0 resolved → close as exhausted/deferred or log `EXHAUSTED_UNRESOLVED`.
- **Summary size:** ≤2KB via `enforceSummarySize()`.

## Hard Rules
- Launch `sea conduct` / `sea loop` as background task with stdout+stderr redirected to `<project>-conduct.log` / `.err.log` (or `-loop.log`) in repo root. Immediately emit to the user the exact tail commands for a second terminal, both forms verbatim (Windows console default is cp1252; PowerShell MUST set UTF-8 or emoji/arrows render as mojibake):
  - PowerShell: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Content C:\Users\mtlb\code\sea\<project>-conduct.log -Wait -Tail 40 -Encoding UTF8`
  - Git Bash: `tail -f /c/Users/mtlb/code/sea/<project>-conduct.log`
  Wait for notification, do not poll.
- Keep stdout/stderr visible for short commands (<5 min); redirect only the hours-scale background jobs above.
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
- Store writes idempotent: sequential IDs, dedupe by ID + claim. Landscape/FP/design-space IG = findingsAdded + questionsAdded.
- Reasoning findings: `[DERIVED]` with derivationChain. No `[SOURCE]` without URL. Untagged → reject or `[UNKNOWN]`.
- Thin store guard: FP/design-space need ≥5 verified OR ≥20 SOURCE-tagged. Synthesis: ≥50 findings OR ≥25 verified.
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
**Reasoning-type override** (FP/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Infrastructure Debt
Code-required gaps:
1. **Selector-state enforcement** (HIGH) — Exploit mode, closure, non-closing answer, thin-closure: all prompt-only. Need persistent branch-local state + code guard.
2. **Observability** (MEDIUM — partially addressed) — PERSISTENCE_GAP, HOLLOW_ANSWER, DISPATCH_GAP, EXHAUSTED_UNRESOLVED still emitted inconsistently. `findingsPersisted` records pre-restore delta on auto-restore (iter 18 LQ031 reported -343 while store grew normally) — masks STORE_CLOBBER_RESTORED in metrics dashboards. `MANDATE_SKIPPED` + `MANDATE_EVALUATED`/`AUTOCREATED`/`HARDBLOCKED` now emitted by code (see Closed).

### Closed
Shipped code (details in CLAUDE-history/): findings store snapshot/restore (`src/store-snapshot.ts`, `STORE_CLOBBER_RESTORED`), type-creation + convergence caps (`src/question-caps.ts`, `QUESTION_CAP_TRIMMED`), same-type + re-dispatch guards (`src/selection-guards.ts`, `SELECTION_GUARD_INTERVENED`), lineage writer (`appendLineageEntry`), SOURCE-URL graduation gate (`enforceSourceUrls`, `SOURCE_URL_MISSING`), manual selector override (`sea dispatch --question <id>` — bypasses selector LLM + guards when empirical-gate exclusion or other prompt-only rule is violated; logs `SELECTOR_MANUAL_OVERRIDE`), **type-debt mandate enforcement** (`src/type-debt-mandates.ts`) — pure `evaluateMandates()` covers the 4 CLAUDE.md boosted-priors (fp-missing / mechanism-missing / synthesis-missing / synthesis-cadence); `MANDATE_EVALUATED` logged every eligible iter; `SEA_MANDATE_AUTOCREATE=1` auto-generates a mandated-type question from top-domain templates when none open (logs `MANDATE_AUTOCREATED`); `SEA_MANDATE_HARDBLOCK=1` overrides selector to mandated-type question when available, respecting same-type-cap (logs `MANDATE_HARDBLOCKED`); `MANDATE_SKIPPED` logged when selector picks non-mandated type despite eligibility. Flags default off; enable per-project after observing baseline skip rate. **Do NOT add more prompt-only mandate prose** — enforcement is code now.
Deprioritized: SOURCE fast-track graduation (EXP-035 — 1-disp speedup, confidence cliff at 0.90, undercuts graduation gate; revive with evidence of verification-lag blocker). Mechanism-saturation → design-space mandate (v057 removed — DS fired organically iter 29 via type-rotation prior; revive only if ≥4 mechanism dispatches stack with 0 DS follow-up). Divergence EXPERIMENTAL (v057 removed from selection prose — 0 evidence produced in any project; revive if clustered-dispatch stagnation pattern reappears with concrete rollback trigger).

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
