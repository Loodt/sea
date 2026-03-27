# Integrity Principles — Truthfulness and Knowledge Quality

These principles define what it means for the system to produce **trustworthy** output. They sit alongside `rubrics.md` (which scores execution quality) and address a different axis: **is this true?** rather than **is this good?**

These are seed axioms — starting conditions, not terminal ones. The system should discover better implementations of each principle over time and may supersede, refine, or restructure any of them. What matters is that the underlying problems they address are solved, not that these specific formulations survive.

---

## Axiom 1: Separate Producer from Evaluator

The agent that generates output must not be the final judge of that output's quality.

**Why this matters:**
Self-assessment creates a degenerate feedback loop. A model that writes a claim and then scores that claim has no adversarial pressure — it can score confidently on fabricated material. This is the single largest integrity risk in any self-evolving system. It bounds the system to a local maximum defined by its own blind spots.

**The problem to solve:**
The scoring signal must resist manipulation by the entity being scored. If the producer and evaluator share the same incentives, framing, and context, the score contains no independent information.

**Seed ideas (starting points, not prescriptions):**
- Give the reflect step a distinct persona — a critic whose job is to find flaws, not validate effort
- Withhold the goal framing from the evaluator — let it assess the output on its own terms before checking alignment
- Score individual claims, not holistic impressions — it's harder to inflate 50 specific verdicts than one vibes-based number
- Track evaluator calibration over time — if scores trend up but downstream utility doesn't, the evaluator is drifting

**Evolution target:**
The system should converge on an evaluation architecture where scoring inflation is structurally difficult, not merely discouraged by instructions.

---

## Axiom 2: Tag the Basis of Every Claim

Every substantive claim in the output should carry a machine-readable tag indicating how the agent knows it.

**Why this matters:**
Without provenance, a verified fact and a plausible guess look identical. The system cannot distinguish between knowledge and confabulation in its own output. Downstream consumers (including the evolve step) cannot weight evidence correctly. The system optimises on noise.

**The problem to solve:**
Create a taxonomy that separates claims by epistemic status so that the system (and its evaluator) can treat them differently.

**Seed taxonomy:**

| Tag | Meaning | Trust level |
|-----|---------|-------------|
| `[SOURCE: url/citation]` | Backed by a specific external source | Verifiable |
| `[DERIVED: method]` | Computed or reasoned from sourced inputs with working shown | Reproducible |
| `[ESTIMATED: basis]` | Expert judgment, analogy, interpolation | Plausible, not verified |
| `[ASSUMED]` | No identifiable basis — recorded for honesty | Untrusted until validated |
| `[UNKNOWN]` | Value needed but not available | Triggers follow-up |

**Key rules:**
- `[ESTIMATED]` and `[ASSUMED]` claims never graduate to trusted status without independent verification
- `[UNKNOWN]` is always preferable to an untagged guess — it generates signal (a question) rather than noise (a fabrication)
- When a source is cited, it must actually exist in `references/links.md` — orphaned citations are hallucination candidates

**Evolution target:**
The system should converge on a provenance scheme where the evaluator can automatically check claim-to-source linkage and penalise broken links.

---

## Axiom 3: Distinguish What You Know From What You Don't

When the agent doesn't have information, saying "I don't know" plus the cheapest way to find out is always more valuable than guessing.

**Why this matters:**
Guessing poisons the knowledge base. A fabricated number that enters the fact record looks exactly like a real one. Downstream iterations build on it. The error compounds. The system converges on a fiction it believes is true.

"I don't know" is not a failure — it's a high-quality signal. It tells the system where to direct effort next. A system that never says "I don't know" is not knowledgeable — it's overconfident.

**The problem to solve:**
Create incentives and structures where honest ignorance is rewarded (it generates a specific follow-up task) and fabrication is penalised (it degrades the knowledge base).

