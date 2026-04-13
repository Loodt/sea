# EXP-028: Meta-Evolution v048 → v049

**Date:** 2026-04-11
**Trigger:** Conductor iteration 9, financial-advisor-intelligence project
**Evidence base:** 8 dispatches (financial-advisor-intelligence), lineage from sewage-gold

## Observations

### Project Performance (financial-advisor-intelligence, 8 dispatches)
| Metric | Value |
|--------|-------|
| Avg findings/dispatch | 7.4 (59 total) |
| Type diversity | 6 types in 8 dispatches, 0 same-type violations |
| Verification rate | 30/59 = 51% |
| Crashes | 0 |
| Reasoning dispatch timing | first-principles iter 5, design-space iter 6 |
| Exhaustions | 1 (Q016 synthesis) |

### Validated (v048)
- **Fast-track graduation**: 51% verified (vs 29% in prior project). SOURCE ≥0.90 after 2 dispatches is accelerating graduation without false-verification.
- **Same-type cap**: No consecutive violations in 8 dispatches. Prompt warning is sufficient.
- **Reasoning dispatch timing**: First-principles at iter 5 (vs never/iter 13 pre-fix). Design-space at iter 6.
- **Queue concentration signal**: Not yet triggered (no >5 open data-hunts observed).

### Issues Found

#### 1. Question Store Wipe (CRITICAL)
- **Evidence:** Iter 8 (Q003 data-hunt) measured newQuestionsCreated = -18. questions.jsonl is 0 bytes.
- **Root cause:** Hybrid agent has unchecked write access to questions.jsonl via LLM file tools. Agent overwrote entire file instead of appending/updating. Code path: `hybrid-agent.ts:164-170` reads delta as `questionsAfter.length - questionsBefore.length = 0 - 18 = -18`.
- **Impact:** All 18 question records lost. summary.md still references 11 open questions but the store is empty.
- **Fix:** Code guard added at `hybrid-agent.ts:166-171` — detects zero-question post-dispatch when pre-dispatch was non-empty, restores from snapshot.

#### 2. Premature Synthesis Exhaustion
- **Evidence:** Synthesis Q016 dispatched at iter 7 with ~46 findings. Yielded 4 findings and exhausted (expected 8-10 at maturity).
- **Root cause:** No minimum store size for synthesis dispatch. Existing rules boost synthesis at maturity (>60 findings) but don't block it on thin stores.
- **Fix:** Added synthesis dispatch prerequisite: ≥50 findings OR ≥25 verified. Parallels existing first-principles/design-space thin-store guard.

## Changes (v049)

### Protocol (CLAUDE.md)
1. **Synthesis dispatch floor** — Type table updated: "Requires ≥50 findings OR ≥25 verified — premature dispatch exhausts cheaply"
2. **Hard Rules** — Synthesis added to thin-store dispatch guard alongside first-principles/design-space
3. **Question store integrity gate** — New step gate: post-dispatch, if questions wiped → QUESTION_STORE_WIPE, restore from snapshot
4. **Infrastructure Debt** — Item 1 (CRITICAL): question store write protection. QUESTION_STORE_WIPE added to observability logging list.

### Code (hybrid-agent.ts)
- Post-dispatch guard: if `questionsBefore.length > 0 && questionsAfter.length === 0`, log warning and restore from pre-dispatch snapshot.

### Line Budget
117 → 118 lines | Limit: 150 | Headroom: 32

## Measurement Plan
- **Synthesis floor**: Next project with synthesis dispatch should show dispatch delayed until store ≥50. If synthesis never dispatches due to floor being too high, lower to 40.
- **Question store guard**: Monitor for QUESTION_STORE_WIPE log entries. Should fire and recover rather than silently wipe.
- **Fast-track graduation**: Continue monitoring for false-verification (verified finding contradicted within 2 dispatches).

## Rollback Triggers
- If synthesis floor causes synthesis starvation (>15 dispatches without synthesis despite need), lower threshold to 40
- If question store guard false-fires (misclassifies legitimate pruning as wipe), add delta threshold (e.g., allow up to 50% reduction)
