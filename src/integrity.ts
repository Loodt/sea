import type { StepType } from "./types.js";

/**
 * Returns compact integrity axiom reminders relevant to each pipeline step.
 * These are structural constraints, not suggestions.
 * Source: eval/integrity.md (the full reasoning lives there).
 */
export function getIntegritySnippets(step: StepType): string {
  switch (step) {
    case "plan":
      return `## Integrity Constraints
- **Know your gaps (Axiom 3):** When you don't have information, say "[UNKNOWN]" + the cheapest way to find out. Never guess. [UNKNOWN] is a high-quality signal that directs the research step.
- **Stay in scope (Axiom 6):** If a question falls outside the persona's declared expertise, flag it as [OUT-OF-SCOPE] and add it to the questions list. Do not attempt a mediocre answer.
- **Validate before building on (Axiom 7):** When citing a prior finding, check its status. Provisional findings need verification, not trust.`;

    case "research":
      return `## Integrity Constraints
- **Tag every claim (Axiom 2):** Every substantive finding MUST carry a tag:
  [SOURCE: url/citation] — backed by a specific external source (verifiable)
  [DERIVED: method] — computed from sourced inputs with working shown (reproducible)
  [ESTIMATED: basis] — expert judgment, analogy, interpolation (plausible, not verified)
  [ASSUMED] — no identifiable basis (untrusted until validated)
  [UNKNOWN] — value needed but not available (triggers follow-up)
- **Prefer [UNKNOWN] over guessing (Axiom 3):** An untagged guess poisons the knowledge base. [UNKNOWN] generates a question for the next iteration.
- When citing a source, include the URL. Orphaned citations are hallucination candidates.`;

    case "synthesize":
      return `## Integrity Constraints
- **Tag every claim (Axiom 2):** Carry forward tags from research findings. New claims in the synthesis need their own tags.
- **Anchor comparisons (Axiom 4):** Never say "better," "promising," "significant," or "high" without stating: compared to WHAT baseline, by HOW MUCH (with units), under WHAT conditions, with WHAT confidence.
- **Validate before building on (Axiom 7):** When using a prior finding as an input, note whether it is verified or provisional. High-stakes conclusions built on provisional findings must be flagged.`;

    case "evaluate":
      return `## Integrity Constraints — You Are the Independent Critic
- **Separation (Axiom 1):** You are NOT the producer's advocate. Your job is to find flaws, not validate effort. Score the output on its own terms before checking alignment with the goal.
- **Check claim tags (Axiom 2):** Are claims tagged? Are tags accurate? Do [SOURCE] tags point to real entries in references/links.md? Penalize untagged claims.
- **Detect unanchored comparisons (Axiom 4):** Flag any "promising," "significant," "better" without a baseline, magnitude, and conditions. These are the most common form of subtle hallucination.
- **Stagnation check (Axiom 9):** Compare this iteration's information gain to the last 2. Near-zero new findings + zero resolved questions = stagnation. Flag it explicitly — the evolve step needs to know.
- **Process compliance:** Score whether protocol artifacts (experiment log, trace, claim tags, references) were produced. Missing artifacts mean the evolution loop flies blind.`;

    case "evolve":
      return `## Integrity Constraints
- **Build knowledge, not document stacks (Axiom 5):** The knowledge store (findings.jsonl, questions.jsonl) is the permanent artifact. If the evaluator flagged missing or incorrect findings, fix the store — don't just evolve the persona.
- **Cross-project failure patterns (Axiom 8):** Before proposing a persona change, check failure-patterns/ — don't re-derive a known fix. If you discover a new generalizable failure, write it to failure-patterns/.
- **Persona size budget:** Max 60 lines. If over budget, consolidate before adding. The lineage preserves history — the persona doesn't need to.`;

    case "summarize":
      return `## Integrity Constraints
- **Build queryable knowledge (Axiom 5):** Your job is to update the structured knowledge store, not write another document. Add new findings to findings.jsonl. Resolve or update questions in questions.jsonl. Update summary.md as a compressed view.
- **Lifecycle management:** New claims start as "provisional". Claims confirmed by multiple sources across iterations become "verified". Claims contradicted by evidence become "refuted". The summary should reflect current status, not historical order.
- **summary.md budget: max 2KB.** This is what the plan agent reads next iteration. Keep it dense and current.`;

    case "meta":
      return "";

    default:
      return "";
  }
}
