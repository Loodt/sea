# EXP-013: Unified Single-Agent vs Multi-Agent Architecture (SAS vs MAS)

## Paper
Tran & Kiela (2026), "Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets" (arXiv:2604.02460v1)

**Paper's claim:** Under the Data Processing Inequality, inter-agent communication introduces information bottlenecks. A single agent with full context in one continuous reasoning trajectory outperforms multiple specialized agents passing compressed messages, when the thinking-token budget is held constant.

## Hypothesis
SEA's 4-call architecture (conductor select -> expert factory -> expert loop -> integration) introduces unnecessary information loss at each handoff boundary. A unified single-agent variant -- one LLM call per iteration doing question selection, research, AND knowledge store writes -- should match or exceed quality while using dramatically fewer LLM calls.

## Setup

**Baseline:** Original SEA on `sa-logistics-neutral-exchange` -- 20 conductor iterations, ~80+ LLM calls (4+ per iteration), 262 findings (126 verified / 48%), 23 questions (21 resolved, 2 empirical-gated), 7/8 success criteria met. ~30 domain areas explored. One human intervention at iteration 14.

**Variant:** Created `C:\Users\mtlb\code\sea-no-experts\` -- a full copy of SEA with three files rewritten:
- `unified-agent.ts` (new): Single prompt providing full goal + ALL findings + ALL questions + full summary. Agent selects question, researches, writes to knowledge store, reports structured results -- all in one LLM call.
- `conductor.ts` (rewritten): Replaced 4-step pipeline with single `runUnifiedIteration()` call. Kept all post-processing (dedup, graduation, wiki, metrics, convergence detection).
- `expert-factory.ts` / `expert-loop.ts`: Not imported -- unified agent replaces both.

**Preserved from SEA:** Epistemic tagging, knowledge store (findings.jsonl, questions.jsonl, summary.md), question type taxonomy, convergence gates, finding graduation, kill-checks, deduplication, wiki generation.

**Removed:** Inter-agent message passing (select -> create -> dispatch -> integrate pipeline), persona creation LLM call, separate integration LLM call, expert library, success pattern recording.

---

## Phase 1: Autonomous Run (no intervention)

### Quantitative Results

| Metric | Original SEA (MAS) | Unified SAS | Change |
|---|---|---|---|
| Iterations to completion | 20 | 6 | **3.3x fewer** |
| LLM calls | ~80+ | 7 (incl. 1 crash retry) | **~11x fewer** |
| Total findings | 262 | 90 | -66% |
| Verified findings | 126 (48%) | 3 (3%)* | -97%* |
| SOURCE-tagged ratio | 55% | 54% | same |
| DERIVED ratio | 43% | 42% | same |
| Questions generated | 23 | 9 | -61% |
| Questions resolved | 21 | 9 | -57% |
| Convergence rate | 100% | 100% | same |
| Findings per iteration | 11.9 | 15.0 | **+26%** |
| Domain coverage | ~30 domains | 10 domains | -67% |
| Question types used | 6 types | 6 types | same |

*Low verification expected -- graduation requires age >=3 dispatches; most findings created in last 3 of only 6 iterations. Not a quality signal.

### Question type distribution

| Type | Original SEA | Unified SAS |
|---|---|---|
| kill-check | 2 | 1 |
| landscape | 3 | 1 (embedded in iter 1) |
| mechanism | 6 | 1 |
| synthesis | 5 | 1 |
| data-hunt | 3 | 2 |
| first-principles | 1 | 1 |
| design-space | 0 | 1 |

### Phase 1 Analysis

**Where the paper is right -- per-call efficiency:**
The SAS variant produces 26% more findings per LLM call. Eliminating the persona creation call (~1 call), question selection call (~1 call), and integration call (~1 call) per iteration means ~75% of LLM calls in original SEA are overhead. The single agent handles all three tasks within one reasoning trajectory with no information loss at handoff boundaries.

**Where SEA's MAS architecture adds genuine value -- exploration breadth:**
Original SEA generated 23 questions across ~30 domains; unified SAS generated 9 questions across 10 domains. The conductor's dedicated question-selection step -- with full awareness of what's been explored, type diversity enforcement, yield decay tracking, and convergence taper rules -- drives deeper and wider exploration. The single agent tends to resolve its initial question set and declare victory, missing the "long tail" of valuable secondary questions that the conductor discovers through strategic planning.

**The paper's blind spot for iterative research:**
Tran and Kiela study single-question multi-hop reasoning (FRAMES, MuSiQue). SEA is multi-question iterative research where deciding what to investigate next is a first-class reasoning task. The conductor's strategic layer -- not captured by the paper's framework -- is what drives the 2.5x question generation and 3x domain coverage advantage.

**Epistemic quality is comparable:**
Tag distribution (55/43% SOURCE/DERIVED) is nearly identical between variants. Per-finding quality appears equivalent -- the difference is entirely in volume and breadth, not in claim integrity.

---

## Exploration Timeline Comparison

The original SEA run had one human intervention. To compare fairly, we track where each system was organically before that point.

### Original SEA question waves

| Wave | Iterations | Questions | What happened |
|---|---|---|---|
| Seed | Iter 1 | Q001-Q006 | Foundational: Convoy kill-check, legal structure, market structure, matching constraints, staged architecture, governance |
| Organic wave 2 | Iter 7 | Q007-Q010 | Deeper: driver intelligence, settlement model (as feature), single-carrier value, kill-checks. Settlement first appears here as Q008. |
| Organic wave 3 | Iter 12 | Q012-Q015 | Operational: pilot term-sheets, carrier KPIs, Competition Commission pathway, pilot ops rules |
| **Human intervention** | **Iter 14** | **Q016-Q023** | **User gave one nudge: "look at Visa's model" + "is settlement the real business?" The conductor expanded that single nudge into 8 research questions: Visa four-party model (Q016), Visa evolution (Q017), competitive landscape (Q018, Q020), SA case law (Q019), neutral exchange lessons (Q021), failure barriers (Q022), implementation sequence (Q023). This wave produced the deepest insights.** |

### Unified SAS iteration log (Phase 1, autonomous)

| Iteration | Question | Type | Findings added |
|---|---|---|---|
| 1 | Q002: Convoy kill-check | kill-check | +35 |
| 2 | Q004: SA smart contract law | data-hunt | +13 |
| 3 | Q005: SWIFT/IATA/GS1 cold-start | mechanism | +9 |
| 4 | Q007: Optimal architecture (4 approaches) | design-space | +13 |
| 5 | Q006: Competition Commission pathway | data-hunt | +8 |
| 6 | Q008: Privacy frontier (first-principles) | first-principles | +6 |

Also auto-generated and resolved within these iterations: Q001 (market structure), Q003 (privacy mechanisms), Q009 (synthesis).

### Equivalence mapping

The unified SAS after 6 iterations covers roughly the same ground as original SEA through iteration 7-8:
- Market structure, Convoy post-mortem, legal/regulatory, cooperative precedent, privacy mechanisms, architecture evaluation -- all covered by both
- Settlement mentioned in both but only as a feature (original SEA Q008 at iter 7, unified SAS F957/F973)
- Neither system had Visa analogy or "settlement is the product" reframe organically
- Original SEA had 3 additional organic waves (iters 8-13) before intervention; unified SAS declared completion

**Key difference:** The original SEA's conductor kept generating new questions through iterations 7-13 (driver intelligence, single-carrier value, pilot term-sheets, carrier KPIs) -- these emerged organically from the strategic question-selection step. The unified SAS resolved its 9 questions and stopped. This is the exploration breadth gap: the conductor's strategic layer drives deeper investigation even without human prompting.

---

## Phase 2: Intervention

### What was injected

Two questions seeded into the unified SAS knowledge store at iteration 7:

- **Q010**: Visa four-party model mapping + BankAmericard to cooperative to IPO evolution as governance template (corresponds to original Q016-Q017 combined)
- **Q011**: Settlement rail as primary product vs feature -- automated POD verification makes factoring the core value proposition (corresponds to user insight that drove the original's iter 14+ reframe)

In the original, the user gave one light nudge and the conductor expanded it into 8 questions. In the unified variant, we seeded 2 pre-framed questions with context. This is a methodological difference -- we effectively did the conductor's job manually. However, the information flowing to the research agent is comparable: a directed question with knowledge store context. The test is what the agent does with it.

### Timing difference

- Original SEA: intervention at iter 14 (after 13 iterations of organic exploration)
- Unified SAS: intervention at iter 7 (after 6 iterations, immediately after Phase 1 completion)

The original had 6 additional organic iterations (8-13) between foundational work and intervention that the unified variant skipped. These produced intermediate knowledge about driver intelligence, single-carrier value, pilot structure, and carrier KPIs that the unified variant does not have.

### Phase 2 Results

| Iteration | Question | Type | Findings added | New Qs |
|---|---|---|---|---|
| 7 | Q011: Settlement as primary product | mechanism | +8 | 0 |
| 8 | Q010: Visa four-party model | mechanism | +7 | 0 |

**Completion gate triggered** -- all 11 questions resolved, 0 open.

### Phase 2 Findings

Settlement question (Q011, iter 7):
- F991: SA freight factoring market structure and costs (2-5% of invoice + 0.5-2.5% admin)
- F992: Thumeza death spiral validates settlement-first hypothesis
- F993: Global freight fintech convergence -- payments becoming the core product (5 major 2025 developments)
- F994: Exchange-automated verification vs traditional factoring cost comparison
- F995: iloli as SA's only funder focused on emerging truck/bus owner-drivers
- F996: Manual freight billing costs global industry USD 10B+ annually, 3-6% dispute rate
- F997: DERIVED -- Settlement IS the primary product: the financial gravity model (hypothesis CONFIRMED with modification)
- F998: DERIVED -- Five convergence signals that payment networks trump matching networks in freight

Visa question (Q010, iter 8):
- F999: Visa four-party model historical architecture and economics
- +6 additional findings (written to store by agent, confirmed by file delta)
- Key insight: Shipper->Cardholder, Carrier->Merchant, Shipper funder->Issuer, Carrier funder/factor->Acquirer, Exchange->VisaNet
- Visa IPO flagged as cautionary tale -- post-IPO incentive shift triggered $5.54B antitrust settlement

### Critical observation: zero follow-on questions

The original conductor expanded one human nudge into 8 research questions (Q016-Q023). The unified agent answered both intervention questions and generated **zero** follow-on questions. It declared completion immediately.

This is the same pattern as Phase 1 -- the unified agent is efficient at answering what it's asked but does not expand the research frontier. Topics the original explored after the intervention that the unified variant never reached:
- Competitive landscape (Linebooker, uAfrica, Lori Systems)
- SA case law on automated contract triggers
- TMS/telematics integration landscape
- Operational lessons from other SA neutral exchanges
- Barriers that killed freight digitization in Sub-Saharan Africa
- Critical-path implementation sequence (21 gates, 4 workstreams)

---

## Final Comparison

| Metric | Original SEA (MAS) | Unified SAS (final) |
|---|---|---|
| **Total iterations** | 20 | 8 |
| **LLM calls** | ~80+ | ~9 |
| **Total findings** | 262 | 105 |
| **Verified findings** | 126 (48%) | 17 (16%) |
| **SOURCE/DERIVED ratio** | 55%/43% | 55%/42% |
| **Questions total** | 23 | 11 |
| **Questions resolved** | 21 | 11 |
| **Empirical-gated** | 2 | 0 |
| **Domain coverage** | ~30 domains | 10 domains |
| **Findings per iteration** | 11.9 | 13.1 |
| **Findings per LLM call** | ~3.3 | ~11.7 |
| **Human intervention** | 1 nudge -> 8 questions generated | 2 seeded questions -> 0 follow-ons |
| **Compute ratio** | 1x (baseline) | **~0.11x (89% less compute)** |

---

## Conclusions

### 1. The paper is right about per-call efficiency

The unified agent produces ~3.5x more findings per LLM call (11.7 vs 3.3). The persona creation, separate question selection, and integration steps in original SEA are genuine overhead -- they consume tokens without proportional information gain. Within a single question's investigation, one agent with full context is more efficient than multiple agents passing compressed handoffs.

### 2. The paper is wrong about what matters for multi-question research

SEA's value is not in any single expert dispatch -- it's in the **strategic exploration layer** that decides what to investigate next. The conductor generated 23 questions across 30 domains; the unified agent generated 9 across 10. When given a human nudge, the conductor amplified it into 8 follow-on questions; the unified agent generated 0. The conductor's strategic planning -- type diversity enforcement, yield decay, convergence taper, domain maturity tracking -- drives investigation depth that a single agent doing everything in one call does not replicate.

### 3. The single agent's failure mode is premature convergence

In both phases, the unified agent resolved all open questions and immediately stopped. It doesn't ask "what haven't I explored yet?" -- it asks "have I answered what's in front of me?" This is the paper's SR/MW bucket from their error analysis: "SAS's chains maintain higher lexical overlap with the question" -- tighter constraint anchoring, but less exploration.

### 4. The paper doesn't account for human-in-the-loop amplification

The original SEA's multi-step architecture creates natural pause points between iterations where a human can inject direction. The conductor then amplifies that direction into a structured research agenda. The unified variant has no equivalent -- it runs start-to-finish with no strategic expansion of human insight.

### 5. Recommended architecture change

**Hybrid approach -- 2 calls per iteration instead of 4+:**
- **Call 1: Conductor** -- strategic question selection with full knowledge store awareness, type diversity enforcement, yield decay tracking. Keeps SEA's exploration breadth advantage.
- **Call 2: Unified research agent** -- receives the selected question + full context, does research + knowledge store writes in one call. Eliminates persona creation and integration overhead.

This captures ~75% of the SAS efficiency gain (eliminating 2 of 3 overhead calls) while preserving the conductor's strategic value. Expected result: ~2 LLM calls per iteration instead of ~4+, with comparable exploration breadth to original SEA.

---

---

## Critical Self-Review: What This Experiment Can and Cannot Claim

### What we can claim

**One robust finding:** The single agent stops exploring when its question queue empties. This happened twice -- after Phase 1 (9 questions resolved, stopped) and after Phase 2 (2 more resolved, stopped again, zero follow-ons). The conductor does not do this -- it actively identifies gaps in the frontier and generates new questions. This is a real behavioral difference, reproducible, and architecturally explained.

**One solid observation:** Epistemic tag ratios are nearly identical (55/43% SOURCE/DERIVED in both). The epistemic tagging discipline works equally well in both architectures. Quality per finding is comparable.

### What we cannot claim

**"SAS is 3.5x more efficient per call"** -- Misleading. We did not control token budgets, which is the paper's entire methodology. The original SEA's persona creation and integration calls are not pure waste -- the persona shapes how the expert reasons, and integration validates findings against the existing store. We eliminated those calls and counted the savings, but did not measure what was lost per-finding by removing them. A finding produced with persona guidance and integration validation may be higher quality than one produced without. We did not test that.

**"The original is better because it has more findings"** -- The original ran ~80 LLM calls. The unified ran ~9. Of course it has more findings. The paper's whole point is: compare under equal compute. We did not do that. If we had given the unified agent 80 calls worth of iterations (and somehow prevented it from declaring completion), it might have produced comparable volume.

**"The unified SAS produced deeper theoretical analysis"** -- Maybe, or maybe the persona system in the original steered experts toward practical output over theoretical. An unconstrained agent with full context and no persona defaults to theoretical derivation -- what LLMs do best. The depth difference might be a persona effect, not an architecture effect.

### Methodological problems

**Too many variables changed at once.** We removed: persona creation, context filtering, separate question selection, separate integration, expert library, success pattern recording, and inter-agent handoffs -- all simultaneously. We cannot attribute any specific result to any specific change. The recommended hybrid is a reasonable guess, but not supported by controlled evidence.

**The intervention was not equivalent.** The original received one light nudge that the conductor expanded into 8 questions. The unified received 2 pre-framed questions with extensive context. We effectively did the conductor's job for the unified agent, then noted that the unified agent did not do the conductor's job. This is partially circular. The correct approach would have been: give one light nudge to the running system and let the agent formulate its own questions -- but the unified variant has no mechanism for mid-run human input with strategic question expansion.

**The completion gate is a confound.** The unified agent's "premature convergence" may partly be an artifact of the completion gate triggering on zero open questions, not purely an inherent limitation of single-agent reasoning. If we had instructed the agent to always generate new questions before declaring completion, the exploration breadth gap might shrink. We did not test this.

**The SAS deliverable was written after reading the original.** Even though it was written strictly from the unified SAS's findings, the author's judgment of what to include and how to structure it was shaped by having already read the original's deliverable. This is subtle contamination that affects the deliverable comparison.

**The privacy disagreement is the most interesting result -- and we cannot explain it.** Two systems, same problem, same web access, opposite conclusions (architectural vs cryptographic privacy). This could be because: the persona steered the original toward Visa-topology thinking, or the unified agent's full-context reasoning naturally gravitates toward theoretical frameworks, or it is stochastic. We have n=1 for each.

### What would make this experiment rigorous

1. **Equal compute budgets** -- give both systems the same number of tokens, not the same number of iterations
2. **Single-variable changes** -- test removing personas only, removing integration only, removing question selection only, one at a time
3. **Multiple runs** -- n=1 per system is not sufficient to distinguish signal from noise
4. **Blind deliverable evaluation** -- have someone who has not seen both outputs evaluate each independently
5. **Fix the completion gate** -- force both systems to run the same number of iterations regardless of question queue state

We did none of that. This experiment generated hypotheses worth testing properly. The results are suggestive, not conclusive.

---

## Deliverables

- Original SEA final deliverable: `sea/projects/sa-logistics-neutral-exchange/output/final-deliverable-v2.md` (post-intervention, 262 findings)
- Unified SAS final deliverable: `sea-no-experts/projects/sa-logistics-neutral-exchange/output/final-deliverable.md` (105 findings)
- **Section-by-section comparison:** `docs/exp-013-deliverable-comparison.md`

Both produced from their respective knowledge stores without cross-contamination. The SAS deliverable addresses all 8 success criteria from 105 findings; the original addresses 7/8 from 262 findings (criterion 2 partially met — carrier baseline was empirical-gated).

### Deliverable comparison summary

Original SEA v2 wins on **breadth and operational detail** — competitive landscape, technology ecosystem, implementation sequence, African freight barriers, and SA exchange lessons are entirely absent from the unified SAS. This is a direct consequence of 2.5x more findings from conductor-driven exploration.

Unified SAS wins on **theoretical depth in specific areas** — first-principles privacy derivation (Myerson-Satterthwaite, information leakage quantification), "settlement is the product" strategic reframe with global convergence evidence, and Block Exemption scope limitation are genuinely novel findings absent from the original.

The two systems also reached a **real architectural disagreement**: original uses Visa-topology privacy (role-based access, no cryptography); unified SAS uses three-layer cryptographic privacy (TEE + SMPC + ZK). Both solve the same problem, differently.

Quality-per-finding is comparable. The difference is breadth, not depth-per-topic.

---

---

## Implementation: Conductor v035 (Hybrid Architecture)

Based on these findings, the hybrid architecture was implemented in SEA on 2026-04-10.

**Commit:** `Conductor v035: hybrid architecture — 2 LLM calls per iteration instead of 4+`

### What changed
- `src/hybrid-agent.ts` (new): Single research call with full context (all findings, all questions, wiki context, goal). Question-type-aware instructions (reasoning vs research). Agent writes directly to knowledge store. Parses structured report from output.
- `src/conductor.ts`: Rewired from 4-step (select → create-persona → expert-loop → integrate) to 2-step (select → hybrid-research). Removed integrateHandoff(), recordSuccessPattern(), expert library interactions. All post-processing unchanged (dedup, graduation, wiki, metrics, convergence).
- `src/types.ts`: Added HybridResult type, hybrid-research step type.
- `src/cli.ts`: Updated command descriptions.
- `CLAUDE.md`: Version bumped to v035, architecture description updated.

### What was preserved
- Conductor question selection with all strategic logic (type diversity enforcement, yield decay, convergence taper, domain maturity tracking) — this is the genuine MAS advantage identified in this experiment
- Full epistemic tagging discipline in hybrid agent prompt
- All knowledge store operations, finding graduation, deduplication
- Wiki generation, global wiki, metrics, convergence detection
- All CLAUDE.md rules still flow through conductor's selection prompt

### What was eliminated
- Persona creation LLM call (1 call/iter saved)
- Separate integration LLM call (1 call/iter saved)
- Expert library (persona-centric, no longer applicable)
- expert-factory.ts and expert-loop.ts are dead code (not imported, not deleted)

### Validation plan (EXP-014)
1. Run v035 on a fresh project
2. Compare against v034 baseline: findings/iter, domain coverage, question generation, convergence rate, total LLM calls
3. If breadth is comparable: clean up dead code
4. If breadth is worse: investigate whether hybrid agent needs explicit instructions to generate follow-on questions
5. Key risk to watch: premature convergence (the single agent's failure mode from Phase 1/Phase 2) — the conductor's question selection should prevent this, but needs verification

---

### EXP-014 validation progress

**First run (pre-fix):** 6 iterations, 46 findings, 6 questions, 12 LLM calls. Premature convergence confirmed — same pattern as EXP-013.

**Fix applied (commit bca0bfa):** Two changes:
1. hybrid-agent.ts: explicit FOLLOW-ON QUESTIONS section requiring 1-3 new questions per dispatch
2. conductor-context.ts: LOW QUESTION QUEUE trigger generating 2-3 questions when <=2 open

**Second run (post-fix, stopped at iteration 9):** 53 findings, 19 questions (12 open), 11 domains. Question generation fix validated — 19 questions vs 6, healthy open queue vs empty. Run handed off to complete to max 21 iterations.

**Additional improvement (commit 4cb19ac):** Provider auto-detection via harness environment variables. Subagents automatically match parent harness (Claude Code or Codex).

### Remaining work
1. Complete validation run and document final metrics
2. Delete dead code: expert-factory.ts, expert-loop.ts, assembleHandoffIntegrationPrompt()
3. Update CLAUDE.md sections that still reference personas and expert library
4. Consider restoring success pattern recording with a non-persona interface
5. Consider repurposing expert library for question-type/domain -> IG tracking

---

### EXP-014 final result (clean run, 2026-04-11 to 2026-04-12)

After fixing control bugs (max-stop, question ID dedup, question store wipe guard), a clean re-run completed:

| Metric | v034 baseline (sa-logistics) | v035 validated (financial-advisor) |
|---|---|---|
| Iterations | 20 | 21 |
| LLM calls | ~80+ | ~42 |
| Findings | 262 | 138 |
| Verified | 126 (48%) | 48 (35%) |
| Questions | 23 | 18 |
| Domains | ~30 | 7 |
| Duplicate IDs | 0 | 0 |
| Max-stop honored | N/A | Yes |

---

## Post-Validation Critical Review (2026-04-13)

The v035 hybrid is functional but is NOT a strict improvement over v034. We traded depth for speed, and the tradeoff needs to be stated honestly.

### What the persona system was doing that we lost

The persona was not "overhead" in the way the paper defines it. The paper's Data Processing Inequality argument assumes agents are doing the same task with different context windows. SEA's persona doesn't reduce context — it **structures** context utilization. Removing it gave raw efficiency but degraded the quality of reasoning in ways that don't show up in per-call metrics.

**1. Domain framing (lost):** A persona like "digital freight marketplace failure specialist, 14 years experience" with specific mental models and failure modes produces different reasoning than a generic "research agent." The hybrid agent reasons generically every dispatch. This likely explains the domain coverage drop (7 vs ~30).

**2. Staged investigation (lost):** The persona's multi-stage workflow (fast-kill → deep dive → synthesis) across 1-5 inner iterations allowed iterative deepening. The hybrid agent does everything in one pass. For complex mechanism questions, one pass may be shallower.

**3. Domain-specific guardrails (lost):** The persona had explicit "will NOT do" lists and "suspicious of" triggers tailored to the question domain. The hybrid agent has generic epistemic rules only.

**4. Integration as validation (lost):** The separate integration step cross-checked new findings against existing ones, flagged contradictions, created exhaustion-as-finding entries, and generated follow-on questions. We re-added question generation but never replaced contradiction detection or cross-validation.

### Methodological self-criticism

We documented in the EXP-013 critical review that the experiment was flawed because "we changed too many variables at once." We then implemented that same flawed approach in production — removing personas, inner iterations, and integration simultaneously. We cannot attribute the quality drop to any specific change.

### Honest assessment

v035 is a valid architecture for fast, survey-level research. It is not a strict improvement for deep, high-quality investigation. The ~50% compute reduction is real. The quality degradation in domain coverage (4x worse) and verification rate (48% → 35%) is also real.

### Recommended path forward

**Option A — Iterate forward from v035:** Add back domain framing (lightweight prompt template instead of LLM-generated persona) and staged investigation (instruct the hybrid agent to do multi-phase research within one call). Measure after each addition.

**Option B — Incremental from v034:** Revert to v034. Remove only the integration call (agent writes directly). Measure. Then lighter personas. Measure. Then collapse inner iterations. Measure. One variable at a time.

Option A is faster. Option B is more rigorous.

---

*Phase 1 date: 2026-04-09*
*Phase 2 date: 2026-04-10*
*Implementation date: 2026-04-10*
*Question generation fix: 2026-04-10*
*Control bug fixes: 2026-04-11*
*Clean validation: 2026-04-12*
*Critical review: 2026-04-13*
*Status: Functional but not a strict improvement. Decision pending on path forward.*
