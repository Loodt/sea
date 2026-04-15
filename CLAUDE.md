# SEA Conductor

## State
- Conductor version: v038 (jarvis-architecture iter 0-23: 22/24 answered, 1 exhausted, avg 13.5 findings/dispatch; 96 findings (39 verified). 24 open — 15 design-space vs 4 cap, 4 data-hunt 0× dispatched. Iter-18 clobber recovered and now guarded by store-snapshot.ts)
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff (4 LLM calls per conductor iteration; v035 hybrid rolled back after EXP-013 deployment showed 4× domain coverage loss and verification regression — persona is structured-context utilization, not overhead)
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Multi-provider: `--provider` flag, `SEA_PROVIDER` env, or auto-detect from harness (CLAUDECODE / CODEX_CLI). Config in `types.ts`.

## Question Selection & Types
Rank by: decision-relevance per research cost > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
**Pruning mode** (auto when open >15 OR open:resolved >2:1): prioritize kill-check/synthesis, deprioritize mechanism, prefer existing over new. Escalation: >3:1 → cap new questions at 1; >4:1 → cap at 0.
Selection MUST reject near-duplicate open questions before creating new ones.
**Crash re-dispatch priority:** Crashed questions dispatch next — do not interleave.
**Store maturity signal:** When total findings >60 OR verified >30, boost synthesis priority (not above never-dispatched questions). When newQuestionsCreated = 0 for 2+ consecutive dispatches AND iter ≥4 → frontier mapped; boost synthesis/first-principles. Auto-generate synthesis if none and store >50 findings; regenerate if store grew >30 since last.
**Synthesis starvation:** After 8+ dispatches since last synthesis (or 0 ever) AND store >40 findings AND grew >15 since last synthesis → mandatory synthesis next. Recurrent — triggers each time gap exceeds 8. At store >100, reduce gap to 5. **Velocity override:** mandatory when 0 synthesis ever dispatched AND store >60 findings — do not wait for dispatch count. **Post-exhaustion acceleration:** After synthesis exhaustion, mandatory re-dispatch when store grows ≥50% past exhaustion size — skip starvation timer, treat as next-dispatch obligation. **Synthesis ceiling:** Max 2 synthesis in any 6-dispatch window — over-synthesis wastes iterations on thin derivation gains.
**Synthesis net-reduction:** Synthesis MUST resolve its question or net-reduce open count. Cap new questions from synthesis at 1. Synthesis that fragments (creates >1 new without resolving) → misscoped; narrow next synthesis to a specific finding cluster (≥10 related findings), not whole store. If synthesis exhausts 2× in same project → prerequisites insufficient; dispatch first-principles to build derivation foundations before retrying synthesis.
**Early-exit rule:** Any question type with 0 findings by iter 2 → force early-exit evaluation.
**Question generation cap:** Landscape dispatches create at most 5 new questions; non-landscape at most 3.
**Convergence gates:** Iter 12 + open >12 → cap new at 1. **Iter 15+ → cap new at 1 unconditionally — no type exemptions.** Iter 18 + open >8 → hard block: integration MUST discard new questions and log CONVERGENCE_VIOLATION (4 violations observed — prompt caps fail without code enforcement). Iter 20 + >70% resolved → cap at 0 for non-kill-check; prioritize synthesis + kill-check to consolidate.
**Open question hard cap:** Open >25 → dispatch ONLY synthesis/kill-check until open <20. Any single type >2× its dispatch cap in the open queue → next synthesis MUST scope to that type's consolidation (merge/kill, not derive). **>3× cap → drain mode:** kill-check MUST also target that type for merge/kill — synthesis-only drain is too slow (15 design-space at 3.75× after 24 iters).
**Late-stage consolidation:** After iter 12 with >80 findings, boost synthesis + reasoning types over data-gathering. Data-hunt yield declines as easy data exhausts; store exploitation outweighs further harvesting.
**Yield decay:** Same type dispatched ≥3× in project AND latest yield <50% of that type's project average → deprioritize; rotate to underrepresented types.
**Type diversity:** After iter 4, first-principles AND design-space each required if (≥5 verified OR ≥20 SOURCE-tagged) and never dispatched — mandatory, not advisory. Cap data-hunt at 5× before a reasoning type. **Never-dispatched boost:** open questions with 0 dispatches AND iter >10 → priority boost regardless of type (selection gap: 4 data-hunts at iter 24, 0× dispatched).
**Type recurrence:** After 6+ dispatches since last reasoning type (first-principles/design-space) AND store grew >40 findings since then → boost reasoning. **Mechanism recurrence:** 6+ dispatches since last mechanism AND ≥1 open mechanism question exists AND iter ≥10 → mandatory mechanism next (upgrades existing "boost after iter 10" — observed 10-iter starvation despite boost rule). Depth-of-understanding rotation; prevents type drift.
**Type-window cap:** Max 3 dispatches of any single type in any 6-dispatch window. Prevents concentration (observed: kill-check 5/10 = 50%, avg yield 9.8 vs mechanism 24.0 — concentration costs findings).
**Data-hunt fatigue:** ≥2 LOW-YIELD (<10 findings) data-hunt exhaustions in a project → deprioritize remaining open data-hunts; rotate to synthesis/reasoning. High-yield (≥10 findings) exhaustion = frontier hit, counts toward progress not fatigue (align with exhaustion-cluster rule). **Queue concentration:** >5 open data-hunts → apply fatigue rules preemptively (boost reasoning/synthesis) even without exhaustion.
**Exhaustion cluster:** ≥2 low-yield (<10 findings each) exhausted in last 4 dispatches → next MUST be synthesis or first-principles. Data wall detected. High-yield exhaustion (≥10 findings) = frontier hit, not wall — don't trigger rotation.
| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish frontier. |
| kill-check | 5 | Falsify hypotheses + produce findings. Prefer when >3 open pathways. |
| data-hunt | 5 | Specific values. Highest yield. Early-exit at iter 2 if 0 findings. |
| mechanism | 5 | How/why. Multi-iter convergence normal. After iter 10, **mandatory** (not boost) if open with 0 dispatches and ≥3 related questions resolved. |
| synthesis | 3 | Combine store findings. Requires ≥50 findings OR ≥25 verified. Scope to a finding cluster, not whole store. Must net-reduce questions. Yield: >60 → 8-10; >200 → 15-20. |
| first-principles | 3 | Derive from axioms + verified findings. Mandatory after iter 4. Fast convergence (1-2 iters). Typical yield 5-8; **<5 findings = thin prerequisites; 2 consecutive low-yield → rotate to data-hunt/mechanism to build foundations.** |
| design-space | 4 | Map constraints → solution space. Mandatory after iter 4. Auto-generate when ≥3 mechanism/data-hunt resolved. Typical yield 5-8; exhaustion at <4 = thin prerequisites. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable (equally valuable as answered)
- **narrowed** — partial progress. Re-dispatch MUST include prior handoff findings. **Narrowed stall:** same question narrowed ≥2 consecutive dispatches with declining yield → evaluate for exhaustion.
- **exhausted** — diminishing returns. Subtypes: data-gap | strategy-limit | infrastructure. Integration MUST create `[DERIVED: exhaustive-search]` finding. **Data-gap cascade:** auto-gate questions whose resolution depends on the gapped data (like empirical-gate).
- **crashed** — infrastructure failure. NOT exhausted, re-dispatch eligible. Integrate partial findings BEFORE persona reset
- **empirical-gate** — requires physical measurement; do not re-dispatch. **Cascade:** auto-gate dependent questions.
- For first-principles/design-space: "narrowed" + empirical-gate is SUCCESSFUL — do not penalize.

