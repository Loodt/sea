# EXP-022: Meta-Evolution 010 (v042 → v043)

## Date
2026-04-11

## Trigger
Conductor iteration 21 on financial-advisor-intelligence. 10 projects totaling ~140 dispatches and ~1,685 findings. EXP-021 validation criteria checkable plus new systemic patterns identified.

## Data Analysed
- 10 projects, ~140 conductor dispatches, ~1,685 findings, 149 questions
- Latest run: financial-advisor-intelligence (20 dispatches, ~115 findings)
- Full dispatch type sequence analysis across all three active projects
- Cross-project verification rates and exhaustion patterns
- Playbook-code alignment audit (conductor-context.ts vs CLAUDE.md)

## EXP-021 Validation Results

| Criterion | Result |
|-----------|--------|
| Same-type cap: zero 3+ consecutive same-type | **PASS** — financial-advisor iters 9-20 show no 3+ consecutive same-type runs |
| Resolution verification: zero same-question re-dispatch (answered) | **PARTIAL** — iters 12→13 (Q016), 14→15 (Q014) occurred before v042 code deployed. Post-deploy (iter 19-20) no re-dispatch observed. Code fix validated by Q011 now showing resolved despite narrowed status in metrics. |
| Reasoning diversity >10% of typed dispatches | **PASS for project lifetime** — 3/15 unique dispatches = 20% reasoning. **FAIL for recent window** — iters 9-20: 0/8 unique dispatches = 0% reasoning. |
| No regression: findings/dispatch >= 6.0 | **PASS** — 7.9 avg across iters 9-20 (excluding crash at iter 8) |

## Key Findings

### 1. Playbook-code mismatches (2 found)
**Ranking criterion:** Code (conductor-context.ts:262) uses "decision-relevance per research cost" as primary criterion. CLAUDE.md omitted this — ranking started at "information gain." The code is correct; decision-relevance is the more discriminating signal.

**Pruning threshold:** Code (conductor-context.ts:163) triggers pruning at `open > 15`. CLAUDE.md said `open > 10`. The code change was deliberate — >10 was too aggressive for complex projects like financial-advisor (28 questions, many legitimately open). Financial-advisor has open:resolved = 13:15 = 0.87:1 which correctly avoids pruning mode.

### 2. Reasoning type recurrence gap (NEW systemic pattern)
Type diversity gates are one-shot: they fire when a reasoning type has NEVER been dispatched, then satisfy permanently. Financial-advisor dispatched first-principles (iter 7) and design-space (iters 5-6) early when the store was small (~30 findings). Then went 13 more iterations (9-20) with ZERO reasoning types despite:
- Store growing from ~30 to ~115 findings (3.8x growth)
- 4 open design-space questions in the queue (Q013, Q019, Q023, Q028)
- Selector consistently preferring data-hunt and mechanism over reasoning types

**Root cause:** No recurrence mechanism. Once the one-shot gate is satisfied, the selector optimizes for immediate information gain (data-hunt/mechanism) and never returns to reasoning types, even when the store has matured enough to support much richer synthesis and first-principles analysis.

### 3. Synthesis starvation is also one-shot
Current rule: "After 8+ dispatches AND 0 synthesis dispatched." Financial-advisor dispatched synthesis at iter 12 (Q016, yielding 10 findings). The rule never fired again, and no further synthesis was dispatched through iter 20 despite 8 more dispatches and 50+ additional findings. A second synthesis round at iter 20 could consolidate all the data-hunt and mechanism findings from iters 9-20.

### 4. Narrowed stall detection absent
Financial-advisor Q011 was narrowed twice consecutively (iters 16-17). Both produced 10 findings — so not wasteful in this case. But there is no gate to detect when consecutive narrowing produces declining yields, which would signal a question approaching exhaustion.

### 5. Portfolio health
- 4 projects complete (100%), 3 substantially complete (90%+), 3 in progress
- Portfolio verification rate: 29% (below 30% floor for completed projects with algorithm-heavy domains like x-marketing at 18%)
- First-dispatch resolution rate: 80.6% (healthy)
- Total-value-recovery has 4 exhaustions in 15 iterations (27%) — approaching empirical plateau

## Changes Made

### CLAUDE.md (v042 → v043)

1. **Ranking alignment**: Added "decision-relevance per research cost" as primary criterion (matches conductor-context.ts:262)
2. **Pruning threshold alignment**: Changed open >10 to open >15 (matches conductor-context.ts:163)
3. **Synthesis starvation recurrence**: Changed "0 synthesis dispatched" to "0 synthesis in last 8 dispatches (or 0 ever)." Now triggers repeatedly, not once.
4. **Reasoning recurrence (NEW rule)**: After 6+ dispatches since last reasoning type AND store grew >40 findings since then, boost reasoning type. Prevents type drift in long projects.
5. **Narrowed stall gate (NEW)**: Same question narrowed >=2 consecutive dispatches with declining yield → evaluate for exhaustion. Added to Expert Convergence section.
6. **Infrastructure debt**: Compacted item #2 (resolution verification, FIXED v042) description.

Net line change: +1 (114 → 115, budget 150)

## Validation Plan (for EXP-023)
1. **Reasoning recurrence**: In projects with 15+ iterations, reasoning types should be dispatched at least once in any 10-iteration window when store growth threshold (40 findings) is met
2. **Synthesis recurrence**: No more than 8 consecutive dispatches without synthesis when store >40 findings
3. **Narrowed stall**: Consecutively narrowed questions with declining yield should be evaluated for exhaustion
4. **Playbook-code alignment**: No mismatches on ranking criteria or thresholds
5. **No regression**: findings/dispatch rate >= 6.0 baseline

## Rollback Triggers
- Reasoning recurrence causes premature reasoning dispatches on immature stores (false positive on growth threshold)
- Synthesis recurrence forces low-value synthesis when the store hasn't materially changed
- Narrowed stall gate causes premature exhaustion of questions that would have resolved with one more iteration
- findings/dispatch drops below 5.0 for 5+ consecutive dispatches
