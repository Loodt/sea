# Dispatch Pattern Archive

Observations from conductor dispatches, preserved for reference. Key behavioral rules are extracted into CLAUDE.md; this file contains the full evidence and analysis.

## Validated Patterns (sewage-gold D1-D20, first run)

- **Domain-specific experts converge faster than generalists.** Narrow specialists converged in 2-3/5 inner iterations. The expert creation framework's emphasis on "defining trait" and "core values" is working — preserve this.
- **Kill signals are as valuable as answer signals.** Dispatches 2, 4, and 9 all produced high-value convergence by killing pathways. Question selection should not deprioritize questions likely to produce kill signals.
- **Integration validation catches persistence gaps.** The conductor's post-integration check (conductor.ts:265-276) correctly detects when handoff findings weren't persisted. This is the conductor-level equivalent of the summarize completeness gate.
- **Question generation quality determines dispatch efficiency.** Questions that decompose cleanly (one expert, one domain) dispatch better than cross-domain questions.
- **Knowledge accumulation has a compound effect on expert efficiency.** The system went from 1.9 F/iter (D1-5, store ~0-19 findings) to 9.67 F/iter (D12-14, store ~60+ findings) — a 5x improvement. The inflection point appears around ~40-50 verified findings. This is the system's most important emergent property.
- **Kill-check questions are the most iteration-efficient category.** D4 (Q013) killed 6 pathway classes in 4 iterations; D9 (Q019) killed a pathway in 4 iterations with 3 findings. Higher information density because kill signals prune entire branches.
- **Synthesis-ready questions converge in 1-2 iterations.** D12 (Q025, sampling strategy) converged in 1 iteration with 8 findings. The expert synthesized existing knowledge (analytical chemistry + facility data) rather than discovering new data.
- **Domain data density drives per-iteration efficiency.** D14 (Q017, regulatory permitting) produced 21 findings in 2 iterations (10.5 F/iter) — the highest single-dispatch yield. Data-rich domains reliably outperform data-sparse domains by 5-10x per iteration.
- **Frontier composition determines per-iteration efficiency.** D15-D20 averaged 2.1 productive F/iter vs 9.67 in D12-D14. The remaining open questions are mechanism and data-hunt types — harder, narrower. Per-iteration efficiency depends on question composition, not just store size.
- **Full-budget convergence is normal for mechanism questions.** D17, D18, D19 all used 5/5 iterations but converged successfully. Mechanism questions require iterative deepening.
- **Exhaustion is bimodal.** Every exhausted dispatch (D3, D5, D10, D13, D16, D20) produced exactly 0 handoff findings and 0 new questions. No "partial exhaustion" exists.

## Observed Risks

