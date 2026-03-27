# Failure Pattern: Additive Evolution Trap

## Description
Each evolution cycle adds new heuristics, pitfalls, or strategies to the persona without consolidating or removing existing ones. The persona grows monotonically until it becomes a context burden that actively causes the failures it was designed to prevent.

## Progression (observed in sewage-gold)
- Iteration 1 evolution: Added 3 heuristics (H1-H3) + 3 pitfalls (P1-P3) — persona grew
- Iteration 2 evolution: Added H4, P4, expanded strategies — persona grew
- Iteration 3 evolution: Added H5, P5, strategy-6, expanded domain — persona reached 113 lines
- Iteration 4: Persona too large to fit alongside work. Catastrophic crash (score 1.70). Evolution finally consolidated to 60 lines — but only after the damage.

## Detection Signals
- Persona line count increasing for 3+ consecutive evolutions
- New heuristics that overlap with existing ones (e.g., H5 restated aspects of H1)
- Pitfalls that merely negate their parent heuristic (e.g., P1 = "don't skip H1")
- Historical "Why" narratives that explain the origin of a rule but aren't actionable

## Prevention
1. **Size budget:** Persona max 60 lines. Enforced as a gate in Evolution Protocol step 4.
2. **Consolidation trigger:** If persona exceeds budget, merge overlapping rules, graduate pitfalls into parent rules, remove historical narratives. The lineage preserves history — the persona doesn't need to.
3. **Subtract before adding:** When proposing a new heuristic, check if it overlaps with or subsumes an existing one. Prefer merging to appending.

## Source
- Project: sewage-gold
- Iterations: 1-4 (progressive growth), 4 (catastrophic failure), 4 evolution (consolidation)
- Conductor version when discovered: v001
- Conductor version when addressed: v002
