---
description: Pipeline step details for SEA agent execution
globs: projects/**
---

# Pipeline Execution Detail

## PLAN step
1. Context triage — list specific data points needed. Read ONLY those sections.
2. Read persona.md for strategies and scope boundaries
3. Query knowledge/summary.md for verified findings and open questions
4. Write research plan to scratch/iter-{N}-plan.md:
   - 3-4 specific questions to answer (prioritized)
   - 5-10 search queries to execute
   - Section headings for the output skeleton
   - Which prior findings to build on (cite finding IDs)
   - Which open questions to target (cite question IDs)
5. Write minimal skeleton to scratch/iter-{N}-skeleton.md (<20 lines)
6. Scaffold experiments/exp-{N}.md (hypothesis + method, 5-10 lines)

## RESEARCH step
1. Execute search queries from the plan
2. For EACH finding: claim + epistemic tag + data points + source URL
3. Append sources to references/links.md
4. Do NOT synthesize — raw tagged findings only
5. Flag contradictions with prior findings explicitly
6. Use [UNKNOWN] for gaps — never guess

## SYNTHESIZE step
1. Build report from findings + skeleton + knowledge summary
2. Carry forward epistemic tags from findings
3. New claims get: [DERIVED: synthesis] or [ESTIMATED: basis]
4. Anchor every comparison (baseline, magnitude, conditions)
5. IMMEDIATELY after deliverable: complete exp log + trace
6. Do NOT do web searches

## EVALUATE step
Independent critic framing — does not see persona or goal.
1. Score each dimension 1-10 (weights in CLAUDE.md)
2. Check claim tags: present? accurate? linked to references?
3. Flag unanchored comparisons
4. Check information gain (new findings, resolved questions)
5. Write scores as JSON block at end of reflection

## Crash Recovery
After two consecutive crashes (exit code 1, empty output):
- Zero prior-file loading — persona encodes all lessons
- Single research question — not 3-4
- Incremental trace logging
- If still crashes → infrastructure issue, not agent behavior