## Expert Pacing & Library
Search budget per iteration by question type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iterations get budget + 2. Budget does NOT limit file reads or knowledge store writes.
Personas stored by hash in expert-library/library.jsonl. Utility = avgIG × log(dispatches + 1). Factory selects persona with utility >2.0; adapts if parent score ≥5.0, otherwise creates fresh. High-scoring personas (≥2.0, dispatches ≥2) promote to `global-expert-library.jsonl`.

## Finding Graduation
Provisional → verified when: confidence ≥ 0.85, tag = SOURCE with URL, age ≥ 3 dispatches, not contradicted. **Fast-track:** SOURCE with confidence ≥ 0.90 graduates after 2 dispatches — externally verifiable evidence needs less aging.
**DERIVED graduation:** confidence ≥ 0.90, derivationChain with ≥2 premises (all verified), age ≥ 3, not contradicted. Trust cascade: axioms → SOURCE → DERIVED. DERIVED can only graduate after ALL premises verified.
**derivationChain enforcement:** [DERIVED] without derivationChain is knowledge debt. Integration MUST downgrade to [ESTIMATED] if chain missing.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker, forced handoff. Recovery: zero prior-file loading, single question, 2 attempts → infrastructure. Crash scores MUST NOT trigger rollback.
- **Conductor crash gate:** 2+ different questions crash consecutively → systemic failure, pause and diagnose
- **Hollow answer gate:** answered + 0 findingsAdded → log HOLLOW_ANSWER. >2 in project → review expert convergence and question scoping
- **Summarize completeness:** Persisted findings must match produced (log PERSISTENCE_GAP if not). Evaluate writes JSON scores block; loop parses/persists.
- **Summarize before synthesize:** Store current before report. Finding IDs MUST exist in findings.jsonl
- **Summary size gate:** summary.md ≤2KB (code-enforced via `enforceSummarySize()`)
- **Completion gate:** All questions resolved (0 open) → status "completed". Conductor skips completed.
- **Verification floor:** After 8+ dispatches with verified/total <30% → boost kill-check and synthesis to consolidate provisionals. Also trigger when >75% questions resolved. Completed project <30% → log LOW_VERIFICATION_COMPLETION.
- **Lineage gate:** Evolve MUST produce lineage entry every iteration — including no-change holds. Missing lineage = silent drift.
- **Inner yield gate:** If inner iter ≥3 and previous iteration added 0 findings, force convergence assessment.
- **Same-type cap:** Max 2 consecutive dispatches of any single question type. 3rd consecutive → hard block, force rotation. Code-enforced prompt warning after 2 consecutive.
- **Re-dispatch blocks:** FIRST STEP in selection: verify candidate question.status = 'open' in questions.jsonl. Never re-dispatch answered, killed, or exhausted (2× same question → permanent-gap). Never reclassify question type at re-dispatch. Code guard NOT yet implemented — conductor self-check is critical. Log ANSWERED_REDISPATCH.
- **Dispatch gap gate:** Iteration advances without dispatch → log DISPATCH_GAP. 2+ gaps in 5 iterations → diagnose question selector.
- **Question ID gate:** IDs MUST be unique. Code normalizes duplicates post-dispatch; prompt provides next-free ID.
- **Question store integrity:** Pre-integration snapshot + post-integration diff is code-enforced via `store-snapshot.ts`. Clobber triggers (critical, auto-restore): questionsAfter = 0 when questionsBefore > 0, or questionsAfter < questionsBefore × 0.5. Warning (non-blocking): non-open questions reopened. Snapshots persist at `projects/<name>/knowledge-snapshots/iter-NNN-pre-integration/`. Duplicate IDs are normalised post-dispatch by `normalizeQuestionIds`. Legacy hybrid-agent path still has its own in-memory zero-check.
- **Findings store integrity:** Pre-integration snapshot + post-integration diff is code-enforced via `store-snapshot.ts`. Clobber triggers (critical, auto-restore): findingsAfter = 0 when findingsBefore > 0, findingsAfter < findingsBefore × 0.5, or ANY verified finding removed (ID-based check — catches swap-in-swap-out). Restore is automatic; `STORE_CLOBBER_RESTORED` span logs severity + reasons + full diff. Severity: CRITICAL.

