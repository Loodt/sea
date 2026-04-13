# EXP-023: Meta-Evolution 011 (v043 → v044)

## Date
2026-04-11

## Trigger
Conductor iteration 24 on financial-advisor-intelligence. 10 projects, ~140+ dispatches, ~1,700+ findings. Continuation of EXP-022 validation plus new systemic patterns identified.

## Data Analysed
- financial-advisor-intelligence: 22 dispatches (iters 1-22), 130 findings, 31 questions (14 open, 17 resolved)
- Full dispatch type sequence and yield analysis for iters 9-22 (post-crash, post-v042 window)
- Gap iteration analysis (iters 18, 21 — no dispatch logged)
- Question density comparison across all 10 projects
- EXP-022 validation criteria re-checked

## EXP-022 Validation Results (continued)

| Criterion | Result |
|-----------|--------|
| Reasoning recurrence: dispatched in any 10-iter window when threshold met | **PARTIAL** — iter 22 dispatched design-space (first since iter 7). v043 rule would have triggered ~iter 13. Post-v043 behavior correct; pre-v043 data confirms the gap. |
| Synthesis recurrence: no 8+ gap when store >40 | **PASS post-v043** — only 1 synthesis dispatch (iter 12), but v043 rule only applies from v043 deploy forward. |
| Narrowed stall: declining yield → exhaustion eval | **NOT TRIGGERED** — Q011 narrowed 2× with stable yield (10, 10), correctly not evaluated for exhaustion. Rule validated as correctly scoped. |
| No regression: findings/dispatch >= 6.0 | **PASS** — 7.6 avg across iters 11-22 |

## Key Findings

### 1. Question generation inflation (NEW systemic pattern)
Financial-advisor has 31 questions — 2.4× the portfolio average question density (0.24 questions/finding vs 0.08-0.12). Every successful dispatch creates exactly 1 new question, maintaining steady-state open count rather than converging. At iter 22: open:resolved = 14:17 = 0.82:1.

**Evidence:** All dispatches iters 9-22 show newQuestionsCreated = 1 (except iter 13 which had 2). No dispatch created 0 new questions. The system never shifts to pure resolution mode.

**Impact:** Wasted dispatch budget on questions that may never be reached. Project stays in exploration mode when it should converge.

**Root cause:** No convergence gate. Question generation cap (line 19) limits per-dispatch but has no project-lifecycle awareness.

### 2. Dispatch gap iterations (NEW failure pattern)
Iterations 18 and 21 advanced the counter without logging a dispatch. Possible causes: question selector returned no valid question, silent error in dispatch, or state advancement bug. Either way, these are wasted iteration slots.

**Impact:** 2/22 iterations (9%) produced nothing. Over a 30-iteration project, this could waste 3 dispatches.

### 3. Synthesis starvation store-growth qualifier
Current rule triggers synthesis after 8 dispatches since last, regardless of store growth. If the store grew <15 findings since last synthesis, forced synthesis yields diminishing returns. For stores >100 findings, synthesis should be more frequent — the 8-dispatch gap is too long when each dispatch adds 7+ findings.

### 4. Verification floor needs resolution-based trigger
Current rule: "After 8+ dispatches with <30% verified." Financial-advisor is at 35% at iter 22 — above floor. But several completed projects finished below 30% because the trigger came too late relative to question resolution rate. Adding a resolution-based trigger (>75% resolved) would catch projects approaching completion with low verification.

### 5. Resolution verification: FULLY VALIDATED
Post-v042 iters 19-22: zero same-question re-dispatch. Can upgrade infra debt status.

## Changes Made

### CLAUDE.md (v043 → v044)

1. **Question convergence (NEW rule):** After iter 12 with open >12, cap new questions at 1 for all types. After iter 18 with open >8, cap at 0. Forces convergence in mature projects.
2. **Synthesis starvation refinement:** Added store-growth qualifier (grew >15 findings since last synthesis). At store >100, reduced gap threshold from 8 to 5. Prevents low-value forced synthesis while accelerating it for mature stores.
3. **Dispatch gap gate (NEW):** Log DISPATCH_GAP when iteration advances without dispatch. 2+ gaps in 5 iterations → diagnose selector.
4. **Verification floor timing:** Added resolution-based trigger (>75% questions resolved) alongside dispatch-count trigger.
5. **Infrastructure debt updates:** Resolution verification → VALIDATED v043. Added dispatch gap detection as new item.

Net line change: +3 (114 → 117, budget 150)

## Validation Plan (for EXP-024)
1. **Question convergence:** Projects past iter 12 with open >12 should show 0-1 new questions per dispatch, not 2-3
2. **Dispatch gaps:** DISPATCH_GAP events should be logged; 0 gaps in next 10 dispatches = healthy selector
3. **Synthesis acceleration:** Stores >100 findings should see synthesis within 5 dispatches of last
4. **Verification floor:** Projects with >75% resolved should have verification check triggered
5. **No regression:** findings/dispatch rate >= 6.0 baseline

## Rollback Triggers
- Question convergence cap causes important questions to be lost (cap prevents generation of high-value question)
- Synthesis acceleration forces premature synthesis when store is large but has few new findings
- findings/dispatch drops below 5.0 for 5+ consecutive dispatches
- More than 1 dispatch gap in 5 iterations after v044 deploy (selector broken, not improved)
