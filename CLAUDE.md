# SEA Conductor

## State
- Conductor version: v021
- Inner loop: plan → research → summarize → synthesize → evaluate → evolve
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Pipeline step details: .claude/rules/execution.md

## Question Selection & Types
Rank by: information gain > priority > feasibility > domain data density > staleness > dependency-unlocking.
**Pruning mode** (auto when open >15 OR open:resolved >2:1): prioritize kill-check/synthesis, deprioritize mechanism, prefer existing questions over new landscape scope.
Selection MUST reject near-duplicate open questions before creating new ones.
**Crash re-dispatch priority:** Questions that crashed (infrastructure) dispatch next — do not interleave.
**Compounding signal:** When verified findings >40 OR provisional:verified ratio >3:1, boost synthesis question priority.
**Early-exit rule:** Any question type with 0 findings by iter 2 → force early-exit evaluation. Cross-project data: 0-by-iter-2 correlates with crash or exhaustion regardless of question type.

| Type | Cap | Selection guidance |
|------|-----|-------------------|
| landscape | 5 | Broad survey. Dispatch first to establish frontier. |
| kill-check | 5 | Hypothesis falsification. Prefer when >3 open pathways. |
| data-hunt | 5 | Specific values. Highest exhaustion risk. Early-exit at iter 2 if 0 findings. |
| mechanism | 5 | How/why. Full-budget convergence normal. |
| synthesis | 2 | Combine store findings. Dispatch when store >40 verified. Yield correlates with verified%. |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable (equally valuable as answered)
- **narrowed** — partial progress. Re-dispatch MUST include prior handoff findings *(debt #3)*
- **exhausted** — diminishing returns. Integration MUST create `[DERIVED: exhaustive-search]` finding
- **crashed** — infrastructure failure. NOT exhausted, re-dispatch eligible. Integrate partial findings BEFORE persona reset on re-dispatch
- **empirical-gate** — question requires physical measurement/bench test that literature cannot resolve. Do not re-dispatch; flag for human action

## Expert Pacing
Each inner iteration is search-budgeted by question type (defined in `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`). Injected at prompt assembly time. Final iterations get budget + 2 for synthesis gap-filling. Budget does NOT limit file reads, knowledge store writes, or other non-search tool use.

## Global Expert Library
High-scoring expert personas (score > 2.0, dispatches >= 2) are promoted to `global-expert-library.jsonl` after each dispatch. New projects search the global library as a fallback when no local expert match exists. Adapted personas track cross-project lineage via `adaptedFrom`. CLI: `sea global-experts [project]`.

## Expert Library
Personas stored by hash in expert-library/library.jsonl. Utility = avgIG x log(dispatches + 1). Factory checks library for matches by questionType + domain overlap (normalized to [0,1]); adapts high-scoring persona (>2.0) instead of creating fresh. Adapted entries track lineage via `adaptedFrom` field.

## Finding Graduation
Provisional findings auto-graduate to verified when: confidence >= 0.85, tag = SOURCE with URL, age >= 3 dispatches, not contradicted. Runs after each dispatch.

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker, forced handoff from best successful output. Recovery: zero prior-file loading, single research question, incremental traces, 2 attempts → infrastructure issue
- **Conductor crash gate:** 2+ different questions crash consecutively → systemic infrastructure failure. Pause and diagnose before next dispatch *(debt #5)*
- **Hollow answer gate:** answered + 0 findingsAdded → log HOLLOW_ANSWER, do not count as productive convergence *(debt #4)*
- **Crash-score exclusion:** Crash scores MUST NOT trigger rollback *(debt #1)*
- **Summarize completeness:** Persisted findings must match produced. Log PERSISTENCE_GAP if not *(debt #2)*
- **Summarize before synthesize:** Store current before report. Finding IDs MUST exist in findings.jsonl
- **Score persistence:** Evaluate writes JSON scores block. Loop parses/persists. Evaluate MUST NOT write scores.jsonl
- **Summary size gate:** summary.md MUST stay ≤2KB. Code-enforced: `enforceSummarySize()` runs after every integration
- **Completion gate:** All questions resolved (0 open, 0 exhausted-pending) → set project status "completed" in state.json. Conductor skips completed projects.
- **Crash maturity:** Cross-project data: zero crashes after iteration 7. Crashes in mature projects (iter >7) are regressions, not normal — investigate immediately.

## Multi-Provider Support
SEA supports multiple LLM CLI backends via `--provider` flag (or `SEA_PROVIDER` env var). Default: `claude`.

| Provider | Binary | Conductor playbook |
|----------|--------|--------------------|
| `claude` | `claude -p` | `CLAUDE.md` |
| `codex` | `codex exec` | `AGENTS.md` |

Reads fall back across providers: if `AGENTS.md` missing, reads `CLAUDE.md` (and vice versa). Meta-evolution writes to the active provider's file. Provider config lives in `types.ts` `PROVIDERS` record.

## Running the Conductor
When running `sea conduct` or any long-running CLI command, launch it as a background task and **wait for the completion notification**. Do NOT poll.

## Hard Rules
- Context budgets per agent: defined in `types.ts` CONTEXT_BUDGETS
- Personas stored at full length; iter 1 prompt uses file reference + extracted critical sections to stay under ~6KB
- Knowledge store is source of truth — not output/ reports
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`
- `[UNKNOWN]` over untagged guess; anchor comparisons (baseline, magnitude, conditions)
- Evaluate agent is independent critic — never sees persona or goal
- One evolution change at a time — hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop (3-iter rolling avg, exclude crashes); min 2 iters before judging, check failure-patterns/ first
- Evolve: 2 heuristic failures on same issue → classify as infrastructure, stop trying
- Summarize MUST receive FULL raw findings — never truncate (32KB budget)
- ALL failure patterns loaded — no subset limits
- Expert store writes idempotent: F9XX IDs → sequential; integration deduplicates by finding ID and claim text
- Landscape dispatches: IG = findingsAdded + questionsAdded (questions are the primary output)
- All JSONL writes use file-level locking (`file-lock.ts`) for parallelization safety
- New generalizable failures → failure-patterns/; new successes → success-patterns/
- Domain-specific experts converge faster — preserve "defining trait" + "core values" in persona creation
- Kill signals prune entire branches — never deprioritize kill-check questions
- Verification rate tracks domain maturity, not conductor quality — do not evolve persona to "fix" low verification in source-scarce domains

## Evolution Protocol
Three valid outcomes:
1. **Behavioral change** — modify persona. Requires: hypothesis, measurement, rollback trigger.
2. **Strategic advancement** — update targets when questions resolved/blocked.
3. **No-change hold** — declare working. Record lineage with reasoning.
**Stagnation** (2 consecutive non-crash iters, zero findings + zero resolved): classify → exhausted (pivot question), blocked (mark, pivot), wrong (kill, reformulate).
**Empirical plateau:** When >2 questions exhausted with "needs measurement" AND remaining open questions depend on those measurements → flag project as empirical-gated. Stop dispatching literature-only experts against gated questions.
Experts are disposable specialists — knowledge store is persistent memory, not persona.

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20

## Discovery
Ask: goal, criteria, domain, sources, format. Create dirs + goal.md, persona.md (seeded from failure-patterns/), pipeline.json, state.json. Seed questions.jsonl with 3-5 high-priority questions.

## Meta-Evolution Protocol
Read all lineage + metrics → identify cross-project patterns → verify protocol matches code → propose conductor playbook changes (versioner preserves old). The playbook filename is provider-dependent (CLAUDE.md or AGENTS.md). Safety Rails are IMMUTABLE.

## Infrastructure Debt
Open gaps between protocol and implementation. Do not attempt heuristic fixes — each requires code.

1. **Crash-score exclusion** — `crashIteration` field on Score, filter in `isRegressing()`.
2. **Summarize completeness gate** — Count findings before/after, log PERSISTENCE_GAP.
3. **Narrowed dispatch rebinding** — Inject prior handoff findings into expert creation.
4. **Hollow answer detection** — Partial: landscape IG counts questions, findingsAdded uses max(fileDelta, handoffDelta). Missing: HOLLOW_ANSWER log for non-landscape types.
5. **Conductor crash detection** — Partial: in-conductor retry with fresh persona. Missing: 2+ different questions crashing → circuit breaker.
6. **Early-exit rule enforcement** — Code must force evaluation exit when findingsAdded = 0 by iter 2.
7. **Crash re-dispatch priority** — Question selector must prefer crashed questions over other open questions.

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
