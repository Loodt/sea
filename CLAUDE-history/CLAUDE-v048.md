# SEA Conductor

## State
- Conductor version: v048
- Inner loop: plan → research → summarize → synthesize → evaluate → evolve
- Outer loop: select-question → hybrid-research (single LLM call, replaces create-expert + expert-loop + integrate)
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Pipeline step details: .claude/rules/execution.md
- Multi-provider: `--provider` flag or `SEA_PROVIDER` env. Default: claude. Alt: codex. Config in `types.ts`.

## Question Selection & Types
Rank by: decision-relevance per research cost > information gain > priority > feasibility > data density > staleness > dependency-unlocking.
**Pruning mode** (auto when open >15 OR open:resolved >2:1): prioritize kill-check/synthesis, deprioritize mechanism, prefer existing over new. Escalation: >3:1 → cap new questions at 1; >4:1 → cap at 0.
Selection MUST reject near-duplicate open questions before creating new ones.
**Crash re-dispatch priority:** Crashed questions dispatch next — do not interleave.
**Store maturity signal:** When total findings >60 OR verified >30, boost synthesis priority (not above never-dispatched questions). When newQuestionsCreated = 0 for 2+ consecutive dispatches AND iter ≥4 → frontier mapped; boost synthesis/first-principles. Auto-generate synthesis if none and store >50 findings; regenerate if store grew >30 since last.
**Synthesis starvation:** After 8+ dispatches since last synthesis (or 0 ever) AND store >40 findings AND grew >15 since last synthesis → mandatory synthesis next. Recurrent — triggers each time gap exceeds 8. At store >100, reduce gap to 5. **Velocity override:** mandatory when 0 synthesis ever dispatched AND store >60 findings — do not wait for dispatch count.
**Early-exit rule:** Any question type with 0 findings by iter 2 → force early-exit evaluation.
**Question generation cap:** Landscape dispatches create at most 5 new questions; non-landscape at most 3.
**Question convergence:** After iter 12 with open >12, cap new questions at 1 for all types. After iter 18 with open >8, cap at 0 — resolve existing before creating new.
**Late convergence:** After iter 20 with >70% resolved, cap new questions at 0 for all non-kill-check types. Prioritize synthesis + kill-check to consolidate remaining open questions.
**Yield decay:** Same type dispatched ≥3× in project AND latest yield <50% of that type's project average → deprioritize; rotate to underrepresented types.
**Type diversity:** After iter 4, first-principles AND design-space each required if (≥5 verified OR ≥20 SOURCE-tagged) and never dispatched — mandatory, not advisory. Cap data-hunt at 5× before a reasoning type.
**Reasoning recurrence:** After 6+ dispatches since last reasoning type (first-principles/design-space) AND store grew >40 findings since then → boost reasoning type. Prevents type drift in long projects.
**Data-hunt fatigue:** ≥2 data-hunt exhaustions in a project → deprioritize remaining open data-hunts; rotate to synthesis/reasoning to extract value from existing store. **Queue concentration:** >5 open data-hunts → apply fatigue rules preemptively (boost reasoning/synthesis) even without exhaustion.
**Exhaustion cluster:** ≥2 exhausted in last 4 dispatches → next MUST be synthesis or first-principles. Data wall detected — rotate to reasoning types.
| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish frontier. |
| kill-check | 5 | Falsify hypotheses + produce findings. Prefer when >3 open pathways. |
| data-hunt | 5 | Specific values. Highest yield. Early-exit at iter 2 if 0 findings. |
| mechanism | 5 | How/why. Multi-iter convergence normal. |
| synthesis | 3 | Combine store findings. Yield scales with store size; at maturity (>60 findings) expect 8-10 yield. |
| first-principles | 3 | Derive from axioms + verified findings. Mandatory after iter 4. Fast convergence (1-2 iters). |
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
- **Re-dispatch blocks:** Never re-dispatch exhausted (same question exhausted twice → permanent-gap), answered, or killed questions. Pre-dispatch: verify question status = 'open' in questions.jsonl. Post-dispatch: code enforces resolution writes. Log ANSWERED_REDISPATCH.
- **Dispatch gap gate:** Iteration advances without dispatch → log DISPATCH_GAP. 2+ gaps in 5 iterations → diagnose question selector.
- **Question ID gate:** IDs MUST be unique. Code normalizes duplicates post-dispatch; prompt provides next-free ID.

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
- Do NOT dispatch first-principles/design-space on thin stores — minimum 5 verified OR 20 SOURCE-tagged in domain
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

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Meta-Evolution Protocol
Read all lineage + metrics → identify cross-project patterns → verify protocol matches code → propose changes (versioner preserves old). Playbook is provider-dependent. Safety Rails are IMMUTABLE.

## Infrastructure Debt
Open gaps — requires code, not heuristic fixes. Priority: CRITICAL > HIGH > MEDIUM.
1. **Same-type cap enforcement** — code-level consecutive detection + prompt hard warning active (v048). Full code-level hard block (reject dispatch) still desirable.
2. **Early-exit rule** — force evaluation when findingsAdded = 0 by iter 2
3. **Observability logging** — code-enforce PERSISTENCE_GAP, HOLLOW_ANSWER, LOW_VERIFICATION_COMPLETION, DISPATCH_GAP

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something