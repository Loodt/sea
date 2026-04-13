# EXP-025: Meta-Evolution 013 (v045 → v046)

## Date
2026-04-11

## Conductor Iteration
30

## Hypothesis
Three active infrastructure failures are degrading dispatch efficiency: answered re-dispatch wastes slots, ID collisions cause type confusion, and late-stage question generation prevents convergence. Protocol tightening can mitigate at prompt level while code fixes remain in debt.

## Evidence Analyzed

### Dispatch Window (iters 17-28, financial-advisor-intelligence)
- **10 dispatches**, 82 findings added, 9 answered, 1 narrowed (90% convergence)
- **Dispatch gaps**: iters 18, 21 — no metric logged (2 gaps in 5 iters, hits diagnosis threshold)
- **Yield by type**: data-hunt 9.5, mechanism 9.0, synthesis 8.5, design-space 7.0 avg findings/dispatch
- **Same-type cap**: 2-consecutive hit 4 times but never 3-consecutive — prompt enforcement validated

### Failure Confirmations
1. **Answered re-dispatch (Infra #2)**: Q018 answered iter 26 (6 findings) → re-dispatched iter 27 (11 findings). v045 post-dispatch fix does not prevent the wasted slot.
2. **Question ID collision (Infra #6)**: Q029 dispatched as synthesis (iter 25, 10 findings) then mechanism (iter 28, 11 findings). Different questions sharing same ID.
3. **Dispatch gaps**: iters 18, 21 confirmed — question selector hitting dead-ends without logging.

### Cross-Project Portfolio (10 projects)
- 4 completed, 6 active
- ~129 total dispatches, 88%+ convergence rate
- Portfolio verification: 29% (below 30% floor for completed projects)
- Most active: financial-advisor at 29 dispatches, 30 conductor iterations

## Changes (v046)

### 1. Late convergence rule (Question Selection)
**Added**: After iter 20 with >70% resolved, cap new questions at 0 for all non-kill-check types. Prioritize synthesis + kill-check.
**Why**: Prevents question generation inflation in mature projects. Financial-advisor at iter 28 still creating 2 new questions despite convergence cap.

### 2. Question ID gate (Step Gates)
**Added**: New question IDs MUST be unique in questions.jsonl. Collision → increment ID suffix. Log ID_COLLISION.
**Why**: Q029 ID collision caused the same ID to be dispatched as two different types, inflating metrics and creating ambiguous resolution state.

### 3. Answered re-dispatch block tightened (Step Gates)
**Updated**: Added Q018 (iter 26→27) evidence. Clarified: re-read status BEFORE dispatch, abort if status ≠ 'open'.
**Why**: Three observed instances now (Q016, Q014, Q018). v045 post-dispatch fix is insufficient.

### 4. Infrastructure Debt reprioritized
**Changed**: Resolution verification and Question ID uniqueness elevated to CRITICAL priority. Same-type cap downgraded (prompt enforcement validated). Observability logging expanded with ANSWERED_REDISPATCH and ID_COLLISION events.

## Measurement
- **Answered re-dispatch**: Should see 0 ANSWERED_REDISPATCH events in next 10 dispatches (requires code fix for guarantee)
- **ID collision**: Should see 0 ID_COLLISION events (requires code fix for guarantee)
- **Late convergence**: Projects at iter 20+ should show 0 new questions for non-kill-check types
- **Same-type cap**: Continue monitoring for 3-consecutive violations (expect 0)

## Rollback Trigger
- If question creation cap causes projects to stall (0 dispatches available, all open questions gated), relax late-convergence to cap at 1 instead of 0
- If ID gate creates question write failures, fall back to logging-only (no rejection)

## Line Budget
Before: 120 lines | After: 122 lines | Limit: 150 lines | Headroom: 28 lines
