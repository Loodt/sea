# SEA Experiments Log

Tracks code changes and conductor runs as testable hypotheses. Each entry records baseline, change, and observed outcome.

---

## EXP-001: Success pattern filename slash bug
- **Hypothesis:** Expert types containing `/` (e.g., "thiourea/thiosulfate") create invalid directory paths in success-patterns/
- **Baseline:** sewage-gold D6 (first run) crashed at `recordSuccessPattern` with ENOENT — slash interpreted as directory separator
- **Change:** `conductor.ts:571` — `.replace(/\s+/g, "-")` → `.replace(/[^a-z0-9]+/gi, "-")` to strip all non-alphanumeric chars
- **Verification:** Re-run conductor; success pattern files should write without crash
- **Result:** Fixed. sewage-gold D6 (second run) + D7-D9 all wrote success patterns correctly. 9 total success pattern files.
- **Date:** 2026-03-31

## EXP-002: sewage-gold conductor run (D1-D10)
- **Hypothesis:** Full conductor loop produces useful research output across 10 dispatches
- **Baseline:** Fresh project, 5 seed questions, 0 findings
- **Observations:**
  - 60% first-iteration crash rate (6/10 dispatches hit 600s timeout on iter 1)
  - Iter 1 prompts: 30-40KB. Iter 2+ prompts: 2.1-2.5KB
  - Expert library reuse triggered 3x (D8, D9, D10) — adapted experts converge in 2 iters vs 4.5 from scratch
  - Summary.md grew to 4.2KB (2x the 2KB limit), no enforcement
  - findingsAdded metric = 0 for productive dispatches D1 (48 findings written by expert) and D7 (28 findings)
  - Meta-evolution: D6 (v013→v014, -43% line count), D8 (v014→v015, added summary gate)
  - Final: 162 findings (48 verified), 9/18 resolved, 8 open. 3/4 goal criteria MET
- **Date:** 2026-03-30 to 2026-03-31

## EXP-003: total-value-recovery conductor run (D1-D5)
- **Hypothesis:** Conductor generalizes to a second project domain
- **Baseline:** Fresh project, 5 seed questions
- **Observations:**
  - 5/5 seed questions answered, 89 findings, 83% convergence rate
  - First-iteration timeout pattern confirmed (Q001, Q005 both timed out on iter 1)
  - Q005 crashed on infra timeout, retried next iteration successfully
  - 13.7 findings/dispatch avg, 20 min/dispatch avg
  - Finding count misalignment: Q002 spans report 0 findings but dispatch reports 33 total
  - Question selection: Q005 (medium) dispatched before Q004 (high) — ranking not strictly enforced
- **Date:** 2026-03-31

## EXP-004: Code + run data audit
- **Hypothesis:** Systematic audit reveals infrastructure gaps not visible in normal operation
- **Observations:**
  - All 7 original infrastructure debt items remain unfixed
  - JSONL race condition in knowledge.ts:41 (read-append-write without file locking)
  - Library matching score unbounded — overlap not normalized, composite can exceed [0,1]
  - 10+ silent failure points (safeRead swallows errors, JSONL parsing skips malformed lines)
  - Pruning mode divide-by-zero already guarded (audit was incorrect on this point)
  - Research step correctly writes to scratch/, not findings.jsonl (audit was incorrect on this point)
- **Date:** 2026-03-31

---

## EXP-005: Iter 1 prompt reduction (P0)
- **Hypothesis:** Replacing inline persona with file reference + extracted critical sections reduces iter 1 prompt from 30-40KB to ~5-6KB, eliminating 600s timeouts
- **Baseline:** 60% first-iteration crash rate (6/10 in sewage-gold, 2/5 in total-value-recovery)
- **Change:** _pending_
- **Verification:** Run 3 conductor iterations, check if iter 1 completes without timeout
- **Result:** _pending_
- **Date:** _pending_

## EXP-006: Summary.md size enforcement (P1)
- **Hypothesis:** Code-level enforcement keeps summary.md <= 2KB, preventing context budget creep
- **Baseline:** sewage-gold summary.md grew to 4.2KB with no enforcement
- **Change:** _pending_
- **Verification:** After integration, check summary.md byte size
- **Result:** _pending_
- **Date:** _pending_

## EXP-007: In-conductor crash retry (P2a)
- **Hypothesis:** Retrying within the same conductor iteration saves a full iteration on infra crashes
- **Baseline:** D3→D4 (sewage-gold) and Q005 (total-value-recovery) required next conductor iteration to retry
- **Change:** _pending_
- **Verification:** If a crash occurs, should see RETRY in output followed by fresh expert attempt
- **Result:** _pending_
- **Date:** _pending_

## EXP-008: Expert library adaptation lineage (P2b)
- **Hypothesis:** Tracking parent persona hash enables tracing which expert lineages are most productive
- **Baseline:** All library entries have dispatches=1, no connection between adapted and parent entries
- **Change:** _pending_
- **Verification:** After adaptation, library entry should have `adaptedFrom` field pointing to parent hash
- **Result:** _pending_
- **Date:** _pending_

## EXP-009: Library matching score normalization (P2c)
- **Hypothesis:** Normalizing keyword overlap to [0,1] prevents score inflation and improves expert matching
- **Baseline:** Raw overlap count (can be 5+) makes composite = overlap*0.4 + normalized*0.6 exceed 1.0
- **Change:** _pending_
- **Verification:** All composite scores in [0,1] range
- **Result:** _pending_
- **Date:** _pending_

## EXP-010: JSONL file locking (P2d)
- **Hypothesis:** Atomic JSONL operations with file locks prevent data loss under concurrent writes
- **Baseline:** knowledge.ts:41 has read-append-write without lock; safe in single-conductor but blocks parallelization
- **Change:** _pending_
- **Verification:** Concurrent write test shows no data loss
- **Result:** _pending_
- **Date:** _pending_

## EXP-011: findingsAdded metric fix (P3a)
- **Hypothesis:** Using Math.max(fileDelta, handoffDelta) captures true finding count when expert writes directly
- **Baseline:** D1 reported findingsAdded=0 despite 48 findings; D7 reported 28 but integration found 0 new
- **Change:** _pending_
- **Verification:** Productive dispatches show non-zero findingsAdded in conductor-metrics.jsonl
- **Result:** _pending_
- **Date:** _pending_

## EXP-012: Landscape productivity metric (P3b)
- **Hypothesis:** Counting questions spawned (not just findings) as information gain for landscape dispatches prevents false hollow-answer flags
- **Baseline:** D1 landscape dispatch: "answered" but findingsAdded=0, questionsCreated=3
- **Change:** _pending_
- **Verification:** Landscape dispatches get proper IG credit and success patterns when spawning 3+ questions
- **Result:** _pending_
- **Date:** _pending_
