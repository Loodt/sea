# EXP-016: Meta-Evolution 004 — Conductor v036 → v037

## Hypothesis
Three structural gaps are visible in 136-dispatch cross-project analysis:
1. Exhausted questions get re-dispatched, wasting conductor iterations
2. Data-hunt exhaustion clusters (iter 10-15) lack automatic rotation to reasoning types
3. Design-space type underperforms (6.0 avg findings, n=2) partly due to thin-store dispatches

Adding an exhausted re-dispatch block, an exhaustion cluster rotation rule, and design-space yield calibration will reduce wasted dispatches without adding operational complexity.

## Method
- Analyzed 136 conductor dispatches across 10 projects (up from 110 in EXP-015)
- Tracked exhaustion patterns: 7/8 exhausted dispatches are data-hunt, clustering at iter 10-15
- Identified Q012 re-dispatch in sa-self-activating-geopolymers (exhausted at iter 12, re-dispatched and exhausted again at iter 14)
- Measured design-space yield: 6.0 avg findings (n=2), 1 exhausted (financial-advisor-intelligence, 41 total findings at dispatch time)
- Verified v036 gates: synthesis cap (0 violations), reasoning diversity (insufficient data), adaptation floor (insufficient data)

## Changes (v037)

### New Step Gate
| Gate | Evidence |
|------|---------|
| Exhausted re-dispatch block | Q012 re-dispatched after exhaustion in sa-self-activating-geopolymers. Same question exhausted twice = permanent-gap |

### New Question Selection Rule
| Rule | Evidence |
|------|---------|
| Exhaustion cluster rotation | sa-self-activating-geopolymers: 3 exhausted data-hunt dispatches in iterations 10-15. System hit data wall but kept dispatching search-type questions |

### Modified Guidance
| Change | Evidence |
|--------|---------|
| Design-space yield calibration | Average 6.0 findings (vs 12.3 overall). Exhaustion at <4 findings = thin prerequisites. Added to type table |

### Infrastructure Debt
| Item | Status |
|------|--------|
| #5 Dispatch thresholds | CONFIRMED: code uses iter >6/>5, playbook says iter 4. Blocks reasoning diversity gate. Prioritized to #1 |
| #1-4 | Unchanged — still open |

## Measurement
### Success criteria
- Next 30 dispatches: 0 exhausted re-dispatches (same question exhausted twice)
- Next project hitting data wall (≥2 exhausted in 4 dispatches): automatic rotation to synthesis/first-principles within 1 dispatch
- v036 gates still passing: 0 synthesis cap violations, reasoning types dispatched when eligible

### Rollback trigger
- If exhaustion cluster rule blocks valid re-attempts at narrowed (not exhausted) questions
- If rotation to reasoning types on thin stores causes more exhaustions than it prevents

## Result
Pending — requires conductor runs under v037 to measure.

## Line count
v036: 119 lines → v037: 121 lines (net +2, well within 150 cap)
