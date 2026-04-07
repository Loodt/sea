---
domains: [general]
question_types: [all]
---

# Failure Pattern: Context Exhaustion

## Description
The agent consumes its entire context window on initialization and/or research, leaving nothing for synthesis, logging, or protocol compliance. This is the most common failure mode in research-oriented iterations and it gets **progressively worse** as a project accumulates outputs — each iteration has more prior material to load, causing the failure to occur earlier in the pipeline.

## Progression (observed in sewage-gold)
- Iteration 1: Failed after research, before synthesis
- Iteration 3: Failed after synthesis, before logging
- Iteration 4: Failed after scaffolding, before research even began
- Iterations 4-5: Consecutive crashes before research — resolved by zero prior-file loading (iter 6)
- Iteration 6: Deliverable produced (8.70 score) but protocol artifacts lost — see protocol-artifact-loss-on-crash.md

## Detection Signals
- Exit code 1 with empty or skeleton-only output
- Missing protocol artifacts (traces, experiment logs, metrics) despite content being produced
- Agent loads full prior reports/reflections during initialization
- Persona exceeds 60 lines (becomes a context burden itself)
- Project has 3+ prior iterations of accumulated output

## Prevention
1. **Context triage (Execution Protocol step 1):** Before reading any file, list specific data points needed. Read only those sections. Never load full prior files.
2. **Minimal scaffolds:** Output skeleton <20 lines (headings only). Protocol scaffolds 5-10 lines each. Do not elaborate before research begins.
3. **Persona size budget:** Max 60 lines. Consolidate during evolution rather than adding indefinitely.
4. **Protocol-artifacts-before-polish:** Complete exp log, trace, and metrics immediately after the deliverable, before any refinement.
5. **Build-on-prior selectively:** The persona encodes lessons from prior reflections. Reading the reflections again is redundant. Read only specific data from prior outputs.

## Root Causes
- Execution protocol had no context awareness (fixed in v002)
- Evolution protocol was purely additive — no consolidation trigger (fixed in v002)
- Reflection scoring had no process compliance dimension, so degrading protocol adherence produced no evolution signal (fixed in v002)

## Source
- Project: sewage-gold
- Iterations: 1, 3, 4, 5, 6
- Conductor version when discovered: v001
- Conductor version when addressed: v002 (initial), v003 (zero prior-file loading, incremental logging)
