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

---

## EXP-013: Unified Single-Agent vs Multi-Agent Architecture (SAS vs MAS)
- **Hypothesis:** SEA's multi-agent pipeline introduces unnecessary information loss at handoff boundaries (Tran & Kiela 2026).
- **Change:** Created unified single-agent variant at `C:\Users\mtlb\code\sea-no-experts\`
- **Result:** SAS is ~3.5x more efficient per LLM call but produces 67% less domain coverage. Conductor's strategic question selection is the genuine MAS advantage — amplifies one human nudge into 8 follow-on questions vs 0 from SAS.
- **Full audit:** `docs/exp-013-sas-vs-mas-audit.md`
- **Deliverable comparison:** `docs/exp-013-deliverable-comparison.md`
- **Date:** 2026-04-09 to 2026-04-10

## EXP-014: Hybrid architecture implementation (v035)
- **Hypothesis:** Keeping conductor question selection (1 LLM call) + merging persona creation, expert loop, and integration into a single hybrid research call (1 LLM call) = 2 calls/iter instead of 4+. Should preserve the conductor's exploration breadth while capturing the SAS per-call efficiency gain.
- **Baseline:** v034 conductor: ~4+ LLM calls per iteration (select + create-persona + 1-5 expert inner iterations + integrate). Last tested on sa-logistics-neutral-exchange (20 iterations, 262 findings, 23 questions, ~30 domains).
- **Change:** Conductor v035. New `src/hybrid-agent.ts` replaces expert-factory + expert-loop + integration. Conductor.ts rewired from 4-step to 2-step. Expert-factory.ts and expert-loop.ts are dead code (not imported). Types updated with HybridResult. Full context (all findings, all questions, wiki context) provided to hybrid agent in one prompt.
- **What was kept:** Conductor question selection (assembleQuestionSelectionPrompt, all type diversity/yield decay/convergence taper rules). Post-processing (dedup, graduation, wiki, metrics). Epistemic tagging. Knowledge store. All CLAUDE.md rules.
- **What was removed:** Persona creation LLM call. Separate integration LLM call. Expert library (persona-centric). Success pattern recording (referenced ExpertConfig).
- **Verification:** Run v035 on a project and compare: findings per iteration, domain coverage, question generation, convergence rate, and total LLM calls vs v034 baseline.
- **Result:** Premature convergence confirmed. 6 iterations, 46 findings, 6 questions, 11 domains, 12 LLM calls. Conductor question selection works well (type diversity: landscape → kill-check → data-hunt × 2 → design-space → first-principles). But question generation pipeline is broken — hybrid agent resolves questions in 1 call and generates almost no follow-ons. Queue empties, completion gate triggers. v034 baselines generated 14-23 questions over 11-20 iterations on comparable projects.
- **Diagnosis:** In v034, the expert loop + integration step generated follow-on questions during integration. In v035, the hybrid agent CAN create new questions but tends not to. The conductor selects from open questions but doesn't generate new ones when the queue is thin. The conductor's strategic value (type selection) is preserved; the question GENERATION is what broke.
- **Fix applied (commit bca0bfa):**
  - (a) hybrid-agent.ts: explicit FOLLOW-ON QUESTIONS section — agent must generate 1-3 new questions from discoveries after each dispatch
  - (b) conductor-context.ts: LOW QUESTION QUEUE trigger — when <=2 open questions, conductor generates 2-3 new questions before selecting
- **Re-run result (financial-advisor-intelligence, reset from scratch):**
  - At iteration 9 (stopped mid-run): 53 findings, 19 questions (12 open), 11 domains
  - Previous run without fix: 6 iterations, 46 findings, 6 questions (0 open), 11 domains
  - Question generation fix validated: 19 questions vs 6, healthy open queue (12) vs empty
  - Resumed run was launched with `node dist/cli.js conduct financial-advisor-intelligence --cooldown 15 --max 21`
  - At manual stop after overrun: `conductorIteration` 26 / 25 dispatches, 153 findings, 35 question rows / 33 unique question IDs, 14 open, 21 resolved, 8 tagged finding domains
  - Breadth recovered relative to the broken v035 run: 33 unique questions vs 6, and question count now exceeds both v034 baselines (sa-logistics 23, sewage-gold 18)
  - Findings recovered to near sewage-gold scale (153 vs 162) but remain well below sa-logistics (262)
  - Domain coverage remains materially below the sa-logistics v034 baseline (~30 domains), so breadth was restored in question generation but not in tagged domain spread
  - Control integrity failed: the run ignored `--max 21`, continued to iteration 26 until manually stopped, and `questions.jsonl` contains duplicate IDs (`Q029`, `Q030`)
- **Additional fix (commit 4cb19ac):** Provider auto-detection — detectProvider() in types.ts checks harness environment variables (CLAUDECODE, CODEX_CLI). Subagents automatically use the same provider as the parent harness without explicit --provider flags.
- **Control bug fixes applied:** Max-stop semantics, question ID dedup, question store wipe guard added to conductor.ts/hybrid-agent.ts/knowledge.ts.
- **Clean re-run (financial-advisor-intelligence, fresh reset 2026-04-11):**
  - 21 dispatches, 138 findings (48 verified / 35%), 18 unique questions (13 resolved, 5 open), 7 domains, 0 duplicate IDs
  - Max-stop honored, no overrun, no store corruption
  - Question generation working: 18 questions vs 6 in the broken run
  - Conductor self-evolved to v037 via meta-evolution (same-type caps, exhaustion cluster detection)
- **Comparison to v034 baselines:**
  - sa-logistics (v034): 20 iters, ~80 calls, 262 findings, 23 questions, ~30 domains
  - financial-advisor (v035): 21 iters, ~42 calls, 138 findings, 18 questions, 7 domains
  - LLM calls: 42 vs ~80 (48% reduction)
  - Questions: 18 vs 23 (comparable)
  - Findings: 138 vs 262 (lower — fewer findings per call at 3.3 vs 3.3, but fewer total calls)
  - Domains: 7 vs ~30 (lower — may be problem-specific, needs more data points)
- **Assessment:** v035 hybrid is functional and stable. ~50% LLM call reduction. But critical review reveals the change was not purely positive — three things were removed simultaneously and quality metrics declined in ways that may not be attributable to compute reduction alone.

### Critical Review (2026-04-13)

**What improved:**
- LLM calls per iteration: ~4+ → 2 (48% reduction). Real compute saving.
- Findings per LLM call: identical (3.3). Persona creation was not adding per-call value.
- 5 infrastructure bugs found and fixed during validation — stress-tested the pipeline.

**What degraded:**
- Domain coverage: ~30 → 7. Even accounting for different problem domains, 4x gap is too large to dismiss.
- Verification rate: 48% → 35%. Lower cross-validation of findings.
- Total findings: 262 → 138. Fewer calls = fewer findings, but the project ends with less knowledge.
- Convergence: 100% → 85%. More exhausted/crashed dispatches.
- Required 5 bug fixes to become functional (vs 0 for v034 at equivalent maturity).

**What the persona was actually doing (not pure overhead):**
1. **Domain framing** — encoded mental models, failure modes, domain heuristics. A "freight marketplace failure specialist" reasons differently than a generic agent. v035's hybrid agent reasons generically every time.
2. **Staged investigation** — multi-stage workflow (fast-kill → deep dive → synthesis) across inner iterations. v035 does everything in one pass. Shallow for complex mechanism questions.
3. **Anti-hallucination guardrails** — domain-specific "will NOT do" lists. v035 has generic epistemic rules only.
4. **Integration as validation** — the separate integration step cross-checked findings, flagged contradictions, created exhaustion-as-finding entries. v035 skips all of this. Question generation had to be re-added explicitly; contradiction detection was never replaced.

**Methodological error:** We changed three things simultaneously (removed personas, collapsed inner iterations, removed integration) and cannot attribute the quality drop to any specific change. The experiment we documented as methodologically flawed (EXP-013 critical review: "too many variables changed at once") is exactly what we then did in production.

**The paper's blind spot applies to us too:** Tran & Kiela assume agents are doing the same task with different context windows. SEA's persona doesn't reduce context — it structures context. A focused expert with domain guardrails may produce better reasoning than a generic agent with full unstructured context. Removing the persona gave us raw efficiency but may have degraded context utilization quality.

**Honest assessment:** v035 is a valid architecture that trades depth for speed. It is NOT a strict improvement over v034. Whether the tradeoff is worth it depends on the use case: for fast survey-level research, v035 is better. For deep, high-quality investigation where domain coverage and verification rate matter, v034 may produce superior output.

### Recommended Path Forward
The safer approach would have been incremental:
1. Keep personas, keep inner iterations — just eliminate the integration LLM call (agent writes directly). Measure.
2. If that works — replace LLM-generated personas with lighter prompt templates. Measure.
3. If that works — collapse inner iterations into one call. Measure.
One variable at a time. This remains the recommended path if quality recovery is prioritized over the current v035 architecture.

- **Status:** Functional but not a strict improvement. First-principles analysis identified exactly which capabilities were lost and how to restore them without adding LLM calls back.

### First-Principles Decomposition (2026-04-13)

Eight cognitive tasks in the research pipeline. v035 preserved 4, fixed 1, lost 2, degraded 1:
- **Preserved:** strategic planning (conductor), investigation (same per-call rate), epistemic tagging, convergence judgment
- **Fixed:** question generation (after bca0bfa)
- **Lost:** domain framing (4x domain coverage drop), validation (13% verification rate drop)
- **Degraded:** synthesis depth (single-pass vs multi-iteration)

### Proposed Fix: Restore Lost Capabilities Without Adding LLM Calls

**EXP-015 (proposed): Domain framing via prompt template**
- Problem: hybrid agent is generic "research agent" every dispatch. No domain mental models, failure modes, or approach framing. This likely causes the 4x domain coverage drop.
- Fix: build a lightweight domain frame into the hybrid prompt using data already available — question type, domain keywords from existing findings, and a static template of mental models per question type. No LLM call needed; the conductor already has this information.
- Measure: domain coverage on a fresh project should approach v034 levels (~20+ domains).

**EXP-016 (proposed): Deterministic finding validation**
- Problem: new findings are written to store without cross-checking against existing findings. No contradiction detection, no duplicate-claim flagging beyond ID dedup. This likely causes the verification rate drop.
- Fix: code-level validation in post-processing — string similarity against existing claims, confidence comparison, source overlap detection. Run after each hybrid dispatch. Flag contradictions for the next conductor iteration. No LLM call needed.
- Measure: verification rate should approach v034 levels (~45%+).

Neither fix adds LLM calls. Both address the specific degradations the data revealed. If both succeed, v035 would be: 2 LLM calls/iter (same), comparable domain coverage, comparable verification rate — a genuine improvement over v034.

- **Date:** 2026-04-10 to 2026-04-13

---

## EXP-033: v038 persona rollback — deployment
- **Hypothesis:** Restoring the v034 persona pipeline will bring domain coverage and verification rate back toward v034 levels, validating the 8-task decomposition from EXP-013.
- **Change:** Rolled src/conductor.ts back to 4-call (select → create-expert → expert-loop → integrate). Preserved v035-era infra fixes (completion gate, provider auto-detect, question ID dedup, store guards, diversity gates). Kept hybrid-agent.ts as dead code.
- **Result:** Not a clean win. The expert layer produces 12.29 findings/dispatch as reported — best of all architectures. But integration-phase attrition destroys 83.7% of output: 258 findings produced, 42 persisted. Verification rate drops to 28.6% (vs v035 35%, v034 48%). Domain coverage at 10 (vs v035 7, v034 132).
- **Interpretation:** Decomposition was right about what v035 lost (domain framing, validation), but rollback is not a zero-variable operation. The integration step was silently doing curation work in v034 that v038's integration LLM now does too aggressively. Run was split across Claude Code and Codex harnesses, which is a confound.
- **Full writeup:** docs/exp-033-v038-rollback-deployment.md
- **Date:** 2026-04-13

---

## EXP-034: Infra debt sweep — prompt rules → code enforcement
- **Context:** Meta-evolution (v046+) had accumulated a growing CLAUDE.md, but prompt-level enforcement kept failing at integration. Three failure classes recurred: (1) iter-18 destroyed 224 findings via integration clobber with no recovery path; (2) design-space queue reached 3.75× dispatch cap (15 open vs 4) because integration kept creating questions of an over-represented type; (3) convergence caps (iter 12/15/18/20) and same-type cap (3rd consecutive) were violated in multiple runs despite prompt rules.
- **Hypothesis:** Deterministic code guards can preserve the LLM's strategic judgment while eliminating the failure modes prompt rules have repeatedly missed. Specifically: a pre-integration snapshot prevents catastrophic store loss; pre-dispatch selection guards catch non-open re-dispatches and 3rd-consecutive type concentration; post-integration question-store caps trim type-queue overflow and iter-boundary cap violations.
- **Changes (all shipped 2026-04-15):**
  - `src/store-snapshot.ts` — pre-integration snapshot to `projects/<name>/knowledge-snapshots/iter-NNN-pre-integration/`. Post-integration diff with ID-based removal detection. Auto-restore on critical clobber: zero-out of non-empty store, any verified finding removed, or >50% ratio loss. `STORE_CLOBBER_RESTORED` span with full diff. Wired into conductor.ts around `integrateHandoff`. 17 tests including iter-18 regression.
  - `src/selection-guards.ts` — pre-dispatch filter after `selectQuestion`. Three guards: non-open re-dispatch (swap to highest-priority open); re-dispatch type-mismatch (scoped to questions with prior metric — preserves first-dispatch type decisions); same-type cap (swap to alternative when 3rd consecutive). `SELECTION_GUARD_INTERVENED` span per intervention. 14 tests.
  - `src/question-caps.ts` — post-integration trim. Three rules: per-type queue cap (block when `open[type] > dispatchCap[type]` from `QUESTION_TYPE_DISPATCH_CAP` in types.ts); iter-boundary cap (12/15/18/20 thresholds per CLAUDE.md convergence schedule); per-dispatch cap (landscape ≤5, non-landscape ≤3). Trim policy keeps high-priority questions; drops lowest-priority first, tiebreaks by reverse file order. `QUESTION_CAP_TRIMMED` span per trim. 21 tests.
  - `src/types.ts` — added `QUESTION_TYPE_DISPATCH_CAP` + `PER_DISPATCH_NEW_QUESTION_CAP` constants; these mirror the CLAUDE.md Question Selection & Types cap column.
  - `CLAUDE.md` — moved three debt items to Closed; integrity gates now reference code enforcement.
- **Design decision — deterministic correction vs rejection:** Each guard corrects rather than rejects. The conductor keeps making progress; every intervention emits an observable span. This is a deliberate trade-off: occasional override of a legitimate LLM judgment (e.g. when a 3rd-consecutive same-type would genuinely be the right call for branch-closing) vs consistent enforcement of rules the meta-evolution added after observed failures. The verification plan addresses this trade-off empirically.
- **Design decision — what wasn't shipped:** A broader "type-mismatch on first dispatch" guard was prototyped but dropped. It required heuristic regex inference of question types, which is brittle and overrides the LLM's initial type decision (the CLAUDE.md rule is specifically about re-dispatch). Kept the guard narrow to re-dispatches where a prior metric provides the authoritative type.
- **Verification plan (not yet run):** Deploy on next jarvis-architecture or financial-advisor-intelligence run (10+ dispatches). Measure:
  1. `STORE_CLOBBER_RESTORED` event count. Zero across 10 iters = iter-18 was an outlier; >0 = we were silently losing data without this guard.
  2. `SELECTION_GUARD_INTERVENED` event distribution by rule. High `non-open-redispatch` count means the conductor was frequently picking closed questions; high `same-type-cap` means rotation rule was being ignored. Both are signal the guards are earning their keep.
  3. `QUESTION_CAP_TRIMMED` event distribution. High `type-queue-cap` = the design-space accumulation pattern is real and recurring; high `iter-boundary-new` = convergence caps weren't being respected.
  4. Per-dispatch yield (findingsAdded) and verification rate pre- vs post-sweep. If either degrades by >10% on matched projects, at least one guard is overcorrecting.
  5. Null result: if all intervention counts are near-zero, the prompt rules were being followed and the code enforcement is unnecessary overhead — pull the guards.
- **Risk flagged in session:** The type-mismatch guard (even scoped) and same-type cap have the highest false-positive risk — they override LLM strategic judgment. Priority on verification plan metric 4 for these two.
- **Result:** Pending deployment.
- **Date:** 2026-04-15

---

## EXP-035: SOURCE-URL integrity + fast-track decision
- **Context:** Cross-project audit (all 11 projects) surfaced 24 findings tagged `[SOURCE]` whose `source` field was a bare label ("sprout-social-2026"), a bundle citation ("McKinsey, Salesforce reports, Grubhub case study"), or a cross-project reference. 12 of the 24 had already auto-graduated to `verified`. Root cause: `graduateFindings` in `src/knowledge.ts` checked `source && source !== "null"` but not that it looked like a URL — the adjacent `aggregateReferences` function correctly used `startsWith("http")`, so the rule existed in one place and was missing in the other.
- **Hypothesis:** A one-line graduation-gate tightening plus a post-integration demotion (parallel to `enforceDerivationChains`) will prevent future silent graduation, and a one-shot data sweep can remediate the existing 24 without losing usable claims.
- **Changes (all shipped 2026-04-16, commit 623b6f1):**
  - `src/knowledge.ts` — `graduateFindings` requires `/^https?:\/\//` on `source` and skips findings with `needsReview` set. New `enforceSourceUrls` demotes `[SOURCE]` without a valid URL to `[UNKNOWN]`, preserves the bad source string in the claim prefix for later triage.
  - `src/conductor.ts` — wires `enforceSourceUrls` into post-integration cleanup (next to `enforceDerivationChains`) with a `SOURCE_URL_MISSING` span. Also added provider rate-limit detection in `selectQuestion`: stderr patterns for Codex usage-limit, `429 too many requests`, `quota exceeded/exhausted`, `try again at/in`, `insufficient quota` → clearer error message instead of generic "Failed to parse question selection".
  - `src/types.ts` — `Finding.needsReview?: { reason, flaggedAt }` optional field for URL-resolves-but-claim-mismatches (number disagreements, bundle mis-attributions, adjacent-topic papers).
  - `src/__tests__/knowledge.test.ts` — tests for the new graduation URL check, `enforceSourceUrls` demotion/preservation, and needsReview skip. 540 tests passing (+3 new).
