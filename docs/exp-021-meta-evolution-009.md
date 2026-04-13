# EXP-021: Meta-Evolution 009 (v041 → v042)

## Date
2026-04-11

## Trigger
Conductor iteration 18 on financial-advisor-intelligence. 10 projects totaling ~136 dispatches and ~1,667 findings. EXP-020 validation criteria checkable plus new pattern discovery.

## Data Analysed
- 10 projects, ~136 conductor dispatches, ~1,667 findings
- Latest run: financial-advisor-intelligence (17 dispatches, 97 findings, 1 crash recovered)
- Full dispatch sequence analysis for consecutive-type and same-question patterns
- EXP-020 validation results (reasoning threshold fix)

## EXP-020 Validation Results

| Criterion | Result |
|-----------|--------|
| Reasoning types dispatched earlier (iter >= 4 threshold) | **PASS** — financial-advisor dispatched design-space at iters 5-6, first-principles at iter 7 |
| Same-type cap still violated (expected without code fix) | **CONFIRMED** — 3x kill-check at iters 2-4 in financial-advisor |
| Synthesis yield at maturity (8-10) | **CONFIRMED** — Q016 synthesis produced 10+10 findings at iters 12-13 |
| No regression in findings/dispatch rate | **PASS** — 6.7 avg sustained |

## Key Findings

### 1. Same-question consecutive re-dispatch (NEW pattern)
Three questions in financial-advisor-intelligence were dispatched back-to-back:
- Q016 (synthesis): iters 12 and 13, both "answered" with 10 findings each
- Q014 (kill-check): iters 14 and 15, both "answered" with 5 and 9 findings
- Q011 (data-hunt): iters 16 and 17, both "narrowed" with 10 findings each

**Root cause identified:** The hybrid agent claims to resolve questions in its structured output report (`questionsResolved` field) but does not reliably write the resolution to `questions.jsonl`. The conductor trusted the agent's claim without verifying the store. The question stays "open" and gets re-selected.

**Evidence:** Q016 has `dispatches: 1` in questions.jsonl despite being dispatched at iters 12 AND 13. The dispatch counter wasn't incremented either — same root cause (agent didn't write).

**Fix:** Added resolution verification to conductor.ts — after hybrid research, the conductor now reads questions.jsonl and enforces resolution for any question the agent claimed to resolve but didn't write.

### 2. Same-type cap: prompt-level enforcement added
The conductor selection prompt now includes the recent dispatch type sequence and a hard block warning when the last 2 dispatches were the same type. Previous approach relied only on aggregate type counts, which didn't convey the consecutive pattern.

**Before:** LLM sees "kill-check: 3" (aggregate) — no visibility into whether they were consecutive.
**After:** LLM sees "Recent dispatch sequence: kill-check → kill-check" + "SAME-TYPE CAP: Last 2 dispatches were both kill-check. You MUST select a DIFFERENT type."

This is a partial fix (prompt-level). Full enforcement requires conductor-loop code to reject same-type selections, which remains as infrastructure debt.

### 3. Same-type cap violation in financial-advisor
Despite v041 improvements, financial-advisor had 3 consecutive kill-checks at iters 2-3-4. The LLM only saw aggregate counts, not the consecutive pattern. The prompt-level fix should prevent this.

### 4. Reasoning threshold fix validated
Financial-advisor dispatched design-space (iters 5-6) and first-principles (iter 7) — well before the old threshold of iter 6. The `iter >= 4` fix from v041 is working as intended.

## Changes Made

### conductor-context.ts
- Added consecutive same-type sequence tracking (parses last 3 metrics entries)
- Added hard block warning when last 2 dispatches are same type
- Added recent dispatch sequence to stats text for LLM visibility

### conductor.ts
- Added resolution verification after hybrid research completes
- If `questionsResolvedByAgent` contains IDs not marked resolved in questions.jsonl, conductor enforces the resolution via `updateQuestion()`
- Added `updateQuestion` to imports

### CLAUDE.md
- Version: v041 → v042
- Infrastructure Debt #1: Updated status to PARTIAL (prompt enforcement added)
- Infrastructure Debt #2: NEW — resolution verification (FIXED in v042)
- Net line change: 0 (113 lines maintained)

## Validation Plan (for EXP-022)
1. **Same-type cap**: Next 10 dispatches should have zero 3+ consecutive same-type runs
2. **Resolution verification**: Next 10 dispatches should have zero same-question consecutive re-dispatches where the first was "answered"
3. **Reasoning diversity**: Reasoning types should exceed 10% of typed dispatches across next 20 dispatches
4. **No regression**: findings/dispatch rate >= 6.0 baseline

## Rollback Triggers
- Resolution verification causes incorrect early resolution of open questions (false positive on questionsResolvedByAgent)
- Same-type block causes the LLM to select low-value questions just to satisfy type rotation
- findings/dispatch drops below 5.0 for 5+ consecutive dispatches
