# Example: SA Freight Capacity Exchange

This is a sanitized subset of output from a real SEA project that designed a blind-neutral freight capacity exchange for South Africa's JHB-CPT and JHB-DBN corridors.

**Project stats:**
- 20 conductor iterations, 20 expert dispatches
- 262 total findings (126 verified, 136 provisional)
- 23 research questions (21 resolved, 2 empirical-gated)
- 100% convergence (all resolvable questions resolved)

**What happened:**
1. SEA autonomously autopsied Convoy's $900M failure and used it as a kill-check for every subsequent design decision
2. It evaluated four architecture approaches and killed three (data cooperative, open standards, smart contract exchange)
3. A human review at iteration 14 asked "isn't this more like Visa than SWIFT?" — the agent took that question and produced a complete cold-start playbook with seven tested mechanisms
4. The surviving architecture scored 7.5/10 confidence with four explicit testable assumptions

## What's included

- `knowledge/questions.jsonl` — All 23 research questions with types, status, and resolution references
- `knowledge/findings-sample.jsonl` — 30 representative findings (of 262) showing SOURCE, DERIVED, and kill-check findings
- `knowledge/summary.md` — The final knowledge summary
- `output/final-deliverable-v2.md` — The complete technical architecture deliverable

## What to look for

**In the questions file:** Notice how question types shift over time — early questions are kill-checks and data-hunts (iterations 1-12), then landscape and mechanism questions arrive at iteration 14 (the human review point), and the final questions are synthesis and design-space.

**In the findings:** Every finding carries an epistemic tag (SOURCE with URL, DERIVED with reasoning chain, ESTIMATED, ASSUMED, or UNKNOWN). The derivation chains on DERIVED findings show how the agent reasons from premises to conclusions — see F655 (Visa issuer gap analysis) and F740 (cold-start playbook transfer) for examples.

**In the deliverable:** The v2 deliverable resolves 10 specific review gaps identified during the human review at iteration 14. Each section traces back to finding IDs in the knowledge store.
