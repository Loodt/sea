---
domains: [general]
question_types: [all]
---

# Silent Truncation Cascade

A pipeline step runs out of context mid-task, produces partial output, and exits 0 (success). Downstream steps consume the partial output as if complete, compounding the error at scale.

## Signature
- Step exits 0 but output is incomplete (e.g., only N of M items persisted)
- No crash detected — crash gates check exit code, not completeness
- Downstream steps cite or depend on the missing items
- Error multiplies: downstream produces references to nonexistent artifacts
- Pattern worsens over iterations as research scope grows (more items per step)

## Why It Happens

Context exhaustion typically manifests as a crash (exit 1, empty output). But when a step begins producing output, partially succeeds, then runs out of context, many LLM execution environments terminate gracefully — the step "finishes" with whatever it managed to write. The crash gate sees exit 0 and passes control downstream.

The key distinction from a crash: there IS output, and it IS valid — just incomplete. This makes the failure invisible to binary success/failure checks.

## Observed Impact
sewage-gold project, iterations 008-009:
- Iter-008: Summarize step persisted F-120–F-127 (8 of 11 findings). F-128–F-130 not persisted. Synthesize cited all 11. 3 phantom IDs.
- Iter-009: Summarize step persisted F-131–F-134 (4 of 14 findings). F-135–F-144 not persisted. Synthesize cited all 14. 10 phantom IDs.
- Worsening trajectory: 27% phantom rate → 71% phantom rate.

Both iterations had excellent research quality (Accuracy 7+, Insight 8) — the content was good, the persistence was broken.

## Prevention

1. **Completeness validation gate:** After any step that persists a list of items, count the output vs the input. If count(persisted) < count(produced), the step failed — do not pass to downstream.

2. **Manifest pattern:** The producing step writes a manifest (expected item count + IDs) before beginning persistence. The validation gate checks the store against the manifest. Missing items = step failure.

3. **Downstream pre-flight:** Before the synthesize step cites any finding ID, verify it exists in the store. This is a defense-in-depth measure — it catches the cascade even if the completeness gate is absent.

4. **Chunked persistence:** If the step might run out of context, persist items incrementally (flush after each item) rather than batching. Partial completion then preserves as much as possible rather than losing everything after the truncation point.

## Key Distinction from Other Patterns
- **Context-exhaustion:** Manifests as crashes (exit 1, empty output). Silent truncation exits 0 with partial output — a strictly harder failure to detect.
- **Upstream-crash-silent-bypass:** The upstream step crashes and downstream ignores the crash. Silent truncation is worse — the upstream step "succeeds" so there's nothing to ignore.
- **Heuristic-layer-ceiling:** Explains why persona heuristics can't fix pipeline issues. Silent truncation is the specific pipeline issue that needs fixing.

## Source
- Project: sewage-gold, iterations 008-009
- Conductor version: v004
