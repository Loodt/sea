# EXP-024: Meta-Evolution 012 — v044 → v045

## Date: 2026-04-11
## Conductor Iteration: 27 (financial-advisor-intelligence)

## Corpus
- 10 projects, 4 completed, ~129 dispatches, ~1300 findings
- Active project: financial-advisor-intelligence (27 iterations, 184 findings)
- Completed since last meta-evo: herald-research, linkedin-marketing-agent, sa-logistics, x-marketing-agent

## Cross-Project Findings

### High-Value Expert Types
| Type | Avg Yield | Notes |
|------|-----------|-------|
| data-hunt | 11-16 | Highest raw yield. Dominant in technical domains. |
| landscape | 10-20 | Excellent for frontier mapping (iter 1-3). |
| synthesis | 4-10 | Scales with store size. Reliable at maturity. |
| kill-check | 4-9 | High falsification value. 7x dispatched in financial-advisor. |
| design-space | 4-7 | Good constraint mapping. Moderate yield. |
| mechanism | 4-7 | Wide variance. Longer convergence normal. |
| first-principles | 4-7 | Fast convergence (1 iter). Low dispatch count overall. |

### Issue 1: Answered Re-Dispatch (NEW)
**Observed:** financial-advisor Q016 answered at iter 12 (15:20:53), re-dispatched at iter 13 (15:22:34 — 1.5 min later). Same for Q014 (iter 14→15, 4.5 min gap). Both dispatches produced findings (10+5 and 9+5), so not zero-value, but wasted a dispatch slot.
**Root cause:** Post-dispatch resolution check (`conductor.ts:121-133`) only validates questions listed in `questionsResolvedByAgent`. If the hybrid agent resolved the dispatched question by writing directly to questions.jsonl but the write failed, AND didn't include the question ID in `questionsResolvedByAgent`, the verification misses it. The `selectQuestion` prompt then sees stale status.
**Fix:** Add pre-dispatch status verification — read questions.jsonl AFTER selection, verify selected question is still open. Added to Step Gates and Infrastructure Debt #2.

### Issue 2: Question ID Collisions (NEW)
**Observed:** financial-advisor questions.jsonl has duplicate Q029 (mechanism open + synthesis resolved) and duplicate Q030 (mechanism open + design-space resolved). These are distinct questions with colliding IDs.
**Impact:** Conductor may select the open duplicate, confusing resolution logic. `updateQuestion` may update the wrong entry. Metrics reference ambiguous IDs.
**Fix:** Needs code-level collision check at question creation. Added to Infrastructure Debt #6.

### Issue 3: Synthesis Starvation Velocity Gap
**Observed:** chrome-pgm accumulated 84 findings in 6 dispatches with zero synthesis. The 8-dispatch mandatory trigger hadn't fired yet. Store maturity signal (>60 findings) should have boosted priority but wasn't strong enough to override other types.
**Fix:** Added velocity override: mandatory synthesis when 0 ever dispatched AND store >60 findings, regardless of dispatch count.

### Positive Patterns (Hold)
- Type diversity compliance strong — most projects hit first-principles and design-space by iter 5
- Same-type cap working (no 3x violations in recent iterations)
- Convergence rate 88%+ with exhaustions correctly classified as data-gaps
- financial-advisor shows excellent rotation: kill-check → data-hunt → mechanism → design-space → synthesis
- Narrowed stall protocol working (Q011 narrowed 2x with stable yield, not declining)

## Changes Applied (v044 → v045)
1. **Synthesis starvation velocity override** — mandatory synthesis when 0 ever dispatched AND store >60 findings
2. **Answered re-dispatch block** (Step Gates) — pre-dispatch status verification
3. **Infrastructure Debt #2** — resolution verification marked as REGRESSION with root cause
4. **Infrastructure Debt #6** — question ID uniqueness enforcement needed

## Verification Plan
- Next financial-advisor dispatches: zero answered re-dispatches (prompt-level defense)
- Next high-yield project with 0 synthesis: synthesis fires before dispatch 8
- Monitor for duplicate question IDs in new projects

## Line Count
- Before: 117 lines
- After: 119 lines (budget: 150)
