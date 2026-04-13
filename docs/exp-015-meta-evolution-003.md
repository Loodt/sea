# EXP-015: Meta-Evolution 003 — Conductor v035 → v036

## Hypothesis
The conductor playbook has three categories of weakness observable in cross-project metrics:
1. Soft rules that are violated in production (synthesis cap, reasoning diversity)
2. Missing behavioral guardrails (adaptation quality, evolution stability)
3. Stale infrastructure debt (6/6 items unresolved)

Promoting violated soft rules to hard gates and adding empirically-grounded guardrails will improve dispatch quality without increasing playbook size.

## Method
- Analyzed 110 conductor dispatches across 10 projects
- Analyzed 113 expert personas across 9 projects with library data
- Checked all 6 infrastructure debt items against source code
- Identified cross-project patterns in lineage, scores, and failure modes

## Changes (v036)

### Promotions: soft rule → Step Gate
| Rule | Evidence for promotion |
|------|----------------------|
| Synthesis consecutive cap | Violated in marketing-campaign-history: 3 consecutive synthesis dispatches, 3rd produced hollow answer (0 findings) |
| Reasoning diversity | Only 3 reasoning-type dispatches out of 110 (2.7%). "Mandatory" advisory was dead letter |

### New rules
| Rule | Evidence |
|------|---------|
| Adaptation floor (score >= 5.0) | Parents scoring <5 produce children averaging 2.1 (includes score-0 failures). Parents >10 produce children averaging 9.9 |
| Evolution hold preference | Zero no-change holds across 110+ dispatches. Score trajectory flat (mean 8.44). Over-evolution wastes iterations |
| Escalation enforcement | 20.3% expert failure rate, 52 failures all captured as persona heuristics, 0 escalated to infrastructure despite recurring patterns across projects |

### Consolidations (-3 lines net)
| Removed | Reason |
|---------|--------|
| Verification signal (Question Selection) | Merged into Verification floor (Step Gates) — eliminated duplication |
| DERIVED cascade lag | Merged into DERIVED graduation line — explanatory note, not behavioral |
| JSONL file-level locking rule | Pure code implementation detail, not agent-behavioral |
| Infrastructure debt items 1+3 | Merged into "Question state injection" — both are dispatch-state-injection gaps |

## Measurement
### Success criteria
- Next 20 conductor dispatches: 0 synthesis cap violations (was 1 in ~110)
- Next project reaching iter 4+: at least 1 reasoning-type dispatch (was 2.7% historically)
- Next 5 evolution cycles: at least 1 no-change hold (was 0% historically)

### Rollback trigger
- If any new Step Gate causes dispatch deadlock (no valid question available)
- If adaptation floor causes >50% of dispatches to use fresh personas (over-constraining)

## Result
Pending — requires conductor runs under v036 to measure.

## Line count
v035: 121 lines → v036: 118 lines (net -3, under 120 consolidation target)
