# EXP-020: Meta-Evolution 008 (v040 → v041)

## Date
2026-04-11

## Trigger
Conductor iteration 15 on financial-advisor-intelligence. 10 projects totaling ~136 dispatches and ~1,600+ findings. EXP-019 validation criteria checkable.

## Data Analysed
- 10 projects, ~136 conductor dispatches, ~1,600+ findings
- Latest run: financial-advisor-intelligence (13 dispatches, 92 findings, 1 crash recovered)
- Dispatch type distribution across all typed dispatches (99 with type data, 23 legacy untyped)
- Same-type cap violation audit across all projects
- EXP-019 validation results

## EXP-019 Validation Results

| Criterion | Result |
|-----------|--------|
| Synthesis dispatches when store >40 findings and >8 dispatches | **PASS** — financial-advisor dispatched synthesis at iters 12-13 (66+ findings, 10 findings each) |
| Store maturity signal fires at 60 findings | **PASS** — synthesis priority boosted correctly |
| No regression in findings/dispatch rate (baseline: 6.4) | **PASS** — 6.4 avg sustained, synthesis yielded 10/dispatch |
| Same-type cap still violated (expected) | **CONFIRMED** — herald 7×, sa-geo 5× consecutive data-hunts |

## Key Findings

### 1. Synthesis starvation rule validated with strong signal
Financial-advisor synthesis dispatches at iters 12-13 both produced 10 findings — the highest yield of any dispatch in the project. This confirms: (a) the >40 findings threshold is well-calibrated, (b) synthesis yield at store maturity (>60 findings) is 8-10 findings, higher than most other types. Updated type table guidance accordingly.

### 2. Infrastructure debt #1 resolved — dispatch thresholds fixed
Changed `conductor-context.ts:202-205` from `iter > 6`/`> 5` to `iter >= 4` for both first-principles and design-space diversity warnings. This was BLOCKING since EXP-018 (3 meta-evolutions). Reasoning dispatch rate was ~7% across typed dispatches (target >10%). The fix will surface reasoning type requirements 2-3 iterations earlier.

### 3. Same-type cap violations are the top remaining infrastructure gap
| Project | Violation | Consecutive same-type |
|---------|-----------|----------------------|
| herald-research | data-hunt iters 3-9 | 7 consecutive |
| sa-self-activating-geopolymers | data-hunt iters 5-9 | 5 consecutive |
| linkedin-marketing-agent | data-hunt multiple runs | 3+ consecutive |

Root cause: data-hunt has the highest average yield (14.4 findings/dispatch) creating a gravitational pull. The LLM naturally selects the highest-yield type. Code enforcement is required — playbook guidance alone is insufficient. Promoted to BLOCKING.

### 4. Dispatch type distribution (typed dispatches only)
| Type | Count | % | Avg Findings |
|------|-------|---|-------------|
| data-hunt | 33 | 33% | 14.4 |
| synthesis | 17 | 17% | 7.9 |
| mechanism | 12 | 12% | 12.3 |
| landscape | 11 | 11% | 11.3 |
| kill-check | 10 | 10% | 8.6 |
| first-principles | 4 | 4% | 8.3 |
| design-space | 3 | 3% | 8.0 |

Reasoning types combined: 7/99 = 7.1%. Below 10% target but expected to improve with dispatch threshold fix.

### 5. System health strong
- 5/10 projects completed (herald, linkedin, sa-logistics, marketing-campaign, x-marketing)
- Crash rate: 7.4% overall, only 1 crash in typed dispatches (infrastructure, recovered)
- Question generation decay working: financial-advisor went 3→2→2→2→1→1
- Zero hollow answers observed across all recent projects
- Pruning escalation from v039 keeping open:resolved ratios manageable

## Changes Made (v040 → v041)

### 1. Dispatch thresholds fixed (CODE)
**File:** `conductor-context.ts:202-205`
**Before:** `conductorIteration > 6` / `conductorIteration > 5`
**After:** `conductorIteration >= 4` / `conductorIteration >= 4`
**Hypothesis:** Earlier reasoning type warnings will increase reasoning dispatch rate from 7% toward 10%+ target.
**Measurement:** Next 20 dispatches across all projects: reasoning types should appear by iter 5.
**Rollback trigger:** If reasoning types dispatched at iter 4 on thin stores (<5 verified, <20 SOURCE) produce <2 findings, revert to >= 5.

### 2. Infrastructure debt #1 removed, same-type cap promoted to BLOCKING
**Removed:** Dispatch thresholds item (resolved by code fix above).
**Promoted:** Same-type cap enforcement from item #4 to item #1 with BLOCKING status.
**Evidence:** 3 consecutive meta-evolutions documenting violations. Herald (7×) and sa-geo (5×) data-hunt runs are extreme.

### 3. Synthesis yield guidance updated
**Changed:** Type table synthesis row from "Yield scales with store size" to "Yield scales with store size; at maturity (>60 findings) expect 8-10 yield."
**Evidence:** Financial-advisor synthesis dispatches both yielded 10 findings at 66+ store size.
**Purpose:** Gives the LLM better calibration for when to prioritize synthesis.

### 4. Version bump
v040 → v041.

## Line Budget
Before: 114 lines. After: 113 lines. Budget: 150 lines. Headroom: 37 lines.

## Blocking Items for Next Meta-Evolution
Infrastructure debt #1 (same-type cap enforcement) is BLOCKING. Code must enforce max 2 consecutive dispatches of any single question type. Must be fixed in conductor.ts or conductor-context.ts before EXP-021.

## Validation Plan
Run next 3+ projects through 8+ dispatches each. Check:
- [ ] Reasoning types dispatched by iter 5 (not iter 7+ as before)
- [ ] Reasoning dispatch rate >10% across next 20 typed dispatches
- [ ] No regression in findings/dispatch (baseline: 6.4)
- [ ] Same-type cap still violated (expected — code fix not yet done)
- [ ] Synthesis yield at maturity confirms 8-10 range
