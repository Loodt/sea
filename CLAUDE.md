# SEA Conductor

## State
- Conductor version: v034
- Inner loop: plan → research → summarize → synthesize → evaluate → evolve
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Pipeline step details: .claude/rules/execution.md
- Multi-provider: `--provider` flag or `SEA_PROVIDER` env. Default: claude. Alt: codex. Config in `types.ts`.

## Question Selection & Types
Rank by: information gain > priority > feasibility > domain data density > staleness > dependency-unlocking.
**Pruning mode** (auto when open >10 OR open:resolved >2:1): prioritize kill-check/synthesis, deprioritize mechanism, prefer existing over new.
Selection MUST reject near-duplicate open questions before creating new ones.
**Crash re-dispatch priority:** Crashed questions dispatch next — do not interleave.
**Compounding signal:** When total findings >80 OR verified >30, boost synthesis priority — but not above open questions never yet dispatched.
**Early-exit rule:** Any question type with 0 findings by iter 2 → force early-exit evaluation.
**Question generation cap:** Landscape dispatches create at most 5 new questions; non-landscape at most 3.
**Yield decay:** Same type dispatched ≥3× in project AND latest yield <50% of that type's project average → deprioritize; rotate to underrepresented types.
**Convergence taper:** newQuestionsCreated = 0 for 2+ consecutive dispatches AND iter ≥4 → frontier mapped. Boost synthesis/first-principles. Auto-generate synthesis if none and store >50 findings; regenerate if store grew >30 since last.
**Verification signal:** verified/total <35% after 10+ dispatches → boost kill-check and synthesis to consolidate provisionals. >10% findings untagged → flag for tag-debt cleanup.
**Type diversity:** After iter 4, first-principles AND design-space each required if (≥5 verified OR ≥20 SOURCE-tagged) and never dispatched — mandatory, not advisory. Cap data-hunt at 5× before a reasoning type.
**Synthesis consecutive cap:** Max 2 consecutive synthesis dispatches — then force rotation to non-synthesis type.
**Design-space generation:** When ≥3 mechanism/data-hunt questions resolved AND no design-space question exists AND iter ≥4 → auto-generate design-space question from resolved findings.
| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish frontier. |
| kill-check | 5 | Falsify hypotheses + produce findings. Prefer when >3 open pathways. |
| data-hunt | 5 | Specific values. Highest yield. Early-exit at iter 2 if 0 findings. |
| mechanism | 5 | How/why. Multi-iter convergence normal. |
| synthesis | 3 | Combine store findings. Yield scales with store size. Max 2 consecutive. |
| first-principles | 3 | Derive from axioms + verified findings. Mandatory after iter 4. Fast convergence (1-2 iters). |
| design-space | 4 | Map solution space from constraints. Mandatory after iter 4. Auto-generate when ≥3 mechanism/data-hunt resolved. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable (equally valuable as answered)
- **narrowed** — partial progress. Re-dispatch MUST include prior handoff findings
- **exhausted** — diminishing returns. Subtypes: data-gap | strategy-limit | infrastructure. Integration MUST create `[DERIVED: exhaustive-search]` finding. **Data-gap cascade:** auto-gate questions whose resolution depends on the gapped data (like empirical-gate).
- **crashed** — infrastructure failure. NOT exhausted, re-dispatch eligible. Integrate partial findings BEFORE persona reset
- **empirical-gate** — requires physical measurement; do not re-dispatch. **Cascade:** auto-gate dependent questions.
- For first-principles/design-space: "narrowed" + empirical-gate is SUCCESSFUL — do not penalize.

## Expert Pacing & Library
Search budget per iteration by question type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iterations get budget + 2. Budget does NOT limit file reads or knowledge store writes.
Personas stored by hash in expert-library/library.jsonl. Utility = avgIG × log(dispatches + 1). Factory adapts high-scoring persona (>2.0) instead of creating fresh. High-scoring personas (≥2.0, dispatches ≥2) promote to `global-expert-library.jsonl`.

