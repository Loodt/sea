# Dispatch Observations & Yield Data

Moved from CLAUDE.md to stay within line budget. Updated at v032 (2026-04-09).

## Yield by Question Type (cross-project, 97+ dispatches)

| Type | Avg findings/dispatch | Resolution rate | Sample size | Notes |
|------|----------------------|-----------------|-------------|-------|
| data-hunt | 10-14 | ~90% | 30+ | Highest yield. Consistent across domains. |
| mechanism | 9-12 | ~85% | 18+ | Full-budget convergence normal. Multi-iter (2-3) produces 17-19 findings. |
| landscape | 10-13 | ~95% | 14+ | Strong early-game. Generates most new questions. Multi-iter produces 19-24. |
| kill-check | 7-10 | ~85% | 10+ | Dual-value: findings + branch pruning. |
| synthesis | 4-14 | 100% | 14+ | Always resolves. Recent dispatches producing 11-14 findings (up from 4-8). |
| first-principles | 4-7 | ~90% | 4 | Dispatched late (iter 13-14). Small sample. v031 relaxes prerequisites. |
| design-space | — | — | 0 | Never dispatched. v032: trigger lowered to iter >5, auto-generation when ≥3 mechanism/data-hunt resolved. |

## Cross-Project Verification Rates (as of 2026-04-08)

| Project | Verified | Total | Rate | Status |
|---------|----------|-------|------|--------|
| chrome-pgm-tailings | 65 | 84 | 77% | Completed |
| sa-self-activating-geopolymers | 144 | 226 | 64% | Completed |
| sa-logistics-neutral-exchange | 126 | 262 | 48% | Completed |
| marketing-campaign-history | 39 | 109 | 36% | Completed |
| sewage-gold | 48 | 162 | 30% | Completed |
| total-value-recovery | 57 | 225 | 25% | Active (20% crash rate) |
| herald-research | 46 | 208 | 22% | Completed |
| x-marketing-agent | 29 | 150 | 19% | Active (iter 6, pre-seeded findings graduating) |
| **Overall** | **554** | **1,426** | **39%** | |

## Resolved Issues
- **Crash pipeline** (v029 debt #1): Zero crashes across 4+ projects. Per-project tracking in state.json works. Remaining minor: filter crash iters in `isRegressing()`.
- **Type diversity enforcement** (v029 debt #2): Root cause was `conductor-context.ts` lacking dispatch-type history. Fixed in v030: type counts + diversity warnings now injected into selection prompt.
- **Convergence taper premature on pre-seeded** (v031): Taper required 0 new questions for 2+ dispatches but fired on projects with pre-seeded questions that never needed generation. Fixed: added iter ≥4 floor.
- **Reasoning-type prerequisite bottleneck** (v031): ≥5 verified requirement + verification age lag (≥3 iters) made first-principles unreachable before iter 13. design-space never dispatched (0/97+). Fixed: SOURCE-tagged fallback (≥20) when verified <5. Trust cascade prevents bad DERIVED graduation.
- **Design-space unreachable** (v032): iter >7 trigger unreachable — most projects complete in 6-10 iterations. Lowered to iter >5, added auto-generation when ≥3 mechanism/data-hunt resolved. Infrastructure debt item #7 (reasoning-prerequisite gate) partially resolved.

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
