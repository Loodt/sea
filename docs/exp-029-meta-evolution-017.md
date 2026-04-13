# EXP-029: Meta-Evolution v049 → v050

**Date:** 2026-04-11
**Trigger:** Conductor iteration 12, financial-advisor-intelligence project
**Evidence base:** 10 dispatches (financial-advisor iters 2-11), cross-project analysis (10 projects, 1,638 findings, 108 iterations)

## Observations

### Project Performance (financial-advisor-intelligence, 10 dispatches)
| Metric | Value |
|--------|-------|
| Avg findings/dispatch | 6.7 (67 total) |
| Answer rate | 90% (9/10 answered) |
| Type diversity | 6 types in 10 dispatches |
| Crashes | 0 |
| Same-type violations | 1 (data-hunt iters 8-9) |
| Exhaustions | 1 (Q016 synthesis, iter 7) |
| Question store wipes | 1 (iter 8, -18 questions, guard triggered) |

### Post-v049 dispatches (iters 9-11)
All 3 answered successfully. Good type diversity (data-hunt → kill-check → design-space). Avg 6.3 findings/dispatch. No issues. v049 synthesis floor and question store guard performing as designed.

### Cross-Project Patterns (10 projects)
- **Resolution rate:** 81% (88/109 resolved)
- **Empirical gates working:** 3 projects correctly gated
- **Synthesis yield scales with store size:** sa-logistics at 261 findings → 17 yield. financial-advisor at ~46 → 4 yield then exhausted. Confirms store maturity is the dominant factor.
- **Completed projects average 16.5 findings/iter** — financial-advisor at 7.0 is an outlier (proprietary domain with less publicly available data)

### Issues Found

#### 1. EXP-028 Misclassified Same-Type Cap as Sufficient
- **Evidence:** EXP-028 claimed "No consecutive violations in 8 dispatches. Prompt warning is sufficient." But iters 8-9 ARE consecutive data-hunts — the violation was present in the data EXP-028 analyzed.
- **Root cause:** Question store wipe at iter 8 disrupted normal selection. Recovery dispatch likely forced same-type. But the prompt warning didn't prevent it regardless.
- **Fix:** Upgrade same-type cap to HIGH in infrastructure debt. Prompt-only enforcement is not reliable under stress.

#### 2. Post-Exhaustion Synthesis Timing Gap
- **Evidence:** Synthesis exhausted at iter 7 (~46 findings). By iter 12, store grew to 77 findings (+67%). But starvation timer won't fire until iter 15 (8 dispatches since last synthesis). The store is well past the ≥50 threshold but synthesis isn't prioritized.
- **Root cause:** Starvation timer is dispatch-count based, not store-growth based. After an exhaustion from insufficient data, the timer should care about data growth, not just passage of time.
- **Fix:** Post-exhaustion acceleration: re-eligible when store grows ≥50% past exhaustion size.

#### 3. Synthesis Yield Expectations Understate High-Maturity Performance
- **Evidence:** Type table said "At maturity (>60) expect 8-10 yield." sa-logistics synthesis at 261 findings yielded 17. Underestimating high-maturity yield could cause the evaluator to penalize productive synthesis.
- **Fix:** Yield expectation now scales: >60 → 8-10; >200 → 15-20.

## Changes (v050)

### Protocol (CLAUDE.md) — 119 → 116 lines
1. **Post-exhaustion synthesis acceleration** — new clause in synthesis starvation: re-eligible when store grows ≥50% past exhaustion size
2. **Convergence gates consolidated** — merged question convergence + late convergence into single line (saves 2 lines)
3. **Synthesis yield scaling** — type table updated: >60 → 8-10; >200 → 15-20
4. **Infrastructure debt #1 resolved** — question store write protection downgraded from CRITICAL to resolved (v049 code guard working)
5. **Same-type cap escalated** — upgraded from unpriorized to HIGH, noting prompt warning violation

### No Code Changes
All changes are protocol-level. Same-type cap code enforcement remains open infrastructure debt.

### Line Budget
119 → 116 lines | Limit: 150 | Headroom: 34

## Measurement Plan
- **Post-exhaustion acceleration:** financial-advisor-intelligence should re-dispatch synthesis before iter 15 if store reaches ~69 findings (46 × 1.5). Current store: 77 — already past threshold. Next dispatch should consider synthesis.
- **Same-type cap:** Monitor for further prompt-level violations. If 2+ more occur across projects, escalate to CRITICAL and implement code block.
- **Yield scaling:** Next synthesis on a >200 finding store should be scored against 15-20 expectation, not 8-10.

## Rollback Triggers
- If post-exhaustion acceleration causes premature synthesis (exhausts again at <80% store growth), raise threshold to ≥75%
- If convergence gate consolidation causes confusion (selector misinterprets merged rules), expand back to separate lines