## Hard Rules
- Launch `sea conduct` as background task — wait for notification, do NOT poll
- Context budgets per agent: `types.ts` CONTEXT_BUDGETS
- Personas at full length; iter 1 uses file reference + critical sections (~6KB cap)
- Knowledge store is source of truth — not output/ reports
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`. Prefer `[UNKNOWN]` over untagged guess; anchor comparisons (baseline, magnitude, conditions).
- Evaluate agent is independent critic — never sees persona or goal
- One evolution change at a time — hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop (3-iter rolling avg, exclude crashes); min 2 iters before judging
- Evolve: 2 heuristic failures on same issue → classify as infrastructure, stop trying
- Summarize MUST receive FULL raw findings — never truncate (32KB budget)
- Pattern library: ALL failure patterns loaded. New generalizable patterns → failure-patterns/ or success-patterns/
- Expert store writes idempotent: F9XX IDs → sequential; deduplicates by ID and claim text. Landscape/first-principles/design-space IG = findingsAdded + questionsAdded.
- Reasoning-type findings use `[DERIVED]` with derivationChain. No `[SOURCE]` without URL. Findings without epistemic tags MUST NOT be persisted — reject or tag [UNKNOWN] at write time.
- Do NOT dispatch first-principles/design-space on thin stores — minimum 5 verified OR 20 SOURCE-tagged in domain. Synthesis requires ≥50 findings OR ≥25 verified.
- Kill signals prune entire branches — never deprioritize kill-check
- Metric questionType MUST match question record type — no silent reclassification at dispatch

## Evolution Protocol
Three valid outcomes:
1. **Behavioral change** — modify persona. Requires: hypothesis, measurement, rollback trigger.
2. **Strategic advancement** — update targets when questions resolved/blocked.
3. **No-change hold** — declare working. Record lineage with reasoning. **Default to hold when composite ≥6.5 and findingsAdded ≥5** — only change on specific, named failure.
**Stagnation** (2 consecutive non-crash iters, zero findings + zero resolved): classify → exhausted, blocked, or wrong.
**Empirical plateau:** >2 questions exhausted "needs measurement" + remaining open depend on them → flag project empirical-gated.
**Escalation enforcement:** Same heuristic failure across 2+ projects → escalate to infrastructure debt, not re-seed as persona heuristic.
**Meta-evolution:** Read all lineage + metrics → identify cross-project patterns → verify protocol matches code → propose changes (versioner preserves old). Playbook is provider-dependent. Safety Rails are IMMUTABLE.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Infrastructure Debt
Open gaps — requires code, not heuristic fixes.
1. **Question creation cap enforcement** (HIGH) — Convergence caps violated iters 12/15/19/20. Post-dispatch trim required in code — prompt-only caps fail across all agent variants.
2. **Same-type cap + re-dispatch guard** (HIGH) — Prompt-only. Need pre-dispatch code filter: reject non-open and 3rd-consecutive-type.
3. **Design-space question accumulation** (CRITICAL) — 15 open design-space vs 4 dispatch cap (3.75×). Integration creates follow-ups without type-balance. Need: cap type creation when open > dispatch cap for that type. Prompt-level drain rules added but code enforcement needed.
4. **SOURCE fast-track graduation** (MEDIUM) — Code defaults to 3 dispatches; doc says 2 for ≥0.90 SOURCE.
5. **Observability logging** (MEDIUM) — PERSISTENCE_GAP, HOLLOW_ANSWER, DISPATCH_GAP, QUESTION_TYPE_BALANCE, EXHAUSTED_UNRESOLVED. (STORE_CLOBBER_RESTORED now logged via store-snapshot.ts.)

### Closed
- ~~**Findings store snapshot/restore**~~ — Implemented in `src/store-snapshot.ts` + wired into `conductor.ts` before `integrateHandoff`. Iter-18 regression covered by tests. Pre-integration snapshot persists at `projects/<name>/knowledge-snapshots/`; clobber triggers auto-restore; `STORE_CLOBBER_RESTORED` span captures full diff.

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something