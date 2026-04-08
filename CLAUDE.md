# SEA Conductor

## State
- Conductor version: v025
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
**Compounding signal:** When verified findings >30 OR provisional:verified ratio >2:1, boost synthesis priority.
**Early-exit rule:** Any question type with 0 findings by iter 2 → force early-exit evaluation.
**Question generation cap:** Landscape dispatches create at most 5 new questions; non-landscape at most 3.
**Yield signal:** data-hunt ~19/dispatch (highest). mechanism ~13 with 1-2 iter convergence. kill-check ~12, single-iter, dual-value (prunes + produces findings). Prefer data-hunt for data-dense domains.
**Convergence taper:** newQuestionsCreated = 0 for 2+ consecutive dispatches → frontier mapped. Boost synthesis/first-principles priority. If no synthesis question exists and store >50 findings, auto-generate one.

| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish frontier. |
| kill-check | 5 | Falsify hypotheses + produce findings. Prefer when >3 open pathways. |
| data-hunt | 5 | Specific values. Highest yield. Early-exit at iter 2 if 0 findings. |
| mechanism | 5 | How/why. Full-budget convergence normal. |
| synthesis | 2 | Combine store findings. Dispatch when store >30 verified. Yield correlates with verified%. |
| first-principles | 3 | Derive from axioms + verified findings. Requires ≥5 verified in domain. |
| design-space | 4 | Map solution space from constraints. Requires ≥5 verified in domain. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable (equally valuable as answered)
- **narrowed** — partial progress. Re-dispatch MUST include prior handoff findings
- **exhausted** — diminishing returns. Integration MUST create `[DERIVED: exhaustive-search]` finding
- **crashed** — infrastructure failure. NOT exhausted, re-dispatch eligible. Integrate partial findings BEFORE persona reset
- **empirical-gate** — requires physical measurement; do not re-dispatch. **Cascade:** auto-gate dependent questions.
- For first-principles/design-space: "narrowed" + empirical-gate is SUCCESSFUL — do not penalize.

## Expert Pacing & Library
Search budget per iteration by question type: `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`. Final iterations get budget + 2. Budget does NOT limit file reads or knowledge store writes.
Personas stored by hash in expert-library/library.jsonl. Utility = avgIG × log(dispatches + 1). Factory adapts high-scoring persona (>2.0) instead of creating fresh. High-scoring personas (≥2.0, dispatches ≥2) promote to `global-expert-library.jsonl`.

## Finding Graduation
Provisional → verified when: confidence ≥ 0.85, tag = SOURCE with URL, age ≥ 3 dispatches, not contradicted.
**DERIVED graduation:** confidence ≥ 0.90, derivationChain with ≥2 premises (all verified), age ≥ 3, not contradicted. Trust cascade: axioms → SOURCE → DERIVED.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker, forced handoff. Recovery: zero prior-file loading, single question, 2 attempts → infrastructure
- **Conductor crash gate:** 2+ different questions crash consecutively → systemic failure, pause and diagnose
- **Hollow answer gate:** answered + 0 findingsAdded → log HOLLOW_ANSWER
- **Crash-score exclusion:** Crash scores MUST NOT trigger rollback
- **Summarize completeness:** Persisted findings must match produced. Log PERSISTENCE_GAP if not
- **Summarize before synthesize:** Store current before report. Finding IDs MUST exist in findings.jsonl
- **Score persistence:** Evaluate writes JSON scores block. Loop parses/persists
- **Summary size gate:** summary.md ≤2KB (code-enforced via `enforceSummarySize()`)
- **Completion gate:** All questions resolved (0 open) → status "completed". Conductor skips completed.
- **Crash maturity:** Zero crashes expected after iteration 7. Late crashes are regressions.

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
- ALL failure patterns loaded — no subset limits
- Expert store writes idempotent: F9XX IDs → sequential; deduplicates by ID and claim text
- Landscape/first-principles/design-space IG = findingsAdded + questionsAdded
- Reasoning-type findings use `[DERIVED]` with derivationChain. No `[SOURCE]` without URL
- Do NOT dispatch first-principles/design-space on thin stores — minimum 5 verified in domain
- All JSONL writes use file-level locking (`file-lock.ts`)
- New generalizable failures → failure-patterns/; new successes → success-patterns/
- Domain-specific experts converge faster — preserve "defining trait" + "core values"
- Kill signals prune entire branches — never deprioritize kill-check

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
Open gaps — each requires code, not heuristic fixes.
1. **Crash-score exclusion** — filter crash iterations in `isRegressing()`
2. **Summarize completeness** — count findings before/after, log PERSISTENCE_GAP
3. **Narrowed rebinding** — inject prior handoff findings into re-dispatch
4. **Hollow answer detection** — HOLLOW_ANSWER log for non-landscape types
5. **Conductor crash detection** — cross-question crash circuit breaker
6. **Early-exit rule** — force evaluation exit when findingsAdded = 0 by iter 2
7. **Crash re-dispatch** — selector prefers crashed questions over open

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