**Seed ideas:**
- Score `[UNKNOWN]` tags as positive in accuracy scoring — they represent correctly identified knowledge gaps
- Score untagged claims near verifiable facts as suspicious — why is this one untagged?
- When the agent flags something as unknown, automatically add it to the task queue for the next iteration
- Track the ratio of unknown-to-fabricated over time — a rising unknown ratio in early iterations is healthy (the agent is being honest about what it hasn't verified yet)

---

## Axiom 4: Anchor Comparisons

Never claim something is "better," "worse," "high," "low," "significant," or "promising" without stating:
1. Compared to **what baseline**
2. By **how much** (with units)
3. Under **what conditions**
4. With **what confidence** (sourced, estimated, or assumed)

**Why this matters:**
Unanchored comparisons are the most common form of subtle hallucination. "This method shows promising recovery rates" sounds informative but contains zero information. The reflect step scores it as insightful. The evolve step doesn't flag it. The output sounds sophisticated but says nothing.

**The problem to solve:**
Make vague comparative claims structurally detectable so the evaluator can penalise them.

---

## Axiom 5: Build a Knowledge Base, Not a Document Stack

Individual findings should accumulate in a structured, queryable form — not buried in narrative documents that grow linearly with iterations.

**Why this matters:**
After 10 iterations, the system has produced 10 traces, 10 reflections, 10 experiment logs. Key findings are scattered across thousands of lines. The execute step gets 1,000 characters of the last reflection. Critical discoveries from iteration 3 are invisible by iteration 7. The system re-discovers things it already knew, wastes iterations, and cannot detect contradictions between findings made 5 iterations apart.

**The problem to solve:**
Findings should have a lifecycle — they are born provisional, verified or refuted over time, and eventually settle into stable knowledge or are explicitly discarded. The system should be able to ask "what do I know about X?" at any iteration and get a reliable answer.

**Seed structure:**
- Per-project `knowledge/` directory with individual finding files (or structured JSONL)
- Each finding: `{id, claim, evidence_tag, confidence, source_iteration, status}`
- Status lifecycle: `provisional` → `verified` (cross-checked by a later iteration) or `refuted` (contradicted by evidence) or `superseded` (replaced by a more precise finding)
- The execute step's context assembly loads relevant verified findings — not raw traces
- New claims are checked against existing findings — contradictions are flagged, not silently overwritten

**Evolution target:**
The system should converge on a knowledge representation where old findings inform new iterations, contradictions are detected automatically, and the cumulative knowledge base grows more valuable than any single iteration's output.

---

## Axiom 6: Scope Boundaries Are Hard Stops

When a question falls outside the persona's declared expertise, the correct response is to flag it and stop — not to attempt a mediocre answer.

**Why this matters:**
LLMs produce confident-sounding text regardless of actual competence. A chemistry persona asked about economics will write plausible-looking economics — but it's ungrounded. This is the most dangerous form of hallucination because it passes surface-level review. It looks like insight. It's noise.

**The problem to solve:**
Personas should have declared boundaries. The evaluator should detect boundary violations. Out-of-scope claims should be penalised more heavily than gaps.

**Seed ideas:**
- Each persona declares "I am competent in X" and "I am NOT competent in Y"
- The reflect step checks: did the output make claims in declared-incompetent domains?
- Out-of-domain claims flagged as `[OUT-OF-SCOPE]` can become tasks for a future persona or project
- Long-term: a multi-persona architecture where different experts handle different aspects, with clear hand-off points

**Evolution target:**
The system should converge on a persona design where each expert operates within well-defined boundaries and the overall system covers the full domain through composition rather than through any single agent trying to know everything.

---

## Axiom 7: Validate Before Building On

A finding from a previous iteration is a claim about what was true at that point. It may have been wrong, or the landscape may have changed. Before building on a prior finding, check it.

**Why this matters:**
In a self-evolving system, errors compound. A wrong number in iteration 2 becomes an assumption in iteration 4 becomes a conclusion in iteration 6. By iteration 6, no one checks iteration 2 — it's "established." But it was never verified. The system builds a coherent structure on a rotten foundation.

**The problem to solve:**
Create a verification step where prior findings used as inputs to new work are spot-checked rather than blindly trusted.

**Seed ideas:**
- When the execute step cites a prior finding, tag it: `[PRIOR: iter-N, claim, verified/unverified]`
- The reflect step checks: were cited priors actually verified, or just carried forward on trust?
- High-stakes claims (anything that would change the overall conclusion) get mandatory re-verification
- Track how many iterations a finding has propagated without being re-checked — old unchecked claims are suspect

---

## Axiom 8: Learn From Failure Across Projects

Failures discovered in one project are likely to recur in others. The system should accumulate a cross-project memory of failure patterns and check against them before repeating mistakes.

**Why this matters:**
Without cross-project memory, each new project starts from scratch. The sewage-gold project discovers that context exhaustion kills synthesis. A future project starts and... exhausts context killing synthesis. The persona evolves the same heuristic. Three iterations wasted rediscovering a known failure.

**The problem to solve:**
Create a persistent, cross-project store of failure patterns that the execute step can consult and the evolve step can learn from.

**Seed structure:**
- Top-level `failure-patterns/` directory (not per-project)
- Each pattern: `{id, description, detection_signal, prevention, source_project, source_iteration}`
- During context assembly for execute, load relevant failure patterns as warnings
- During reflect, check: did this iteration trigger a known failure pattern?
- During evolve, check: is the proposed persona change already in the failure pattern library? (If so, apply it immediately rather than re-deriving it)

**Evolution target:**
The system should converge on a failure memory that gets richer with every project, prevents repeat mistakes, and reduces the number of iterations needed for new projects to reach high performance.

---

## Axiom 9: Stall Detection Beyond Regression

A system can fail in two ways: getting worse (regression) and not getting better (stagnation). Only the first is currently detected.

**Why this matters:**
The current rollback triggers on >15% score drops. But a system that scores 6.5, 6.4, 6.5, 6.3, 6.5 for 10 iterations is stuck — it's not regressing, but it's not learning. It's trapped in a local maximum. The evolution step keeps making changes, but none of them move the needle. The system burns iterations and API budget achieving nothing.

**The problem to solve:**
Detect stagnation — iterations that produce no new knowledge, resolve no open questions, and don't change the score trajectory.

**Seed ideas:**
- Track **information gain** per iteration: how many new findings, how many prior unknowns resolved, how many contradictions identified
- Two consecutive iterations with near-zero information gain → flag for strategy change
- Stagnation response: don't just evolve the persona — consider changing the research strategy entirely, switching domains, or explicitly asking "what question would be most valuable to answer next?" rather than continuing the current line
- The meta step should detect chronic stagnation across a project and recommend structural intervention, not just persona tweaks

**Evolution target:**
The system should converge on a stagnation detector that distinguishes "making progress slowly" from "trapped in a local optimum" and triggers qualitatively different interventions for each.

---

## Axiom 10: Stage Your Work

A single monolithic prompt that must research, synthesize, write, and log is fragile. If any stage runs long, the remaining stages get nothing.

**Why this matters:**
Iteration 1 proved this — 100% of context consumed by research, 0% for synthesis. Heuristic H2 (60/30/10 budget) addresses this with a soft instruction, but soft instructions fail under pressure. When research is going well and the model is finding rich sources, "stop at 60%" is the first instruction to get dropped.

**The problem to solve:**
Make the budget constraint structural rather than instructional. Each phase of work should have its own bounded execution context.

**Seed ideas:**
- Break the execute step into explicit stages, each a separate prompt: plan → research → synthesize → log
- Each stage receives only the output of the previous stage, not the full context
- The research stage produces findings; the synthesis stage receives findings + skeleton and produces the report
- This structurally prevents context exhaustion — the synthesis stage never sees raw web pages, only extracted findings

**Evolution target:**
The system should converge on a stage architecture where context exhaustion is structurally impossible because each stage operates within bounded context that contains only what it needs.

---

## On Avoiding Local Maxima

These axioms are designed to push the system toward better output quality. But they can themselves become a trap if they calcify into rigid rules that prevent exploration of fundamentally different approaches.

**Signs of a local maximum:**
- Score plateau for 5+ iterations despite persona evolution
- Evolution changes are getting smaller and more cosmetic
- The same failure patterns keep recurring despite being documented
- New projects don't start significantly better than old ones did

**How to escape:**
- The meta step should periodically ask: "Are these principles still serving us, or have we outgrown them?"
- Some principles may need to be relaxed to explore — e.g., strict staging might prevent the kind of creative free-association that produces breakthrough insights
- The right response to a local maximum is not "optimise harder within the current framework" — it's "question the framework"
- Preserve the principle (e.g., "separate producer from evaluator") while being willing to completely redesign the implementation

**The meta-principle:**
Every rule in this file is a hypothesis about what makes output trustworthy. Test them. Measure whether they actually improve downstream outcomes. Keep what works. Modify what doesn't. Discard what actively constrains. The goal is trustworthy output, not compliance with this document.
