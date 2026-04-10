# Dispatch Observations & Yield Data

Moved from CLAUDE.md to stay within line budget. Updated at v034 (2026-04-09).

## Yield by Question Type (cross-project, 97+ dispatches)

| Type | Avg findings/dispatch | Resolution rate | Sample size | Notes |
|------|----------------------|-----------------|-------------|-------|
| data-hunt | 10-14 | ~90% | 30+ | Highest yield. Consistent across domains. |
| mechanism | 9-12 | ~85% | 18+ | Full-budget convergence normal. Multi-iter (2-3) produces 17-19 findings. |
| landscape | 10-13 | ~95% | 14+ | Strong early-game. Generates most new questions. Multi-iter produces 19-24. |
| kill-check | 7-10 | ~85% | 10+ | Dual-value: findings + branch pruning. |
| synthesis | 4-14 | 100% | 23 | Always resolves. Yield improves with store size (late: 11-14, early: 4-8). Max 2 consecutive added in v033. |
| first-principles | 4-8 | ~90% | 5 | v033 lowered to iter 4. v034 validated: dispatched iter 4, 1 inner iter, 8 findings (linkedin). Fast convergence confirmed. |
| design-space | 8 | ~100% | 2 | v033 lowered to iter 4. v034 validated: dispatched iter 5, 2 inner iters, 8 findings (linkedin). |

## Cross-Project Verification Rates (as of 2026-04-09)

| Project | Verified | Total | Rate | Status |
|---------|----------|-------|------|--------|
| chrome-pgm-tailings | 65 | 84 | 77% | Completed |
| sa-self-activating-geopolymers | 144 | 226 | 64% | Completed |
| sa-logistics-neutral-exchange | 126 | 262 | 48% | Completed |
| marketing-campaign-history | 39 | 109 | 36% | Completed |
| sewage-gold | 48 | 162 | 30% | Completed |
| total-value-recovery | 57 | 225 | 25% | Active (20% crash rate) |
| herald-research | 46 | 208 | 22% | Completed |
| x-marketing-agent | 29 | 161 | 18% | Completed (6 dispatches, 100% resolution) |
| linkedin-marketing-agent | — | 102 | — | Active (iter 8, 7/9 resolved, verification pending) |
| **Overall** | **584+** | **1,539+** | **~38%** | |

## Resolved Issues
- **Crash pipeline** (v029 debt #1): Zero crashes across 4+ projects. Per-project tracking in state.json works. Remaining minor: filter crash iters in `isRegressing()`.
- **Type diversity enforcement** (v029 debt #2): Root cause was `conductor-context.ts` lacking dispatch-type history. Fixed in v030: type counts + diversity warnings now injected into selection prompt.
- **Convergence taper premature on pre-seeded** (v031): Taper required 0 new questions for 2+ dispatches but fired on projects with pre-seeded questions that never needed generation. Fixed: added iter ≥4 floor.
- **Reasoning-type prerequisite bottleneck** (v031): ≥5 verified requirement + verification age lag (≥3 iters) made first-principles unreachable before iter 13. design-space never dispatched (0/97+). Fixed: SOURCE-tagged fallback (≥20) when verified <5. Trust cascade prevents bad DERIVED graduation.
- **Design-space unreachable** (v032): iter >7 trigger unreachable — most projects complete in 6-10 iterations. Lowered to iter >5, added auto-generation when ≥3 mechanism/data-hunt resolved.
- **Reasoning types still rare** (v033 target): Only 4/97 dispatches were first-principles/design-space despite v031-032 fixes. Root cause: triggers still too late + advisory-only enforcement. v033 lowers to iter 4 + marks mandatory. Code enforcement added to infrastructure debt #7.
- **Synthesis over-concentration** (v033 target): marketing-campaign-history had 8/14 synthesis dispatches with declining yield (0 findings at iter 12). v033 adds 2-consecutive cap.
- **Reasoning-type early dispatch validated** (v034): linkedin-marketing-agent dispatched first-principles at iter 4 (8 findings, 1 inner iter) and design-space at iter 5 (8 findings, 2 inner iters). Both fast convergence — reasoning types don't need long budgets. v033 threshold change confirmed effective.
- **Code threshold lag** (v034 observation): conductor-context.ts diversity warnings still use iter >6 (first-principles) and >5 (design-space) vs playbook iter 4. Working because LLM follows playbook text, but fragile. Tracked as infra debt #6.

## Multi-Iteration Patterns
- Dispatches using 2-3 inner iterations produce highest finding counts (17-24 findings)
- This pattern appears in mechanism and landscape types at later conductor iterations
- 4-iteration data-hunt (Q021) yielded 13 findings — diminishing returns past 3 iters

## Convergence Observations
- newQuestionsCreated = 0 for 10 consecutive dispatches in sa-logistics — strong convergence
- Projects with >13 dispatches reliably reach completion or empirical-gate
- Expert adaptation rate: 64% across 50 experts (3 projects) — strong knowledge transfer
- x-marketing-agent: 6/6 answered, avg 20 findings/dispatch, 0 new questions from 5/6 (clean convergence)
- 98% dispatch success rate (52/53+ answered, 1 exhausted, 0 crashes in 4+ projects)

## v034 New Observations
- **Metric type discrepancy**: linkedin-marketing-agent logged QQ002 as "first-principles" but question record says "mechanism"; QQ005 logged as "data-hunt" but record says "kill-check". Conductor may be reclassifying question approach at dispatch. New hard rule added: metric type must match question record.
- **Iteration gaps**: linkedin-marketing-agent skips conductor iterations 1 and 6 in metrics. Possible: conductor incremented without dispatch, or unlogged dispatch. Needs code review of conductor loop iteration logic.
- **Synthesis long-run**: linkedin iter 8 synthesis used 5 inner iterations (max) for 12 findings. Avg 2.4 findings/iter — productive but slow. Inner yield gate didn't trigger (no zero-finding iteration). Gate is correctly scoped to zero-yield detection, not diminishing returns.
- **Faster project convergence**: x-marketing completed in 6 dispatches; linkedin on track for ~9-10. Earlier reasoning-type dispatch + pre-seeded questions contribute to faster convergence vs older projects (13-15 dispatches).
- **Observational data moved from CLAUDE.md**: Synthesis 100% resolution (n=23). Verification rates 22-77% across projects. Inner yield drops 30%+ past iter 3. Synthesis yield declines to 0 at iter 12 after 5 consecutive synthesis dispatches. Full-budget convergence normal for mechanism type.