## Finding Graduation
Provisional → verified when: confidence ≥ 0.85, tag = SOURCE with URL, age ≥ 3 dispatches, not contradicted.
**DERIVED graduation:** confidence ≥ 0.90, derivationChain with ≥2 premises (all verified), age ≥ 3, not contradicted. Trust cascade: axioms → SOURCE → DERIVED.
**DERIVED cascade lag:** DERIVED findings can only graduate after ALL premises verified — expect low DERIVED verification rates early. This is by design, not a graduation bug.
**derivationChain enforcement:** [DERIVED] without derivationChain is knowledge debt. Integration MUST downgrade to [ESTIMATED] if chain missing.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker, forced handoff. Recovery: zero prior-file loading, single question, 2 attempts → infrastructure
- **Conductor crash gate:** 2+ different questions crash consecutively → systemic failure, pause and diagnose
- **Hollow answer gate:** answered + 0 findingsAdded → log HOLLOW_ANSWER. >2 in project → review expert convergence and question scoping
- **Crash-score exclusion:** Crash scores MUST NOT trigger rollback
- **Summarize completeness:** Persisted findings must match produced. Log PERSISTENCE_GAP if not
- **Summarize before synthesize:** Store current before report. Finding IDs MUST exist in findings.jsonl
- **Score persistence:** Evaluate writes JSON scores block. Loop parses/persists
- **Summary size gate:** summary.md ≤2KB (code-enforced via `enforceSummarySize()`)
- **Completion gate:** All questions resolved (0 open) → status "completed". Conductor skips completed.
- **Verification floor:** Completed project with verified/total <30% → log LOW_VERIFICATION_COMPLETION. Not a hard block.
- **Lineage gate:** Evolve MUST produce lineage entry every iteration — including no-change holds. Missing lineage = silent drift.
- **Inner yield gate:** If inner iter ≥3 and previous iteration added 0 findings, force convergence assessment.

## Hard Rules
- Launch `sea conduct` as background task — wait for notification, do NOT poll
- Context budgets per agent: `types.ts` CONTEXT_BUDGETS
- Personas at full length; iter 1 uses file reference + critical sections (~6KB cap)
- Knowledge store is source of truth — not output/ reports
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`
- `[UNKNOWN]` over untagged guess; anchor comparisons (baseline, magnitude, conditions)
- Evaluate agent is independent critic — never sees persona or goal
- One evolution change at a time — hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop (3-iter rolling avg, exclude crashes); min 2 iters before judging
- Evolve: 2 heuristic failures on same issue → classify as infrastructure, stop trying
- Summarize MUST receive FULL raw findings — never truncate (32KB budget)
- Pattern library: ALL failure patterns loaded (no subset limits). New generalizable patterns → failure-patterns/ or success-patterns/
- Expert store writes idempotent: F9XX IDs → sequential; deduplicates by ID and claim text
- Landscape/first-principles/design-space IG = findingsAdded + questionsAdded
- Reasoning-type findings use `[DERIVED]` with derivationChain. No `[SOURCE]` without URL
- Do NOT dispatch first-principles/design-space on thin stores — minimum 5 verified OR 20 SOURCE-tagged in domain
- All JSONL writes use file-level locking (`file-lock.ts`)
- Findings without epistemic tags MUST NOT be persisted — reject or tag [UNKNOWN] at write time
- Kill signals prune entire branches — never deprioritize kill-check
- Metric questionType MUST match question record type — no silent reclassification at dispatch

## Evolution Protocol
Three valid outcomes:
1. **Behavioral change** — modify persona. Requires: hypothesis, measurement, rollback trigger.
2. **Strategic advancement** — update targets when questions resolved/blocked.
3. **No-change hold** — declare working. Record lineage with reasoning.
**Stagnation** (2 consecutive non-crash iters, zero findings + zero resolved): classify → exhausted, blocked, or wrong.
**Empirical plateau:** >2 questions exhausted "needs measurement" + remaining open depend on them → flag project empirical-gated.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20
**Reasoning-type override** (first-principles/design-space): accuracy: 0.25 | coverage: 0.10 | coherence: 0.15 | insight: 0.30 | process: 0.20

## Meta-Evolution Protocol
Read all lineage + metrics → identify cross-project patterns → verify protocol matches code → propose changes (versioner preserves old). Playbook is provider-dependent. Safety Rails are IMMUTABLE.

## Infrastructure Debt
Open gaps — requires code, not heuristic fixes.
1. **Data-gap cascade** — exhausted(data-gap) must auto-gate dependent questions
2. **Early-exit rule** — force evaluation when findingsAdded = 0 by iter 2
3. **Narrowed rebinding** — inject prior handoff findings into re-dispatch
4. **Observability logging** — code-enforce PERSISTENCE_GAP, HOLLOW_ANSWER, and LOW_VERIFICATION_COMPLETION
5. **Lineage code enforcement** — evolve step must code-write lineage entry, not rely on LLM compliance
6. **Reasoning-type dispatch thresholds** — conductor-context.ts uses iter >6/>5; must sync to playbook iter 4

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