- **Data sweep (scripts/fix-source-urls.mjs + scripts/flag-needs-review.mjs):**
  - 21 findings got real URLs via web search (Sprout Social, Buffer, Pew, Reuters, Edelman, WARC, Braze, EPA, SAIMM, Nature, MDPI, PMC).
  - 3 demoted to `[UNKNOWN]` (no valid URL exists): ALM Corp synthesis bundle, internal HERALD arch reference, Reuters URL that contradicts its claim.
  - 4 flagged `needsReview`: F041 (Buffer 47% vs public 73.6%), F140 (Braze URL but finding bundles McKinsey+Salesforce+Grubhub), F1045 (EPA URL but disposal percentages don't match 2022 data), F912 (PMC paper is adjacent-topic).
- **Design decision — fast-track graduation NOT revived:** CLAUDE.md previously listed a (never-shipped) "SOURCE fast-track: ≥0.90 confidence → 2-dispatch aging instead of 3" as MEDIUM debt. Removed from open debt list during this pass. Reasons: (1) benefit is ~1 dispatch sooner appearance in wiki/references — no project has shown verification lag as a blocker; (2) the 0.90 threshold is an LLM-produced value and LLMs don't calibrate confidence to 2 decimals, so a fast-track cliff at 0.90 creates implicit pressure to round up; (3) adding a looser graduation path immediately after tightening the URL-required gate sends inconsistent signals about how cautious this layer should be. Revive with evidence if a project ever shows `provisional` durability lag on clean-URL high-confidence findings.
- **Design decision — why `enforceSourceUrls` demotes rather than rejects writes:** `appendFinding` has no schema validation and experts write findings.jsonl directly via file I/O, bypassing the Node helper. A write-time rejector wouldn't catch the LLM-produced cases the audit surfaced. Post-integration demotion to `[UNKNOWN]` preserves the claim text (so the finding can be re-sourced later) while ensuring the trust cascade doesn't treat it as verified. Parallel to how `enforceDerivationChains` handles `[DERIVED]` without a chain.
- **Verification plan (to measure over the next 10 dispatches on any project using Codex/Claude):**
  1. `SOURCE_URL_MISSING` span count. >0 means experts are still producing bare-label `[SOURCE]` findings — expected but now self-correcting; consistently high counts (>2/iter) would signal the integration prompt needs tightening too.
  2. Verification-rate trajectory on projects with existing clean-URL `[SOURCE]` findings. Should be unchanged — we did not alter graduation thresholds, only added a URL format check that previously-graduating findings already satisfied.
  3. Rate-limit detection: expect zero false positives on healthy runs. If legitimate parse failures now get mislabeled as rate-limits, the stderr regex is too loose.
  4. `needsReview` flag: counts stay near-zero unless a future audit discovers more content-mismatch cases. If flag count grows, the URL-applied sweep missed a class of error.
- **Result:** Shipped. All 4 affected projects now audit-clean on SOURCE integrity (herald-research, sewage-gold, total-value-recovery, x-marketing-agent). 21 of 24 repaired with real URLs; 3 demoted; 4 flagged for content review. `total-value-recovery` retains a separate 3-orphaned-wiki-files audit issue, unrelated.
- **Date:** 2026-04-16
