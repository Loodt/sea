# EXP-033: v038 persona rollback — deployment comparison

## Status

Deployed and measured. Outcome is not what the theory predicted. Architecture discussion continues.

## Hypothesis

Rolling back to the v034 persona pipeline (select → create-expert → expert-loop → integrate) after the v035 hybrid deployment failure (EXP-013 critical review) will restore the two cognitive tasks that first-principles decomposition identified as lost: domain framing and finding validation. Expected outcomes: domain coverage back toward v034 (~30), verification rate back toward v034 (~48%), findings store back toward v034 (~262).

## Setup

- Fresh project reset at `projects/financial-advisor-intelligence/` (goal.md copied from v035 archive; knowledge store zeroed; state.json fresh at iter 1 with `conductorVersionAtCreation: 38`).
- Run parameters: `--cooldown 15 --max 21` to match v035 dispatch count.
- Conductor v038 = v034 architecture + all v035-era infrastructure fixes preserved (completion gate for fresh projects, provider auto-detection, question ID dedup via `normalizeQuestionIds`, state-based max check, same-type cap warning, iter ≥4 diversity gates, LOW QUESTION QUEUE prompt, integration drift enforcement for `questionUpdates`).
- Run split across two harnesses: iters 1–8 on Claude Code, iters 9–21 on Codex CLI (same repo, `AGENTS.md` synced from `CLAUDE.md` before handoff so both harnesses used identical rules).
- Meta-evolution fired at iters 3, 6, 9, 12, 15, 18, 21 per `metaEveryN: 3`.

## Headline numbers

| Metric | v034 baseline (sa-logistics) | v035 hybrid | v038 rollback |
|---|---:|---:|---:|
| Dispatches | 20 | 21 | 21 |
| Crashes | 0 | 0 | 0 |
| Expert findings produced (sum `findingsAdded`) | 238 | 138 | **258** |
| Findings in final store | 262 | 138 | **42** |
| Avg findings per dispatch (as reported) | 11.9 | 6.57 | **12.29** |
| Avg findings per dispatch (as persisted) | ~13.1 | 6.57 | **2.00** |
| Verified count | 126 | 48 | 12 |
| Verification rate | 48.1% | 34.8% | **28.6%** |
| Distinct domains (findings) | 132 | 7 | 10 |
| Distinct domains (questions) | n/a | n/a | 21 |
| Total questions | 23 | 18 | 28 |
| Open / resolved / exhausted / gated / other | 0 / 21 / 0 / 2 / 0 | 5 / 13 / 0 / 0 / 0 | 6 / 17 / 0 / 0 / 5 |
| Convergence rate (answered + killed / total) | 100% | 90.5% | **71.4%** |
| Inner iterations total (avg) | — | 21 (1.0) | 64 (3.05) |

## What the numbers say

**The expert layer works again.** 12.29 findings/dispatch as reported by experts — best of the three architectures, marginally above v034. Inner iterations averaged 3.05 vs v035's 1.0 — the staged investigation capability is restored. Question-type rotation was clean across 7 types (data-hunt 7, kill-check 5, first-principles 3, landscape 2, design-space 2, synthesis 1, mechanism 1). The first-principles decomposition was vindicated: when you restore domain framing and finding validation via the persona pipeline, the expert layer produces more findings per dispatch than any prior architecture.

**Domain framing partially restored.** 10 finding-domains vs v035's 7. 21 question-domains, which is closer to v034's breadth when measured at the question level. The persona-as-structured-context argument holds.

**Integration-phase attrition is the new failure.** 258 findings produced by experts; 42 persisted. 83.7% of the expert's output does not survive the integrate LLM call. This is a different failure mode from v035 — v035 lost findings at generation time (no persona meant thinner output); v038 generates plenty but loses them at integration.

**Verification rate degraded further.** 28.6% — worse than both baselines. The integration LLM is aggressively downgrading or dropping provisional findings rather than validating them. The CLAUDE.md rule "integration MUST downgrade [DERIVED] without derivationChain to [ESTIMATED]" may be contributing — 3 of 21 DERIVED findings in the final store are missing derivationChain and escaped the downgrade anyway.

**Convergence rate dropped.** 71.4% vs v035's 90.5% and v034's 100%. 6 of 21 dispatches exhausted (5 with reason, 1 undefined — a rule violation per the `exhaustionReason` schema). This is not worse reasoning; several exhaustions were high-yield frontier-hits (Q003: 27 findings, Q008 data-hunt: 21 findings). The exhaustion-cluster rule was auto-refined at iter 6 to distinguish low-yield (<10) from high-yield (≥10) exhaustion, which is a meta-evolution the system got right.

## Assessment

v038 is not a clean win. It is a shift in failure mode.

- **v034** produced 262 findings with 48% verification by using the full 4-call pipeline with high-trust integration.
- **v035** produced 138 findings with 35% verification by collapsing the pipeline into 2 calls, losing domain framing and validation.
- **v038** restores the 4-call pipeline but the integration LLM — which was silently doing a lot of heavy lifting in v034 — is now aggressive enough to destroy 84% of the expert layer's output.

The first-principles decomposition identified 8 cognitive tasks. v035 lost 2 (domain framing, finding validation). v038 restored those 2 but exposed that task #8 (integration) was itself doing work we did not fully decompose: it isn't just merging findings into the store, it's deciding which findings belong in the store. In v034 that filter was calibrated; in v038 it is either mis-calibrated, over-aggressive, or harness-dependent (the Codex integration phase may apply different thresholds than Claude Code).

This is what measurement-after-every-change reveals: the decomposition framework was correct about what was lost, but rollback is not a zero-variable operation — other things shift too. v038 ran on two harnesses in sequence, so harness × integration-behaviour interaction is a confound we cannot rule out.

## What to do next

- **Do not claim v038 as a win.** It produces a smaller, less-verified knowledge store than v035 or v034 despite the expert layer performing best of the three.
- **Decompose integration as its own task.** The cognitive work inside integrate-handoff is not "merge" — it is "curate." That is a distinct task requiring its own measurement, its own prompt, and possibly its own rollback trigger.
- **Measure the curation rate.** `findingsAdded` (expert report) vs actual store delta is a real signal the conductor metric already captures but does not surface — the integration-phase attrition rate should become a first-class dashboard metric.
- **Run v038 single-harness.** The Claude-Code/Codex split contaminates the comparison. A pure single-harness run on a third project is the next sanity check.
- **Do not rush another architecture change.** Each deployment reveals a new failure mode. The right move is instrumentation before intervention.

## Safety Rails audit

All preserved. `.md` snapshots taken via `snapshotFile` at every meta-evolution cycle. No files deleted in `*-history/`. Lineage entries recorded each iteration. CLAUDE.md bumped from v038 → v045 during the run via meta-evolution (seven cycles at metaEveryN=3).

## Files

- `projects/financial-advisor-intelligence/` — v038 run artefacts
- `C:/Users/mtlb/code/sea-experiments/projects/financial-advisor-intelligence v35/` — v035 archive
- `projects/sa-logistics-neutral-exchange/` — v034 baseline

## Date

2026-04-13
