---
domains: [general]
question_types: [all]
---

# Heuristic Layer Ceiling

When a behavioral heuristic in the persona fails 3+ consecutive times despite correct root cause diagnosis, the fix is being applied at the wrong layer. The persona (behavioral guidance) cannot fix problems in the pipeline architecture (execution order, context routing, step isolation).

## Signature
- Same process failure recurs across 3+ iterations
- Each evolution applies a progressively refined heuristic targeting the correct root cause
- The heuristics are well-reasoned and correctly diagnose the problem
- The executing agent either never sees the heuristic (wrong step reads persona) or cannot comply (pipeline controls execution order, not the agent)
- Fix-resistant-identical-failure pattern triggered at iteration 2, but the re-diagnosis still produces a heuristic-layer fix

## Why It Happens

Persona heuristics guide agent *decisions* — what to research, how to synthesize, what to tag. They cannot control *pipeline mechanics* — which step runs next, whether a crashed step blocks downstream, whether persistence happens before or after report writing.

The confusion arises because the diagnosis is correct: "the knowledge store should be updated before the report is written" is true. But the persona is read by the plan step, not the synthesis step. Even if synthesis reads the persona, execution order is controlled by the pipeline runner, not by the agent's intentions.

Each escalation (prescriptive → prohibitive → architectural-in-words) is a higher-fidelity description of the same fix at the same wrong layer. The fix needs to move to a different layer entirely: pipeline code, conductor logic, or explicit step gating.

## Observed Impact
sewage-gold project, iterations 001-004:
- Iter-1: Prescriptive heuristic ("own your writes") → knowledge store not updated
- Iter-2: Prohibitive heuristic ("NEVER reference IDs that don't exist") → knowledge store not updated, phantom IDs
- Iter-3: Execution-order heuristic ("synthesis blocked until research exits 0, persist BEFORE report") → knowledge store not updated, research crash bypassed
- Iter-4: Same failure + NEW escalation (ID collision — reused existing IDs with different content)

Process compliance: 7 → 3 → 3 → 2 across 4 iterations. Each heuristic fix was well-reasoned; none worked.

## Prevention

1. **After 2 failed heuristic fixes (fix-resistant-identical-failure threshold):** Ask whether the fix layer matches the failure layer. If the failure is in execution mechanics (step order, crash handling, file I/O), a persona heuristic cannot fix it regardless of framing.

2. **Layer diagnosis:** Map the failure to the layer that controls the relevant behavior:
   - Agent decisions (what to research, how to tag) → persona heuristic is appropriate
   - Pipeline execution (step order, crash gating, file persistence timing) → pipeline code change needed
   - Infrastructure (API failures, context limits, tool availability) → infrastructure fix needed

3. **If the fix layer is above the evolution agent's authority:** Flag the needed change explicitly in the evaluation/lineage rather than attempting another heuristic. The evolution agent should document what pipeline change is needed, not pretend a persona change will substitute.

4. **Workaround acknowledgment:** If the evolution step can provide a manual workaround (e.g., backfilling the knowledge store), document this as a workaround in the persona, not as a fix. Make the workaround nature explicit so future agents don't assume the underlying problem is solved.

## Key Distinction from Other Patterns
- **Fix-resistant-identical-failure:** Detects that a fix isn't working after 2 iterations. This pattern explains *why* — the fix is at the wrong layer — after the third failure confirms the pattern.
- **Evolution-persistence-failure:** Evolution changes logged but not written. This is about the evolution step's own persistence. Heuristic-layer-ceiling is about the evolution step's changes being correctly written but unable to affect the failing step.
- **Pipeline-step-deferral:** The step defers its work. Heuristic-layer-ceiling is about why telling the step not to defer (via persona) doesn't work.

## Source
- Project: sewage-gold, iterations 001-004
- Conductor version: v003
