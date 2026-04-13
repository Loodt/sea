# EXP-027: Meta-Evolution 015 — v047→v048

## Trigger
Conductor iteration 6 (financial-advisor-intelligence). Scheduled meta-evolution check.

## Evidence Reviewed
11 projects. Primary: financial-advisor-intelligence (5 iters under v047). Cross-project: sewage-gold (10 iter), herald-research (14 iter), sa-geopolymers (13 iter), plus portfolio-level verification data from EXP-025.

## Cross-Project Patterns

### Validated improvements (v047)
- **Reasoning dispatch timing: FIXED.** financial-advisor-intelligence dispatched first-principles at iter 5. Pre-fix: herald-research never in 14 iters, sa-geopolymers at iter 13. The iter ≥4 prompt warning + code enforcement works. Closing infrastructure debt item.
- **Same-type cap: holding.** financial-advisor-intelligence showed 4 types in 5 dispatches, no consecutive violations. Code-level consecutive detection + prompt hard warning validated.
- **Resolution verification: code-enforced.** Working tree has post-dispatch resolution enforcement + normalizeQuestionIds(). No answered re-dispatches observed.
- **Zero crashes.** Hybrid architecture stability continues across all recent projects.

### Remaining issues
1. **Portfolio verification rate: 29%** (below 30% floor). Root cause: graduation age gate (≥3 dispatches) structurally prevents late-dispatch findings from graduating. SOURCE findings with URLs are externally verifiable — aging them 3 dispatches is over-conservative.
2. **Data-hunt queue concentration.** financial-advisor-intelligence has 6 open data-hunts / 9 open questions (67%). Current data-hunt fatigue only triggers on exhaustion, not queue composition. Risk: frontier becomes type-monolithic, crowding out reasoning types.

## Changes Made (v048)

### CLAUDE.md (117→116 lines)

1. **Finding Graduation: fast-track for high-confidence SOURCE findings.**
   Added: SOURCE findings with confidence ≥ 0.90 graduate after 2 dispatches (reduced from 3). 
   **Why:** Short projects (5-10 iters) suffer most from the age gate. Externally verifiable evidence doesn't need 3 dispatches of aging. Addresses 29% portfolio verification rate.

2. **Question Selection: data-hunt queue concentration signal.**
   Added: When >5 open data-hunts, apply fatigue rules preemptively (boost reasoning/synthesis) even without exhaustion.
   **Why:** financial-advisor-intelligence shows 6/9 open questions are data-hunts. Current rules only trigger on exhaustion — by then the frontier is already type-monolithic. Queue-composition signal catches this earlier.

3. **Infrastructure Debt: closed reasoning dispatch timing (item 4).**
   **Why:** Validated by financial-advisor-intelligence (first-principles at iter 5 vs never/iter 13 pre-fix). No longer a gap.
   
4. **Infrastructure Debt: updated same-type cap (item 1).**
   Upgraded status to reflect code-level consecutive detection + prompt hard warning (from PARTIAL).

### No code changes
Code changes addressing resolution verification, ID normalization, and same-type cap detection are in the working tree (uncommitted). No additional code modifications required this cycle.

## Metrics (financial-advisor-intelligence, 5 iters)

| Iter | Question | Type | Findings | Resolved | New Qs |
|------|----------|------|----------|----------|--------|
| 1 | Q001 | landscape | 11 | 1 | 3 |
| 2 | Q002 | kill-check | 9 | 1 | 2 |
| 3 | Q008 | data-hunt | 8 | 1 | 1 |
| 4 | Q011 | kill-check | 6 | 1 | 2 |
| 5 | Q004 | first-principles | 6 | 1 | 1 |
| **Total** | | | **40** | **5** | **9** |

Avg yield: 8.0 findings/dispatch. 100% resolution rate. Question creation tapering (3→2→1→2→1).

## Measurement
- **Verification acceleration**: Next project completing at iter 8+ should show verified/total >35% (up from 29% baseline). SOURCE findings from iter 1-6 eligible for fast-track graduation.
- **Queue concentration**: financial-advisor-intelligence iter 6+ should not dispatch 3+ consecutive data-hunts despite 6 open data-hunts in queue.
- **Reasoning dispatch timing (closed)**: Continue observing — if a new project fails to dispatch reasoning types by iter 6 despite eligible store, reopen as infrastructure debt.

## Rollback Trigger
- If fast-track graduation produces false-verified findings (verified then contradicted within 2 dispatches), revert to age ≥ 3 for all findings.
- If queue concentration signal over-corrects (data-hunts starved below 30% of dispatches despite being highest-yield type), remove the preemptive trigger and rely on exhaustion-only.

## Line Budget
Before: 117 lines | After: 116 lines | Limit: 150 lines | Headroom: 34 lines
