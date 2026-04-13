# We deployed our "hybrid" AI agent. The numbers humbled us — twice.

*Follow-up to the April 10 article on single-agent vs multi-agent architectures. The data that came back is not the data we expected. This is what shipping and measuring actually looks like.*

---

## What I said last time

Four days ago I wrote that the practical answer to the Stanford single-agent-vs-multi-agent debate was a hybrid: one strategic conductor call to pick the question, one unified agent call to do the work. Two LLM calls per iteration instead of four. Keep the discovery power of multi-agent systems, eliminate the information loss from handoff compression.

The theoretical argument was clean. The numbers in that post — 3.5× more findings per LLM call — were real.

Then we deployed it on a real open-ended research problem: designing an architecture for capturing financial-advisor tacit knowledge before it walks out the door when advisors retire. Twenty-one research iterations. Same goal document. Same model. Direct comparison against our prior multi-agent baseline on a different-but-comparable project.

The results were not what I claimed they would be.

## What actually happened

The efficiency gain was real — 2 LLM calls per iteration instead of 4, roughly a 50% compute reduction. That part of the Stanford paper's argument held up exactly as predicted.

The quality collapse was worse than anything I wrote publicly.

**Domain coverage: 30 domains → 7 domains** (4× drop).
**Verification rate: 48% → 35%** (13 percentage-point drop).
**Total findings: 262 → 138** (47% drop).
**Convergence rate: 100% → 85%** (exhaustion and crashes went up).

The hybrid architecture ran. It produced output. It would have passed a demo. But side-by-side against the multi-agent version on the same class of problem, it was materially worse across every quality metric that matters for research output.

I had claimed the "hybrid is clearly better" position confidently. The data said something quieter: the hybrid was cheaper and worse.

## Why — the part the original post missed

When you remove the persona layer from a multi-agent research system, you're not just removing a middleman. You're removing whatever work the persona layer was doing.

I sat down with our run traces and did a first-principles decomposition of what the pipeline actually does at the cognitive level. There are eight distinct tasks, not one:

1. **Strategic planning** — what to investigate next
2. **Domain framing** — which mental models, failure modes, and heuristics apply to this specific domain
3. **Question generation** — what follow-on investigations does each finding surface
4. **Investigation** — executing the research
5. **Epistemic tagging** — [SOURCE] / [DERIVED] / [ESTIMATED] / [UNKNOWN] discipline
6. **Finding validation** — cross-checking claims against existing store, contradiction detection
7. **Convergence judgment** — is this question answered, killed, narrowed, or exhausted
8. **Integration** — merging results into the durable knowledge store

The hybrid preserved tasks 1, 3, 4, 5, 7. It fixed task 2's bookkeeping (question ID uniqueness). It *lost* tasks 2 and 6. And it degraded task 8 from a multi-pass integration to a single-pass write.

The 4× domain coverage drop tracks directly to the loss of task 2. Without a domain-framed persona, every dispatch reasons generically, pulls from generic sources, and converges on shallow breadth.

The 13-point verification-rate drop tracks directly to the loss of task 6. Without a separate validation step, new findings are written without cross-checking against what's already in the store.

The persona wasn't overhead. It was structured context utilization — the thing that the Stanford paper itself caveats but their closed-task benchmarks don't measure. Removing the persona gave us raw efficiency and cost us context quality.

## What we did about it

We rolled back. Restored the four-call pipeline. Preserved every infrastructure fix we made during hybrid validation (completion gates, provider auto-detection, question ID deduplication, store-wipe guards). Re-ran the same financial-advisor project from scratch with the restored architecture.

## And something new broke

The expert layer worked. Experts produced **12.3 findings per dispatch** — the highest yield we've ever measured across any architecture. Domain framing was active. Staged investigation ran an average of three inner iterations per dispatch instead of the hybrid's single pass. Question-type rotation stayed clean across seven distinct reasoning modes.

Then the integration step destroyed 84% of it.

Experts produced 258 findings across 21 dispatches. The final knowledge store contained 42.

The integration LLM — the fourth call in the pipeline — was not quietly merging findings into storage. It was *curating* them. Aggressively downgrading provisional findings it didn't have confidence in, dropping entries without strong derivation chains, collapsing related findings into summaries. In the v034 baseline this curation was calibrated to keep most of the expert's output. In v038 the same prompt on the same rule-set produced a much harsher filter.

Verification rate ended at 28.6% — lower than either the multi-agent baseline (48%) or the hybrid it was supposed to beat (35%).

The rollback wasn't a clean reversion. "Going back" is never really going back. The pipeline works in an environment that has drifted — model behaviour has drifted, rule-set has drifted via meta-evolution, the second harness we used for the last thirteen iterations interprets the same integration prompt differently than the first.

## The lesson I should have led with four days ago

Measure after every change. One variable at a time. Quality drops in production rarely survive post-hoc attribution.

When we shipped the hybrid, we changed three things at once — removed personas, collapsed inner iterations, removed the integration LLM call. The quality dropped. We could not attribute the drop to any specific change. We "fixed" that by rolling back all three simultaneously, which gave us a new failure mode we hadn't predicted, attached to a task we hadn't named yet.

This is what the Stanford paper could not have told us, because their benchmarks measured closed QA tasks where the answer exists and the agent's job is to find it. Open-ended research has an integration-and-curation step that is load-bearing in ways nobody writes papers about.

## The framework, for anyone building agent systems

Take your pipeline — whatever it is. List the cognitive tasks, not the calls. Here are the eight we found; your list may differ:

1. Strategic planning
2. Domain framing
3. Question generation
4. Investigation
5. Epistemic discipline
6. Validation
7. Convergence judgment
8. Integration and curation

For each task: which LLM call is doing it? If the answer is "emerges from the unified prompt," that task is not measured. If you can't measure it, you won't notice when you delete it.

We're not publishing numbers that say multi-agent wins. We're not publishing numbers that say single-agent wins. We're publishing numbers that say the architecture choice is less important than whether you know which tasks are load-bearing in your current pipeline and whether you're measuring each of them independently.

## What we're doing next

We're instrumenting the integration-phase attrition rate as a first-class metric. We're running the persona pipeline single-harness end-to-end to rule out the Claude-Code/Codex confound. We are not shipping another architectural change before we understand why the same prompt produces different curation rates under different conditions.

And I'm writing this because it matters that when public claims don't survive contact with production data, we say so — in the same place and in the same voice as the original claim.

---

**Repo (both architectures plus the rollback):** github.com/Loodt/sea
**Original article:** [link to April 10 post]
**Full data dump (EXP-033):** in the repo under `docs/exp-033-v038-rollback-deployment.md`

**If you're building agent systems, I want to know:** which of these eight tasks are you actually measuring, and which ones are you assuming the pipeline is doing? Reply with what your list looks like.
