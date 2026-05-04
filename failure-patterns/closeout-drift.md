# closeout-drift

## Symptom
After all questions reach terminal status (resolved + exhausted + empirical-gate, with `open == 0` and `activeQuestionId == null`), the conductor continues to dispatch iterations. The producer either:
- Re-surfaces prior research as if it were new work (apparent yield, zero store delta), or
- Crashes at plan/research with exit code 1 and 0 KB output (no live question to anchor the prompt), or
- Emits attestation-style findings (`F99xxx`) that may or may not persist (compounds with PERSISTENCE_GAP).

Score trend decays sharply across closeout iterations even though the persona is unchanged. Iter-N evaluator typically warns "do not dispatch iter-N+1 under identical conditions"; iter-N+1 dispatches anyway.

## Root cause
Missing completion gate in conductor `select` step. The terminal-status check is implicit (no question chosen → empty dispatch) rather than explicit (terminal state → status transition `active → completed`). State.json status remains `active` indefinitely, and the loop has no exit condition.

This is **infrastructure**, not persona. Persona heuristics cannot intercept it because the crash happens at the harness layer, before the persona is loaded.

## Detection
- `state.json.activeQuestionId == null` AND `status == "active"` for ≥2 consecutive iterations
- All `questions.jsonl` entries in {resolved, exhausted, empirical-gate, killed}, zero `open`
- Findings terminus unchanged across 2+ iterations
- Evaluator emits explicit "should be completed" recommendation in reflection

## Prevention
1. **Code-level completion gate** (`completionGate()` — referenced in F99027): in conductor `select` step, before LLM ranking, check terminal state. If `open == 0`, transition `state.status` to `completed`, write summary terminus, exit clean.
2. **Evolve-step strategic advancement:** when evaluator flags closeout-drift and persona is in-budget + previously scoring well, the correct evolution outcome is `strategic` (state transition) not `behavioral` (persona edit). Persona edits are wasted motion.
3. **Reflection veto:** if iter-N reflection contains explicit "do not dispatch iter-N+1" language, conductor must respect it pending evolution review — no automatic continuation.

## Cross-project status
First confirmed in `total-value-recovery` iter 3-4 (2026-04-29 / 2026-05-04). Score path: 7.35 → 7.15 → 6.15 → 4.3 across iter 1-4 with persona unchanged at v004.

## Related patterns
- `protocol-artifact-loss-on-crash` — closeout iterations that crash also lose attestation artifacts
- `evolution-persistence-failure` — closeout iterations are a common context for PERSISTENCE_GAP repros (F99022/F99023/F99024 in this project, second time)
- `heuristic-layer-ceiling` — confirms persona edits cannot fix this
