# EXP-032: Meta-Evolution 020 (v052 -> v053)

## Date: 2026-04-12

## Analysis Scope
- 11 projects, 156 total conductor iterations, 1,891 findings
- Deep analysis of financial-advisor-intelligence (20 iterations, 131 findings)
- Cross-project pattern analysis across all active/completed projects

## Key Findings

### 1. Synthesis Dispatch Has Three Failure Modes
- **Never dispatched**: chrome-pgm-tailings (84 findings, 0 synthesis in 6 iters)
- **Over-dispatched**: marketing-campaign-history (7/14 iterations = 50% synthesis)
- **Always exhausts**: financial-advisor-intelligence (2/2 synthesis exhausted, 0% resolution rate)

Existing rules address starvation (floor) but not over-synthesis (ceiling). The velocity override and starvation timer cover under-dispatch. No rule prevents consecutive synthesis spam.

### 2. Re-Dispatch Violations at 20% Rate
financial-advisor-intelligence: 4 violations in 20 iterations.
- Q001 answered iter 1 -> re-dispatched iter 9 (type reclassified: landscape -> data-hunt)
- Q008 answered iter 3 -> re-dispatched iter 12 (same type)
- Q014 answered iter 6 -> re-dispatched iter 15 (type reclassified: design-space -> synthesis)
- Q016 exhausted iter 7 -> re-dispatched iter 17 (type reclassified: synthesis -> mechanism)

Prompt guard exists (line 66 "FIRST STEP") but is still not code-enforced. Infrastructure debt #1.

### 3. Convergence Gate Too Lenient
Post-iter-12 cap requires `open >12` to trigger. In financial-advisor-intelligence, open count was ~6 at iter 12, so the cap never activated. Iters 12/15/16 created 2/3/2 new questions despite late-stage status. An unconditional cap at iter 15+ would have prevented this.

### 4. First-Principles Between Synthesis Exhaustions Not Dispatched
Rule says "2x synthesis exhaustion -> first-principles before retry." First synthesis exhausted at iter 7, second at iter 15. No first-principles dispatched between them (Q004 first-principles was at iter 5, before first exhaustion). Rule existed but wasn't followed.

### 5. Hybrid Architecture Stable
0 crashes across all recent dispatches (iters 11-20). Finding yield consistent at 5-9 per dispatch. Late convergence excellent: iters 17-20 created 0 new questions each, all resolved 1. Resolution rate 80%.

## Changes Made (v053)

### Consolidation (-4 lines)
1. Removed old pipeline inner-loop description (line 5) - superseded by hybrid architecture
2. Removed execution.md reference (line 8) - superseded by hybrid
3. Merged Meta-Evolution Protocol section into Evolution Protocol (-2 lines)
4. Trimmed resolved infrastructure debt preamble text

### New Rules (+1 net line)

1. **Synthesis ceiling** (added to synthesis starvation, line 15):
   "Max 2 synthesis in any 6-dispatch window - over-synthesis wastes iterations on thin derivation gains."
   - Hypothesis: Capping synthesis frequency prevents the marketing-campaign-history 50% pattern while still allowing the starvation floor to mandate synthesis when needed.
   - Measurement: Next project with >100 findings should have synthesis at 10-25% of dispatches, not 50%.
   - Rollback: If synthesis resolution rate drops below current baseline (already 0%), remove ceiling.

2. **Unconditional late-stage cap** (added to convergence gates, line 19):
   "Iter 15+ -> cap new at 1 unconditionally."
   - Hypothesis: Late-stage question creation should taper regardless of open count. The conditional `open >12` threshold allows runaway creation when projects happen to resolve questions quickly.
   - Measurement: Projects past iter 15 should create at most 1 question per dispatch.
   - Rollback: If projects stall at iter 15+ due to inability to create needed questions, make conditional on >50% resolved instead.

### Line Count
Before: 121 lines
After: 117 lines
Budget: 150 lines
Headroom: 33 lines

## Unresolved (Still Infrastructure Debt)
- Re-dispatch guard remains prompt-only (20% violation rate demands code enforcement)
- Question creation cap enforcement not code-enforced
- SOURCE fast-track graduation code-doc mismatch
- No first-principles enforcement between synthesis exhaustions (existing rule, not followed)
