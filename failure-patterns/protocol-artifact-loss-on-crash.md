---
domains: [general]
question_types: [all]
---

# Failure Pattern: Protocol Artifact Loss on Context Crash

## Description
When an agent crashes due to context exhaustion, protocol artifacts (experiment logs, traces, metrics) are consistently lost because they are written AFTER the primary deliverable. The deliverable survives but the audit trail does not. This creates a blind spot for evolution — the system can see WHAT was produced but not HOW, making it harder to diagnose process failures and track methodology.

## Detection Signals
- Exit code 1 + complete/substantial deliverable + empty or scaffold-only experiment log
- Trace file contains only the header (no step entries)
- Metrics/scores not appended despite scoreable output existing
- references/links.md not updated despite new sources appearing in the deliverable

## Progression (observed in sewage-gold)
- Iteration 1: No artifacts (context exhausted during research — nothing survived)
- Iteration 3: Full report produced, zero protocol artifacts (context exhausted after synthesis)
- Iteration 6: Full 544-line report (scored 8.70), experiment log scaffold-only, trace header-only

Pattern: every high-content iteration except iter 2 lost its artifacts. The failure is structural, not incidental.

## Root Cause
The execution order "deliverable first → artifacts after" is correct for VALUE preservation (the deliverable is more important than the log). But it GUARANTEES artifact loss whenever context runs out during or just after the deliverable — which is exactly when context pressure is highest.

## Prevention
1. **Incremental artifact writing:** Log references, findings, and trace entries AS research progresses — not in a batch after the deliverable. Each web search → append source to exp log. Each section completed → append trace entry.
2. **70% context checkpoint:** At ~70% estimated context consumption, pause deliverable work to fill exp log "Result" and "Analysis" sections with current state. Then continue.
3. **Minimal viable artifacts > complete artifacts:** A half-filled experiment log is infinitely more valuable than an empty scaffold. Write partial entries rather than deferring for a complete write-up.

## Key Distinction from Context Exhaustion
Context exhaustion (see context-exhaustion.md) is about the agent running out of context entirely — producing no deliverable. This pattern is about the agent producing EXCELLENT deliverables but losing the audit trail. The fix for context exhaustion is to reduce loading and scope. The fix for artifact loss is to change the TIMING of artifact writes from sequential to interleaved.

## Source
- Project: sewage-gold
- Iterations: 1, 3, 6
- Conductor version when identified: v003
