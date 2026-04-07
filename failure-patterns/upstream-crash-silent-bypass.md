---
domains: [general]
question_types: [all]
---

# Upstream Crash Silent Bypass

When an upstream pipeline step crashes (exit code 1, 0 bytes output) and the downstream step proceeds as if it succeeded. The downstream step produces a complete, high-quality deliverable — but its sourcing chain is suspect because the upstream step's quality controls (source verification, finding persistence, reference logging) were never executed.

This is distinct from protocol-artifact-loss-on-crash (where the deliverable step itself runs out of context and loses metadata). Here the crash is UPSTREAM, and the downstream step silently compensates — likely drawing from model training data rather than verified web sources.

## Signature
- Upstream step trace: exit code 1, 0 bytes output
- Downstream step: full deliverable produced, often high quality
- Claims in deliverable cite sources that look real but were never verified through the research pipeline
- Finding IDs referenced that were never created (because the step that creates them crashed)
- No crash recovery protocol followed despite one being documented

## Why It's Dangerous
The output LOOKS well-sourced: proper citation format, PMC IDs, DOIs, author names. A human reviewer sees a professional report. But the sourcing chain bypassed verification — the citations may come from the model's training data rather than confirmed web lookups. This is the pipeline equivalent of a passing test that doesn't actually test anything.

## Observed Impact
sewage-gold iter-003: research crashed (5.9KB prompt, 0 bytes output), synthesis produced a 24KB report with 11+ phantom finding IDs, 11+ new source citations, and zero knowledge store updates. The report's analytical quality scored 7-8 across content dimensions — the silent bypass was invisible without checking the research trace.

## Prevention
1. **Hard gate between steps:** Synthesis checks research trace exit code before starting. Exit code != 0 → follow crash recovery protocol or abort. NEVER proceed silently.
2. **Crash recovery protocol awareness:** The crash recovery protocol (zero prior-file loading, single research question, incremental trace logging) must be treated as mandatory, not optional.
3. **Source provenance flag:** If synthesis runs after a research crash, ALL claims must be tagged [UNVERIFIED: research step crashed] regardless of citation quality. The model's confidence in a citation is not evidence that the citation was verified.
4. **Trace-based gating over content-based gating:** Don't check whether the output LOOKS properly sourced — check whether the process that verifies sources actually ran.

## Key Distinction from Other Patterns
- **Context exhaustion:** Agent runs out of context during its own step. Fix: reduce loading.
- **Protocol artifact loss on crash:** Deliverable step succeeds but loses its own metadata. Fix: interleave artifact writes.
- **Upstream crash silent bypass (this pattern):** Previous step crashes, current step produces deliverable without upstream's quality controls. Fix: hard gate between steps.

## Source
- Project: sewage-gold, iteration 003
- Conductor version: v003
