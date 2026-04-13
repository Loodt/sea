# EXP-019: Meta-Evolution 007 (v039 → v040)

## Date
2026-04-11

## Trigger
Conductor iteration 12 on financial-advisor-intelligence. 10 projects totaling 124 dispatches and 1,636 findings provide sufficient cross-project signal.

## Data Analysed
- 10 projects, 124 conductor dispatches, 1,636 findings
- Latest run: financial-advisor-intelligence (10 dispatches, 64 findings, 1 crash)
- Lineage from sewage-gold (2 evolution entries showing targeted behavioral fixes)
- Infrastructure debt implementation status (5 items checked against code)

## Key Findings

### 1. Synthesis starvation identified
Financial-advisor ran 10 dispatches, accumulated 66 findings, and never dispatched synthesis. Root cause: store maturity threshold was >80 findings — too high. A 66-finding store across 10 dispatches is synthesis-ready but the trigger never fired. Design-space and first-principles were prioritized as "never-dispatched" types, then data-hunt and mechanism took remaining slots.

### 2. Same-type cap not code-enforced
Three consecutive kill-checks at iters 2-4 in financial-advisor, violating the max-2-consecutive cap added in v039. All three yielded 7-8 findings (no harm done), but the rule must be code-enforced to prevent type starvation in less favorable cases.

### 3. Reasoning dispatch rate improving
8.9% across 124 dispatches (up from 5.9% at EXP-018). In financial-advisor specifically, 30% reasoning dispatches (3/10). The playbook rules are working when questions are available; the code threshold bug (#1) still delays initial reasoning dispatch by 2-3 iterations.

### 4. Infrastructure debt partially cleared
- #2 (question state injection): RESOLVED — empirical-gate and narrowed re-injection both implemented
- #5 (lineage code enforcement): RESOLVED — code-enforced in loop.ts and context.ts
- #1, #3, #4: remain open

### 5. System performing well overall
6.4 findings/dispatch average, crash recovery working (Q003 crashed → re-dispatched → 5 findings), question generation decaying properly (3→2→2→2→1→1). No hollow answers observed.

## Changes Made (v039 → v040)

### 1. Synthesis starvation rule (NEW)
**Added:** "After 8+ dispatches AND 0 synthesis dispatched AND store >40 findings → mandatory synthesis next."
**Hypothesis:** This prevents the financial-advisor pattern where raw findings accumulate without consolidation.
**Measurement:** Next project reaching 8+ dispatches must dispatch synthesis if criteria met.
**Rollback trigger:** If forced synthesis at <50 findings produces score <5.0, raise threshold to >60.

### 2. Store maturity threshold lowered
**Changed:** Total findings threshold from >80 to >60 for synthesis priority boost.
**Hypothesis:** 60 findings is sufficient maturity for synthesis value; 80 was too conservative based on financial-advisor evidence.
**Measurement:** Synthesis dispatches should increase in projects with 60-80 findings.
**Rollback trigger:** If synthesis dispatched at 60 findings produces <3 new findings, restore >80 threshold.

### 3. Infrastructure debt updated
**Removed:** Items #2 (question state injection) and #5 (lineage enforcement) — both verified as implemented in code.
**Added:** Item #4 (same-type cap enforcement) — observed 3 consecutive kill-checks violating the v039 playbook rule.
**Updated:** Reasoning dispatch stat: 5.9% → 8.9% across 124 dispatches.

### 4. Version bump
v039 → v040.

## Line Budget
Before: 114 lines. After: 113 lines. Budget: 150 lines. Headroom: 37 lines.

## Blocking Items for Next Meta-Evolution
Infrastructure debt #1 (dispatch thresholds) remains BLOCKING. Code uses iter >6/>5 but playbook says iter ≥4. This must be fixed in conductor-context.ts before EXP-020.

## Validation Plan
Run financial-advisor-intelligence to completion (or next 5 dispatches). Check:
- [ ] Synthesis dispatches when store >40 findings and >8 dispatches
- [ ] Store maturity signal fires at 60 findings (not 80)
- [ ] No regression in findings/dispatch rate (baseline: 6.4)
- [ ] Same-type cap still violated (expected — code fix not yet done)
