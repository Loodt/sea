# EXP-030: Meta-Evolution v050 → v051

**Date:** 2026-04-12
**Trigger:** Conductor iteration 15, financial-advisor-intelligence project
**Evidence base:** 14 dispatches (iters 1-14), 94 findings, 34 verified (36%)

## Observations

### Dispatch Pattern (14 iterations)
| Type | Count | Avg Yield | Last Dispatched |
|------|-------|-----------|-----------------|
| data-hunt | 5 | 7.4 | iter 14 |
| kill-check | 4 | 6.2 | iter 13 |
| design-space | 2 | 5.5 | iter 11 |
| first-principles | 1 | 6.0 | iter 5 |
| landscape | 1 | 11.0 | iter 1 |
| synthesis | 1 | 4.0 | iter 7 (exhausted) |
| mechanism | 0 | — | never |

### System Health
- Zero crashes across 14 dispatches (hybrid architecture stable)
- 46% question convergence (6/13 resolved)
- Verification rate 36% (above 30% floor)
- No hollow answers, no dispatch gaps
- Question store wipe guard (v049) performed correctly at iter 8

### Issues Found

#### 1. Synthesis Post-Exhaustion Acceleration Not Firing
- **Evidence:** Synthesis exhausted at iter 7 (~50 findings). Store now 94 findings (88% growth, well past 50% threshold). 7 dispatches since without synthesis.
- **Root cause:** v050 rule said "re-eligible" — permissive, not obligatory. Data-hunt and kill-check keep winning selection on historical yield.
- **Fix:** Change "re-eligible" to "mandatory re-dispatch" with "next-dispatch obligation" framing.

#### 2. Answered Questions Re-Dispatched
- **Evidence:** Q001 dispatched iter 1 (landscape, answered) → re-dispatched iter 9 (data-hunt, answered). Q008 dispatched iter 3 (data-hunt, answered) → re-dispatched iter 12 (data-hunt, answered). Q001 also mutated type: landscape → data-hunt.
- **Root cause:** No code-level pre-dispatch guard checking question.status = 'open'. Iter 8 question store wipe likely corrupted statuses, and recovery snapshot may have had stale state.
- **Fix:** Elevate ANSWERED_REDISPATCH to HIGH infrastructure debt (#2) requiring code enforcement.

#### 3. Late-Stage Data-Hunt Dominance
- **Evidence:** Iters 8-14: 4 data-hunts out of 7 dispatches (57%). With 94 findings in store, marginal return per additional data-hunt declines. No synthesis or mechanism dispatched in 7 iterations.
- **Root cause:** No consolidation signal triggers when the store is large. Data-hunts keep winning on yield history (7.4 avg).
- **Fix:** New "Late-stage consolidation" rule: after iter 12 with >80 findings, boost synthesis + reasoning over data-gathering.

#### 4. Mechanism Questions Invisible
- **Evidence:** 2 open mechanism questions, 14 iterations, 0 dispatches. Unlike first-principles/design-space, mechanism has no mandatory dispatch rule.
- **Root cause:** Mechanism naturally deprioritized vs higher-yield types. Type table gave no boost signal.
- **Fix:** Add mechanism dispatch guidance: after iter 10, boost if open with 0 dispatches and ≥3 related questions resolved.

## Changes (v051)

### Protocol (CLAUDE.md) — 117 → 118 lines
1. **Post-exhaustion synthesis mandatory** — "re-eligible" → "mandatory re-dispatch ... next-dispatch obligation" (line 17)
2. **Late-stage consolidation rule** — new: after iter 12 + >80 findings, boost synthesis + reasoning (line 21)
3. **Mechanism dispatch guidance** — type table: boost after iter 10 if never dispatched and ≥3 related resolved (line 32)
4. **Answered re-dispatch guard** — new HIGH infra debt item #2, citing Q001/Q008 evidence (line 109)
5. **Infra debt housekeeping** — question ID normalization added to resolved list; ANSWERED_REDISPATCH removed from observability (now its own item)

### No Code Changes
Protocol-level only. Two HIGH infrastructure debt items now pending code enforcement (same-type cap + answered re-dispatch guard).

### Line Budget
117 → 118 lines | Limit: 150 | Headroom: 32

## Measurement Plan
- **Synthesis mandatory:** Iter 15 should dispatch synthesis (94 findings, 88% post-exhaustion growth). If it doesn't, the conductor context prompt may not be surfacing this rule — investigate prompt assembly.
- **Late-stage consolidation:** Expect ≥2 synthesis/reasoning dispatches in iters 15-20. If data-hunt still >50%, rule is too weak.
- **Answered re-dispatch:** Monitor for recurrence. If another answered question re-dispatches before code guard, escalate to CRITICAL.
- **Mechanism:** If still 0 dispatches by iter 18, investigate selector weighting.

## Rollback Triggers
- If mandatory synthesis produces <4 findings on 94-finding store, raise post-exhaustion threshold to ≥75%
- If late-stage consolidation starves critical data-hunt questions (question stalls with no data), relax to advisory
- If mechanism boost displaces higher-priority types (kill-check or synthesis), remove mechanism guidance
