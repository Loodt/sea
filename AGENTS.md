# SEA Conductor

## State
- Conductor version: v024
- Inner loop: plan → research → summarize → synthesize → evaluate → evolve
- Outer loop: select-question → create-expert → expert-loop → integrate-handoff
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Observational notes belong in `dispatch-patterns.md`, not this playbook

## Question Selection
- Rank by: decision movement per cost > information gain > priority > feasibility > domain data density > staleness > dependency-unlocking
- Selection telemetry MUST backfill missing `questionType` from `questions.jsonl` before pattern analysis
- Selection MUST reject near-duplicate open questions before creating new ones
- **Crash priority:** crashed questions re-dispatch next and must not be interleaved
- **Pruning mode** (auto when open >15 OR open:resolved >2:1): prefer existing questions, boost kill-check/synthesis, deprioritize mechanism, avoid new landscape scope unless it collapses uncertainty
- **Closure pressure:** if 2 of the last 3 answered/narrowed dispatches added findings but resolved 0 questions and created 0 questions, the next dispatch MUST be synthesis or kill-check unless no explicit branch exists
- **Landscape admission:** use landscape for frontier mapping, stale-refresh, or question generation; if the last landscape added 0 questions and resolved 0 questions, do not dispatch another landscape next unless selection quality has clearly degraded
- **Kill-check bias:** after an unresolved deep dive, kill-check outranks mechanism; kill signals prune branches and must never be deprioritized
- **Mechanism admission:** dispatch only when the causal boundary is explicit and at least 2 relevant findings already constrain the search
- **Data-hunt admission:** dispatch only when the target datum, likely source class, and decision unlocked are named; otherwise reformulate as kill-check or landscape
- **Synthesis admission:** dispatch only when the question names the contradiction, branch decision, or closeout target it will resolve from existing findings; "summarize what we know" is not valid
- **Mature-store bias:** when verified findings >25, or recent answered dispatches are adding findings without movement, boost synthesis before more mechanism/landscape work
- **Movement gate:** if a synthesis or mechanism dispatch adds findings but resolves 0 questions, the next dispatch should be landscape or kill-check unless a new contradiction is explicit
- **Early-exit gate:** any question type with 0 findings by iter 2 forces early-exit evaluation

| Type | Cap | Use when |
|------|-----|----------|
| landscape | 5 | Broad survey, frontier refresh, or question generation when the frontier is stale |
| kill-check | 5 | >3 open pathways exist, a branch needs falsification, or a deep dive stalled |
| data-hunt | 3 | A specific public datum likely exists and the decision unlocked is named |
| mechanism | 5 | How/why question constrained by prior findings |
| synthesis | 2 | Existing findings can resolve a named contradiction, branch, or closeout |

## Expert Convergence
- **answered** — resolved with well-evidenced findings
- **killed** — non-viable; same value class as answered
- **narrowed** — partial progress. Re-dispatch MUST include prior handoff findings
- **exhausted** — diminishing returns. Integration MUST create a `[DERIVED: exhaustive-search]` finding
- **crashed** — infrastructure failure, not exhaustion. Integrate partial findings before any re-dispatch

## Expert Library
- Personas stored by hash in `expert-library/library.jsonl`
- Utility = avgIG x log(dispatches + 1), but reuse decisions should prefer question movement over raw finding count
- Factory matches on `questionType` + domain overlap, adapts high-scoring personas (>2.0), and records lineage via `adaptedFrom`
- Suggested expert types MUST be domain-specific specialists, not generalists; include domain + mechanism/objective in the label
- Domain-specific experts outperform generalists once the locus is narrowed; preserve defining trait + core values in persona creation

## Knowledge Growth
- Healthy store growth is decision movement, not raw finding count
- Dispatch value = questionsResolved + questionsAdded + branches killed; findings are support for movement
- Landscape success = questionsAdded first, findingsAdded second
- Synthesis success = contradiction closure, branch pruning, or question resolution from existing findings
- Mechanism/data-hunt findings without question movement should trigger reformulation review before another like-for-like deep dive
- After 2 consecutive unresolved mechanism/data-hunt dispatches, the next dispatch should be kill-check or synthesis unless no alternative branch exists
- Provisional findings auto-graduate to verified when confidence >= 0.85, tag = SOURCE with URL, age >= 3 dispatches, and no contradiction exists

