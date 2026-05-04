# operator-kill-ignored-cascade

## Symptom
Evolve-step emits `terminal-halt` (per CLAUDE.md v066: state.status=completed + ≥2 consecutive no-change-hold). The lineage records the marker, `state.haltReason='terminal-iteration-loop'` is set, and `state.haltSetAt` is populated. The conductor then **relaunches the project on the next operator tick anyway**, because nothing in the conductor select step reads `state.haltReason` before deciding whether to enter the LLM ranking.

The next iteration's evolve-step is forced to emit `terminal-halt` again — call this terminal-halt #2 — and per protocol must include the `TERMINAL_HALT_ESCALATED` marker. The conductor relaunches a third time. Terminal-halt #3 fires with `TERMINAL_HALT_CASCADED`. And so on. Each cascade iteration costs one full conductor cycle (4 LLM calls: select → create-expert → expert-loop → integrate, even though all four collapse to attestation/halt outputs of trivial length) and produces zero domain progress.

## Root cause
Prose-only halt mechanism. CLAUDE.md v066 defines `terminal-halt` as a valid evolve outcome with mandatory criteria, mandatory state mutation (`haltReason`), and mandatory operator-side response ("no further iterations on this project until external scope change"). But there is no code path in the conductor that reads `state.haltReason` or scans recent lineage for `TERMINAL_HALT` markers before launching iter-N+1. The mandate is honored by the evolve agent (correctly emits the outcome) and ignored by every other layer (selector, dispatch, operator-loop).

This is **infrastructure**, not persona, not evolve-agent behavior. Both upper layers do their jobs correctly.

## Distinction from closeout-drift
- `closeout-drift` is the upstream cause: terminal store + missing code-side completion gate → wasted iterations on a `status=active` project.
- `operator-kill-ignored-cascade` is what happens *after* `status=completed` and `haltReason=terminal-iteration-loop` are set: the system continues to relaunch despite explicit halt state. The two patterns chain: closeout-drift produces the holds that trigger terminal-halt; cascade describes what happens when terminal-halt itself is unenforced.

## Detection
- ≥2 consecutive lineage entries with `changeType: "terminal-halt"` on the same project
- `state.haltReason` set, `state.status="completed"`, `state.iteration` still incrementing
- Conductor cycle log shows full select→create-expert→expert-loop→integrate execution despite haltReason being set at a prior iteration

## Prevention
1. **Code-level haltReason enforcement** (candidate infra-debt #6, ~5 LOC per F99048): in conductor `select` step, before any LLM call, read `state.haltReason`. If non-null AND `status=completed`, exit clean with `HALT_HONORED` log entry. Companion to infra-debt #3 (completion gate) — completion gate sets the halt; haltReason reader honors it.
2. **Lineage-tail check** (alternative ~20 LOC variant from earlier proposals): scan last 2 lineage entries; if both are `terminal-halt` or `no-change-hold` with `state.status=completed`, exit clean with `CLOSEOUT_HALT` marker.
3. **Operator-loop sanity check:** any unattended loop that calls `sea conduct` repeatedly should grep the project's lineage tail for terminal-halt markers before invoking. This is a wrapper-level fix and works without conductor code changes — useful as a stopgap.

## Cross-project status
First confirmed in `total-value-recovery` iter 10-12 (2026-05-04). Cascade depth: 3 (terminal-halt → TERMINAL_HALT_ESCALATED → TERMINAL_HALT_CASCADED). All three iterations consumed full conductor cycles; all three produced zero domain findings; all three correctly identified the failure layer as harness/conductor, not persona/evolve. Iter-12 additionally confirms that an evolve-agent contract refusal (refuse-to-dispatch beyond a 5-line halt notice) is itself protocol-compliant — the persona has no remaining productive output at this state.

## Related patterns
- `closeout-drift` — upstream cause; produces the holds that trigger the first terminal-halt
- `heuristic-layer-ceiling` — same root principle: prose-layer mandates cannot enforce harness-layer behavior
- `evolution-persistence-failure` — sibling pattern where the evolve layer's intent is correct but a downstream layer drops it