- **Data-hunt questions have the highest exhaustion risk.** D3 (Q008) and D5 (Q015) both sought specific numeric values not in published literature. Mitigated by data-hunt iteration cap at 3.
- **Infrastructure failures masquerade as exhaustion.** D10 and D13 both showed zero findings but were actually infrastructure crashes. Resolved in v012 with "crashed" status.
- **Question frontier growth outpaces resolution.** D1-D20: 15 resolved, 37 new = net +22 questions. Pruning mode helps but frontier remains large.
- **Non-capped question types exhaust at full budget.** D16 and D20 (mechanism) burned 5/5 iterations for zero output. Mid-loop early-exit (debt #4) would prevent this.

## Dispatch Efficiency Summary (sewage-gold, D1-D20, first run)

| Metric | D1-5 | D6-8 | D9-D11 | D12-D14 | D15-D17 | D18-D20 | Overall |
|--------|------|------|--------|---------|---------|---------|---------|
| Total dispatches | 5 | 3 | 3 | 3 | 3 | 3 | 20 |
| Productive (answered/killed) | 3 (60%) | 3 (100%) | 2 (67%) | 2 (67%) | 2 (67%) | 2 (67%) | 14 (70%) |
| Exhausted/crashed | 2 (40%) | 0 (0%) | 1 (33%) | 1 (33%) | 1 (33%) | 1 (33%) | 6 (30%) |
| Total findings | 19 | 24 | 11 | 29 | 21 | 17 | 121 |
| Productive F/iter | 1.9 | 2.67 | 1.43 | 9.67 | 2.63 | 1.7 | 2.6 |
| Wasted iterations (exhausted) | 10 (50%) | 0 (0%) | 5 (42%) | 5 (63%) | 5 (38%) | 5 (33%) | 30 (39%) |
| Questions resolved | 4 | 3 | 2 | 2 | 2 | 2 | 15 |
| New questions generated | 9 | 9 | 5 | 5 | 4 | 5 | 37 |

## Second Run Metrics (sewage-gold D21-D28, conductor session 2)

| Dispatch | Question | Type | Status | Findings | Inner Iters | F/Iter |
|----------|----------|------|--------|----------|-------------|--------|
| D21 | Q001 | landscape | answered | 0 | 5 | 0.0 |
| D22 | Q003 | — | answered | 11 | 2 | 5.5 |
| D23 | Q010 | — | crashed | 0 | 2 | — |
| D24 | Q010 | — | answered | 6 | 2 | 3.0 |
| D25 | Q012 | — | answered | 7 | 1 | 7.0 |
| D26 | Q002 | — | crashed | 0 | 2 | — |
| D27 | Q002 | mechanism | answered | 28 | 4 | 7.0 |
| D28 | Q005 | — | answered | 7 | 2 | 3.5 |

**Summary:** 59 findings in 20 inner iterations. Productive: 3.7 F/iter (up from 2.6 in first run). Zero exhausted dispatches — type caps + improved question selection eliminated wasted iterations. Crash recovery 2/2 successful. Knowledge compounding confirmed: D27 hit 7 F/iter with 100+ findings in store.

**New pattern: Question frontier control.** Net +2 questions (vs +22 in first run). Pruning mode and tighter selection contain frontier growth effectively.

**New pattern: Crash-then-succeed is the normal infrastructure recovery path.** Both crashes recovered on re-dispatch with substantial output (6 and 28 findings). Re-dispatch should be immediate, not delayed.

## Third Run Metrics (total-value-recovery D1-D5, conductor session 1)

| Dispatch | Question | Type | Status | Findings | Inner Iters | F/Iter |
|----------|----------|------|--------|----------|-------------|--------|
| D1 | Q001 | landscape | answered | 6 | 2 | 3.0 |
| D2 | Q003 | kill-check | answered | 12 | 2 | 6.0 |
| D3 | Q002 | landscape | answered | 33 | 3 | 11.0 |
| D4 | Q005 | landscape | crashed | 0 | 2 | — |
| D5 | Q004 | kill-check | answered | 17 | 2 | 8.5 |

**Summary:** 68 findings in 11 inner iterations. Productive: 7.6 F/iter (highest of any run). Zero exhausted dispatches. Kill-checks (Q003, Q004) both converged in 2 iterations with high finding density. D3 (landscape) hit 11 F/iter — knowledge compounding starting even with only 18 findings in store, suggesting domain data density matters more than store size for early dispatches.

**New pattern: Kill-check questions are viable as early dispatches.** Q003 (cyanide integration viability) and Q004 (SiO₂/Al₂O₃ separation) both dispatched in the first 5 and both converged productively. Kill-checks don't require a mature store — they need a clear hypothesis to test.

**New pattern: Hollow answers are real.** D21 (sewage-gold second run) showed answered + 0 findings. This is a protocol gap: the conductor treated it as productive convergence. Addressed in v017 with strengthened hollow answer gate.

**New pattern: Near-duplicate questions waste dispatches.** Sewage-gold Q007 and Q011 both ask about gold speciation in sewage with slightly different framing. Selection should check for semantic overlap before creating new questions.

## Resolved Infrastructure Debt (archived from CLAUDE.md)

Items 5-8, 12-15, 17-22 from the original debt list were resolved across v006-v013. Full descriptions preserved here for historical context.

- **#1 (v015):** Crash gate in loop.ts — Circuit breaker implemented in expert-loop.ts. 2 consecutive crashes → forced handoff from best successful output. Validated in D23-D24, D26-D27.
- **#5 (v006):** Evolution Protocol extraction — `extractSection()` now matches heading.
- **#6 (v008):** Expert factory failure pattern truncation — `.slice(0,5)` removed.
- **#8 (v012):** Conductor crash gate — expert-loop.ts tracks exit codes, "crashed" status distinct from "exhausted".
- **#12 (v009):** QuestionSelection.questionType — field added to types, prompts, parsing.
- **#13 (v010):** Expert creation hardcoded MAX_ITERATIONS — now uses actual cap.
- **#14 (v010):** Conductor dispatch log wrong cap — fixed.
- **#15 (v012):** Conductor metric deduplication — appendConductorMetric() checks existing.
- **#17 (v012):** Partial crash finding loss — expert-loop.ts tracks bestSuccessfulOutput.
- **#18 (v012):** Frontier size metrics — conductor-context.ts shows counts + pruning flag.
- **#19 (v013):** questionsExhausted stale entries — cleaned at iteration start.
- **#20 (v013):** Metric undercounting — uses knowledge store delta.
- **#21 (v013):** Domain-blind finding selection — keyword relevance scoring.
- **#22 (v013):** Selection prompt domain density criterion — added.
