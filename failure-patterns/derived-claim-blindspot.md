# Failure Pattern: Derived Claim Blindspot

## Symptom
Factual errors appear in [DERIVED] or [ESTIMATED] claims while [SOURCE] claims are accurate. The synthesis step applies less scrutiny to self-generated numbers than to cited ones, inverting the correct quality hierarchy.

## Example
Report stated "Au-S bond is 2.3x the energy of a C-C bond (88 kJ/mol)." Actual C-C BDE is ~345 kJ/mol. The 88 kJ/mol figure was never in any source — it was generated during synthesis and passed unchecked. The Au-S bond (209 kJ/mol) is actually weaker than C-C, inverting the comparison.

## Root Cause
[SOURCE] claims have an implicit quality gate: the cited paper was peer-reviewed. [DERIVED] claims have NO external quality gate — the agent is both author and reviewer. When synthesis generates a number by combining data, there is no sanity check against known references.

## Prevention
1. Every [DERIVED] numerical claim must include an inline sanity check: compare the number against a widely-known reference value
2. If no reference is available for sanity checking, tag as [ESTIMATED: basis, UNCHECKED] to flag it for explicit review
3. The evaluate step should apply EXTRA scrutiny to [DERIVED] and [ESTIMATED] claims, not less
4. Bond energies, physical constants, and unit conversions deserve explicit verification — these are checkable facts, not judgment calls
