# Pipeline Step Deferral

When a multi-step pipeline has a dedicated "cleanup" or "summarize" step at the end, agents consistently defer write-side-effects (knowledge store updates, artifact logging) to that final step. If the final step doesn't execute — due to context exhaustion, early termination, pipeline truncation, or simply not being called — all deferred writes are lost.

This is distinct from crash-related artifact loss: the deferral is **deliberate and explicit** ("deferred to summarize step"), not an unintended consequence of running out of context. The agent believes it's being organized by batching writes; in practice, it creates a single point of failure.

## Signature
- Trace or log contains phrases like "deferred to [later step]" or "will update in [step name]"
- Knowledge store shows zero updates despite the iteration producing substantive analysis
- Stagnation metrics report false stagnation (analytical progress occurred but wasn't recorded)
- The pattern compounds: each iteration's gains are invisible to the next, so future iterations work from stale context

## Observed Impact
In sewage-gold, this pattern persisted for 3 consecutive iterations despite a persona heuristic ("knowledge store is the deliverable") being added after the 2nd occurrence. The prescriptive framing ("do X incrementally") failed because the agent interpreted "incrementally" as "in the summarize step" rather than "in the current step." Process compliance dropped from 6 → 4 → 3 across 3 iterations.

## Prevention
1. **Each step owns its writes.** A pipeline step that produces a finding writes it to the store before exiting. No deferrals.
2. **Exit gate.** Before a step declares completion: are there claims in the output not yet in findings.jsonl? If yes, the step is not done.
3. **Separate responsibilities.** Only summary.md should be rewritten by a dedicated summarize step. All other store files (findings.jsonl, questions.jsonl, references/) are updated by the step that generates the content.
4. **Watch for the deferral signal.** If a trace says "deferred to X," treat it as a process violation, not a plan.
5. **Prohibitive framing > prescriptive framing.** "NEVER defer" is more effective than "do it incrementally" — the agent already knows what to do, it just postpones. Name the specific anti-pattern to forbid.
