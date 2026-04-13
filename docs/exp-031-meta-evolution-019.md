# EXP-031: Meta-Evolution v051 → v052

## Date
2026-04-12

## Conductor Iteration
18

## Project Analyzed
financial-advisor-intelligence (17 dispatches, 115 findings, 18 questions)

## Patterns Identified

### 1. Synthesis Fragmentation (CRITICAL)
Both synthesis dispatches (iters 7, 15) exhausted with 0 resolved, creating 2-3 NEW questions each. Synthesis is doing the opposite of its job — fragmenting rather than consolidating. At 100+ findings, the store was large enough; the problem is scope (whole-store synthesis too broad) and incentive (agent finds gaps and spawns questions instead of answering).

### 2. Answered/Exhausted Re-dispatch (HIGH)
4 violations: Q001 (iter 1→9), Q008 (3→12), Q014 (6→15), Q016 (7→17). Two included type reclassification (Q014 design-space→synthesis, Q016 synthesis→mechanism). The pre-dispatch status check exists only in prompt language; code doesn't filter. Question store wipe at iter 8 may have contributed to Q001/Q008 re-dispatch (snapshot restore reset statuses).

### 3. Question Creation Cap Leaking (HIGH)
Post-iter-12 cap of 1 violated at iters 12 (2), 15 (3), 16 (2). The convergence gate text is in CLAUDE.md but hybrid agent ignores it. Needs code enforcement (post-dispatch trim).

### 4. SOURCE Fast-Track Code Mismatch (MEDIUM)
CLAUDE.md says SOURCE with ≥0.90 confidence graduates after 2 dispatches. Code (knowledge.ts staleAfter default) uses 3. Code should match doc spec.

## Changes Applied (v052)

### Behavioral: Synthesis Net-Reduction Rule
**Hypothesis:** Synthesis exhausts because it's scoped too broadly (whole store) and fragments into new questions. Constraining synthesis to scoped clusters and capping its new-question output at 1 will improve resolution rate.
**Measurement:** Next synthesis dispatch should resolve its question OR create ≤1 new question. If 2× exhaustion in project → auto-redirect to first-principles.
**Rollback trigger:** If synthesis resolution rate doesn't improve in next 2 projects with synthesis dispatch, remove the cluster-scoping constraint.

### Prompt strengthening: Re-dispatch Block
Added "FIRST STEP" emphasis and explicit note that code guard is NOT implemented. Added prohibition on type reclassification at re-dispatch.

### Infrastructure Debt Update
- Consolidated same-type cap + re-dispatch guard (both prompt-only, both violated) into single HIGH item with 4 documented violations
- Added question creation cap enforcement as new HIGH item
- Added SOURCE fast-track code mismatch as MEDIUM item
- Kept early-exit and observability logging

## Verification Plan
- Next project with synthesis dispatch: does it net-reduce questions?
- Next project past iter 12: does question creation stay ≤ cap?
- Monitor re-dispatch violations in next 2 projects

## Line Count
Before: 119 | After: 121 | Budget: 150