## Step Gates
- **Crash gate:** 2 consecutive crashes → circuit breaker, forced handoff from best successful output. Recovery: zero prior-file loading, single research question, incremental traces, 2 attempts
- **Hollow answer gate:** answered + 0 findingsAdded + 0 questionsResolved + 0 questionsAdded = non-productive convergence
- **Summarize before synthesize:** store current before report. Finding IDs MUST exist in `findings.jsonl`
- **Summarize completeness:** persisted findings must match produced. Log `PERSISTENCE_GAP` if not
- **Score persistence:** evaluate writes a JSON scores block; loop parses and persists it. Evaluate MUST NOT write `scores.jsonl`
- **Summary size gate:** `summary.md` MUST stay ≤2KB. `enforceSummarySize()` runs after every integration

## Multi-Provider
- SEA supports `--provider` / `SEA_PROVIDER`; default: `claude`
- Providers: `claude -p` → `CLAUDE.md`, `codex exec` → `AGENTS.md`
- Reads fall back across providers if the active file is missing
- Meta-evolution writes to the active provider file
- Provider config lives in `types.ts` `PROVIDERS`

## Running
- When running `sea conduct` or any long-running CLI command, launch it as a background task and wait for the completion notification. Do NOT poll

## Hard Rules
- Context budgets per agent: `types.ts` `CONTEXT_BUDGETS`
- Personas are stored at full length; iter 1 prompts use file references + critical extracts to stay under ~6KB
- Knowledge store is the source of truth, not output reports
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`
- Prefer `[UNKNOWN]` over untagged guess; anchor comparisons with baseline, magnitude, and conditions
- Evaluate agent is an independent critic and never sees persona or goal
- One evolution change at a time: hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop (3-iter rolling avg, excluding crashes once implemented); minimum 2 iters before judging
- Evolve: 2 heuristic failures on the same issue → classify as infrastructure and stop retrying heuristics
- Summarize MUST receive full raw findings; never truncate inside the summarize step
- All failure patterns load; no subset limits
- Integration deduplicates by finding ID today; claim-text dedup remains open code debt
- Meta-evolution compares store outcomes with metrics; if telemetry is incomplete, trust the knowledge store and note the gap
- All JSONL writes use file-level locking via `file-lock.ts`
- New generalizable failures → `failure-patterns/`; new successes → `success-patterns/`

## Evolution Protocol
1. **Behavioral change** — modify persona. Requires hypothesis, measurement, and rollback trigger
2. **Strategic advancement** — update targets when questions are resolved, blocked, or closure pressure changes dispatch mix
3. **No-change hold** — declare working and record lineage with reasoning
- **Stagnation:** 2 consecutive non-crash iters with zero findings and zero resolved → classify as exhausted (pivot question), blocked (mark and pivot), or wrong (kill and reformulate)
- Experts are disposable specialists; the knowledge store is persistent memory

## Scoring Weights
- accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20

## Discovery
- Ask: goal, criteria, domain, sources, format
- Create dirs + `goal.md`, `persona.md`, `pipeline.json`, `state.json`
- Seed `questions.jsonl` with 3-5 high-priority questions

## Meta-Evolution
- Read lineage + metrics, identify cross-project patterns, verify protocol matches code, then update the active provider playbook
- Prefer behavior-changing rules over observational commentary; if a note does not change dispatch behavior, keep it out of this file
- Safety Rails are IMMUTABLE

## Infrastructure Debt
- **Crash-score exclusion** — add `crashIteration` to `Score` and filter it in `isRegressing()`
- **Summarize completeness gate** — count findings before/after integration and log `PERSISTENCE_GAP` on mismatch
- **Narrowed dispatch rebinding** — inject prior handoff findings into expert creation on re-dispatch
- **Finding deduplication** — deduplicate by claim text, not just ID

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
