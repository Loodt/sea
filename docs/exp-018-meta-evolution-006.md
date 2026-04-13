# EXP-018: Meta-Evolution v038 → v039

## Date: 2026-04-10
## Conductor version: v038 → v039
## Scope: 10 projects, 136+ dispatches, 1,613 findings, 137 questions

## Evidence

### Pattern 1: Kill-check concentration
- financial-advisor-intelligence dispatched 3 consecutive kill-checks (iters 2-4)
- Each produced 7-8 findings (productive but monopolizing slots)
- Existing synthesis cap (max 2 consecutive) is type-specific, not general
- Data-hunt (13.1 avg findings, highest yield) undispatched after 5 iterations

### Pattern 2: Question proliferation outpacing resolution
- financial-advisor: open:resolved = 11:5 (2.2:1) after 5 dispatches
- Every dispatch creates 2+ new questions despite non-landscape cap of 3
- Pruning mode trigger (>2:1) activates but has no escalation mechanism

### Pattern 3: Dispatch threshold code bug persists
- conductor-context.ts:202-205 still uses iter >6/>5 vs playbook iter ≥4
- Design-space dispatched at iter 5 by LLM choice (code check returned false)
- Confirms LLM already wants to dispatch reasoning types earlier
- Reasoning dispatch rate: 5.9% across 136+ runs (up from 2.7%, target >10%)

### Pattern 4: Zero no-change holds in evolution
- Every evolution cycle across all projects produces a behavioral change
- Over-evolution risk: changes without specific failure evidence
- "Prefer hold" instruction too weak — no measurable threshold

## Changes Made

### 1. Same-type cap (generalized from synthesis-only)
**Before:** Synthesis cap gate: max 2 consecutive synthesis dispatches
**After:** Same-type cap: max 2 consecutive dispatches of any single question type
**Hypothesis:** Generalizing prevents any type from monopolizing dispatch slots
**Measurement:** Next 20 dispatches: 0 violations of 3+ consecutive same-type
**Rollback:** If type-rotation degrades yield by >20%, revert to type-specific caps

### 2. Pruning escalation
**Before:** Pruning mode activates at >2:1 open:resolved but has no hard cap
**After:** >3:1 → cap new questions at 1; >4:1 → cap at 0
**Hypothesis:** Escalating caps prevent unbounded question proliferation
**Measurement:** Next project reaching iter 8+: open:resolved should stay below 3:1
**Rollback:** If question generation drops too aggressively (0 new Qs for 3+ iters), remove >3:1 cap

### 3. Infrastructure debt #1 escalated to BLOCKING
**Before:** CRITICAL — documented but not prioritized
**After:** BLOCKING — fix before next meta-evolution
**Reasoning:** 136+ dispatches confirm this is root cause of reasoning starvation

### 4. Evolution hold bias with measurable threshold
**Before:** "Prefer hold when scores stable and findings flowing" (vague)
**After:** "Default to hold when composite ≥6.5 and findingsAdded ≥5" (measurable)
**Hypothesis:** Measurable threshold prevents over-evolution when system is performing
**Measurement:** Next 10 evolution cycles: ≥2 no-change holds
**Rollback:** If hold-bias causes stagnation (2+ iters with declining scores), lower threshold to ≥7.0

## Line count
- Before: 114 lines
- After: 114 lines (net 0 — all changes fit in existing lines)
- Budget: 150 lines

## Success Criteria
1. Next 20 dispatches: 0 violations of 3+ consecutive same-type
2. Next project reaching iter 8+: open:resolved below 3:1
3. Next 10 evolution cycles: ≥2 no-change holds
4. Infrastructure debt #1 code fix lands before EXP-019
