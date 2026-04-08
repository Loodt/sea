# SEA Conductor

## State
- Conductor version: v029
- Inner loop: plan -> research -> summarize -> synthesize -> evaluate -> evolve
- Outer loop: select-question -> create-expert -> expert-loop -> integrate-handoff
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project

## Question Selection
- Rank by: decision movement per cost > information gain > priority > feasibility > domain data density > staleness > dependency-unlocking
- Selection telemetry MUST backfill missing `questionType` from `questions.jsonl` before pattern analysis
- Selection MUST reject near-duplicate open questions before creating new ones
- **Crash priority:** crashed questions re-dispatch next and must not be interleaved
- **Pruning mode:** auto when open >15 OR open:resolved >2:1; prefer existing questions, boost synthesis/kill-check, deprioritize mechanism, avoid new landscape unless it collapses uncertainty
- **Movement pressure:** if 2 of the last 3 answered/narrowed dispatches added findings but resolved 0 questions and created 0 questions, the next dispatch MUST be synthesis or kill-check unless no explicit branch exists
- **Branch-starvation gate:** if the last 4 non-crash dispatches created <=1 new question total and unresolved frontier remains, the next dispatch MUST be either synthesis closeout or a landscape refresh; do not continue a mechanism/data-hunt chain
- **Branch-generation pressure:** if the last 2 non-crash dispatches resolved questions but created <=1 new question total, exploit the current branch set before opening fresh landscape scope
- **Landscape admission:** use for frontier mapping, stale refresh, or branch generation; if the last landscape added 0 questions and resolved 0 questions, do not dispatch another landscape next unless selection quality clearly degraded
- **Landscape cooldown:** if 2 consecutive landscapes resolve questions but create 0 new questions, do not open a third landscape until branch stock is exhausted or the frontier is explicitly stale
- **Kill-check admission:** use to falsify a named branch; if it adds findings but kills 0 branches and resolves 0 questions, the next dispatch should be synthesis or landscape unless a sharper kill target now exists
- **Mechanism admission:** dispatch only when the causal boundary is explicit, at least 2 relevant findings constrain the search, and the answer would change a live branch decision
- **Mechanism retry gate:** after a mechanism dispatch resolves 0 questions and creates 0 questions, do not run another mechanism next unless it targets a different causal boundary
- **Data-hunt admission:** dispatch only when the target datum, likely source class, and decision unlocked are named; otherwise reformulate as kill-check or landscape
- **Data-hunt exhaustion bias:** if a data-hunt produces 0 concrete data by iter 2, treat the gap as structural and pivot to synthesis, indirect estimation, or empirical-gate review
- **Synthesis admission:** dispatch only when the question names the contradiction, branch decision, closeout target, or sensitivity check it will resolve from existing findings
- **First-principles admission:** dispatch when the question requires a novel derived conclusion (not findable by search), OR ≥2 data-hunts exhausted on the same topic, OR the question asks for a calculated/derived answer. PREREQUISITE: ≥5 verified findings in the question's domain. Expert is a Reasoner — search budget is 1 (validation only).
- **Design-space admission:** dispatch when the question asks to compare approaches, OR ≥3 mechanism questions resolved and next step is "which approach is best". PREREQUISITE: ≥5 verified findings in the question's domain. Expert is an Architect — search budget is 2 (validation only).
- **Reasoning prerequisite gate:** do NOT dispatch first-principles or design-space on a thin knowledge store. If verified count in the target domain is <5, dispatch data-hunt or mechanism first to build the foundation.
- **Mature-store bias:** when verified findings >25, or recent dispatches add findings without movement, boost synthesis before more mechanism/landscape work
- **Early-exit gate:** any question type with 0 findings by iter 2 forces early-exit evaluation

