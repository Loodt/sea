---
domains: [general]
question_types: [all]
---

# Failure Pattern: Citation-Reference Swap

## Symptom
[SOURCE: X] citations in the report point to the wrong reference. The cited paper exists in references/links.md but its description contradicts the claim it supports. Two references may have their citations swapped, or a reference may be cited for a claim outside its actual scope.

## Example
references/links.md lists PMC 7581288 as "NHC-Au(I) ligand scrambling mechanism" and PMC 8756590 as "NHC stability on Au NPs in biological media." The report cites PMC 7581288 for the stability claim and PMC 8756590 for the scrambling barrier — exactly reversed.

## Root Cause
During synthesis, the agent composes the report from memory of findings rather than re-reading the references file. When multiple sources cover related subtopics (e.g., both are NHC-Au papers), the identifier (PMC ID, DOI) gets attached to the wrong claim. The error is especially likely when two sources have similar domains but different specific contributions.

## Prevention
1. **Citation verification gate:** After writing each [SOURCE: X] citation, cross-check that X's description in references/links.md matches the claim. If it contradicts, correct before proceeding.
2. **Scope-check on citations:** A reference cited as [SOURCE] must directly support the specific claim, not merely be from the same research area. If the paper is about sorbent design, don't cite it as authority for discharge concentration regulations.
3. **One-pass citation audit before submission:** Before the synthesize step exits, scan all [SOURCE] tags and verify each reference ID appears with a matching claim description in links.md.
