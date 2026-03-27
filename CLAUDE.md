# SEA Conductor

## State
- Conductor version: v003
- Pipeline: plan → research → synthesize → evaluate → evolve → summarize
- Knowledge layer: findings.jsonl + questions.jsonl + summary.md per project
- Config: per-project pipeline.json (falls back to DEFAULT_PIPELINE)

## Pipeline

| Step | Receives | Produces | Must NOT receive |
|------|----------|----------|-----------------|
| plan | persona, goal, summary.md, last eval | plan.md, skeleton | full prior reports |
| research | plan, source eval criteria | findings.md, references | outputs, persona strategies |
| synthesize | findings, skeleton, summary.md | report, exp log, trace | raw web pages |
| evaluate | output, rubrics, integrity axioms | reflection, scores | persona, goal, plan |
| evolve | evaluation, persona, lineage | updated persona, lineage | prior reports |
| summarize | findings, knowledge store | updated knowledge/ | anything else |

## Hard Rules
- Context budgets per agent: enforced in code (`types.ts` CONTEXT_BUDGETS)
- Persona max 60 lines — consolidate before adding
- Knowledge store is source of truth — not output/ reports
- summary.md max 2KB
- Tag every claim: `[SOURCE: url]` `[DERIVED: method]` `[ESTIMATED: basis]` `[ASSUMED]` `[UNKNOWN]`
- `[UNKNOWN]` over untagged guess — generates follow-up task, not noise
- Anchor comparisons: vs what baseline, by how much, what conditions
- Evaluate agent is independent critic — never sees persona or goal framing
- One change per evolution — hypothesis + measurement + rollback trigger
- Rollback-first on >15% score drop from 3-iter rolling average
- Minimum 2 iterations before judging any change
- Check failure-patterns/ before proposing changes
- New generalizable failures → failure-patterns/

## Scoring Weights
accuracy: 0.25 | coverage: 0.20 | coherence: 0.15 | insight: 0.20 | process: 0.20

## Discovery
1. Ask: goal, success criteria, domain, source prefs, output format
2. Create dirs: knowledge/, scratch/, output/, traces/, experiments/, reflections/, metrics/, lineage/
3. Write: goal.md, persona.md (seeded from failure-patterns/), pipeline.json, state.json
4. Seed persona with all failure-patterns/*.md warnings

## Meta-Evolution
1. Read all project lineage + eval/integrity.md
2. What patterns compound across projects?
3. Propose changes to THIS file (versioner preserves old)
4. Safety Rails section is IMMUTABLE

## Safety Rails (IMMUTABLE — meta-evolution MUST preserve this section verbatim)
- Never delete any file in *-history/ directories
- Always snapshot before any .md mutation
- Rollback if score drops >15% from 3-iteration rolling average
- Max API budget per iteration: configurable in state.json
- Log every change with reasoning in lineage — no unexplained mutations
- Preserve all references — even failed experiments teach something