| Type | Cap | Use when |
|------|-----|----------|
| landscape | 5 | Broad survey, frontier refresh, or question generation when the frontier is stale |
| kill-check | 5 | >3 open pathways exist, a branch needs falsification, or a deep dive stalled |
| data-hunt | 5 | A specific public datum likely exists and the decision unlocked is named |
| mechanism | 5 | How/why question constrained by prior findings and tied to a live branch |
| synthesis | 5 | Existing findings can resolve a named contradiction, branch, closeout, or sensitivity check |
| first-principles | 3 | Derive novel conclusion from axioms + verified findings; not findable by search. Requires ≥5 verified findings in domain |
| design-space | 4 | Map solution space from constraints; ≥2 viable approaches need systematic comparison. Requires ≥5 verified findings in domain |

## Expert Convergence
- **answered** - resolved with well-evidenced findings
- **killed** - non-viable; same value class as answered
- **narrowed** - partial progress. Re-dispatch MUST include prior handoff findings
- **exhausted** - diminishing returns, not empty output by definition. Integration MUST preserve any findings, create a `[DERIVED: exhaustive-search]` finding, and pivot the next dispatch toward synthesis, kill-check, or a reformulated question
- **crashed** - infrastructure failure, not exhaustion. Integrate partial findings before any re-dispatch
- For first-principles/design-space: "narrowed" with a new empirical-gate question is a SUCCESSFUL outcome — identified what data is needed
- **empirical-gate** - question requires physical measurement or bench testing that literature cannot resolve. Flag for human action instead of repeated literature dispatches

## Expert Pacing
Each inner iteration is search-budgeted by question type (defined in `types.ts` `QUESTION_TYPE_SEARCH_BUDGET`). Injected at prompt assembly time. Final iterations get budget + 2 for synthesis gap-filling. Budget does NOT limit file reads, knowledge store writes, or other non-search tool use.

## Global Expert Library
High-scoring expert personas (score > 2.0, dispatches >= 2) are promoted to `global-expert-library.jsonl` after each dispatch. New projects search the global library as a fallback when no local expert match exists. Adapted personas track cross-project lineage via `adaptedFrom`. CLI: `sea global-experts [project]`.

## Expert Reuse
- Personas are stored by hash in `expert-library/library.jsonl`
- Utility = avgIG x log(dispatches + 1), but reuse decisions should prefer question movement, branch creation, and low-iteration resolution over raw finding count
- Factory matches on `questionType` + domain overlap, adapts high-scoring personas (>2.0), and records lineage via `adaptedFrom`
- Suggested expert types MUST be domain-specific specialists, not generalists; include domain + mechanism/objective in the label
- Prefer expert types that resolve questions in <=2 iterations; penalize types that repeatedly add findings without movement or branch generation

## Knowledge Growth
- Healthy store growth is decision movement, not raw finding count
- Landscape success = questionsAdded first, findingsAdded second
- Synthesis success = contradiction closure, branch pruning, sensitivity closure, or question resolution from existing findings
- Mechanism/data-hunt findings without question movement should trigger reformulation review before another like-for-like deep dive
- Exhausted dispatches with findings are branch-shaping evidence, not wasted work; feed them into synthesis/selection before retrying the same path
- If multiple open questions now depend on missing physical measurements, mark the branch empirical-gated instead of repeating literature-only dispatches
- Provisional findings auto-graduate to verified when confidence >= 0.85, tag = SOURCE with URL, age >= 3 dispatches, and no contradiction exists

## Integrity Gates
- The producer must not be the final judge of its own output; the evaluate agent stays independent and never sees persona or goal
- Tag every substantive claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`
- `[SOURCE]` means the cited source directly supports the claim; if the claim is computed, combined, generalized, or inferred from sources, tag it `[DERIVED]`
- Every `[SOURCE: ...]` tag MUST match the cited reference entry and claim scope before submission; citation existence is not enough
- Prefer `[UNKNOWN]` over an untagged guess; anchor comparisons with baseline, magnitude, and conditions

## Step Gates
- **Crash gate:** 2 consecutive crashes -> circuit breaker, forced handoff from best successful output. Recovery: zero prior-file loading, single research question, incremental traces, 2 attempts
- **Hollow answer gate:** answered + 0 findingsAdded + 0 questionsResolved + 0 questionsAdded = non-productive convergence
- **Movement gate:** answered, narrowed, or exhausted with findingsAdded >0 but questionsResolved = 0 and newQuestionsCreated = 0 should shift the next dispatch toward synthesis, kill-check, landscape, or empirical-gate review rather than repeating the same deep-dive mode
- **Summarize before synthesize:** store current before report. Finding IDs MUST exist in `findings.jsonl`
- **Summarize completeness:** persisted findings must match produced. Log `PERSISTENCE_GAP` if not
- **Score persistence:** evaluate writes a JSON scores block; loop parses and persists it. Evaluate MUST NOT write `scores.jsonl`
- **Summary size gate:** `summary.md` MUST stay <=2KB. `enforceSummarySize()` runs after every integration
- **Completion gate:** if all questions are resolved and no crashed/exhausted question needs re-dispatch, mark the project complete and stop opening new experts

## Multi-Provider
- SEA supports `--provider` / `SEA_PROVIDER`; default: `claude`
- Providers: `claude -p` -> `CLAUDE.md`, `codex exec` -> `AGENTS.md`
- Reads fall back across providers if the active file is missing
- Meta-evolution writes to the active provider file

## Running
- Prefer SEA CLI commands over ad hoc scripts when execution is required
- `npx tsx` spawns esbuild subprocesses that Codex's sandbox blocks. Use `npm run build`, then `node dist/cli.js` instead of `npx tsx src/cli.ts`
- On Windows, long-running `sea conduct` or `sea loop` commands should launch in a visible `cmd.exe` window unless the user explicitly asks for background execution or log capture
- Preferred Windows launch pattern: `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', 'cd /d <repo> && node dist/cli.js --provider codex <command>') -PassThru`

## Hard Rules
- Context budgets per agent: `types.ts` `CONTEXT_BUDGETS`
- Personas are stored at full length; iter 1 prompts use file references + critical extracts to stay under ~6KB
- Knowledge store is the source of truth, not output reports
- One evolution change at a time: hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop (3-iter rolling avg); minimum 2 iters before judging
- Evolve: 2 heuristic failures on the same issue -> classify as infrastructure and stop retrying heuristics
- Summarize MUST receive full raw findings; never truncate inside the summarize step
- Integration deduplicates by claim text and ID; avoid re-adding an already known claim
- Meta-evolution compares store outcomes with metrics; if telemetry is incomplete, trust the knowledge store and note the gap
- If prompt and code disagree, align the prompt to implemented behavior or record the mismatch as explicit debt in lineage
- All JSONL writes use file-level locking via `file-lock.ts`
- New generalizable failures -> `failure-patterns/`; new successes -> `success-patterns/`

## Evolution Protocol
1. **Behavioral change** - modify persona. Requires hypothesis, measurement, and rollback trigger
2. **Strategic advancement** - update targets when questions are resolved, blocked, or closure pressure changes dispatch mix
3. **No-change hold** - declare working and record lineage with reasoning
- **Stagnation:** 2 consecutive non-crash iters with zero findings and zero resolved -> classify as exhausted, blocked, wrong, or empirical-gated
- Experts are disposable specialists; the knowledge store is persistent memory

## Scoring Weights
- accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20

## Discovery
- Ask: goal, criteria, domain, sources, format; create dirs + `goal.md`, `persona.md`, `pipeline.json`, `state.json`; seed `questions.jsonl` with 3-5 high-priority questions

## Meta-Evolution Protocol
- Read lineage + metrics, identify cross-project patterns, verify protocol matches code, update the active provider playbook, and prefer behavior-changing rules over observational commentary
- Remove or merge rules that have not fired across multiple projects unless they protect a safety or integrity boundary
- Dispatch-pattern observations belong in `dispatch-patterns.md`, not in the conductor prompt

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
