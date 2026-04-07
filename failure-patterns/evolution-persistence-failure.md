---
domains: [general]
question_types: [all]
---

# Evolution Persistence Failure

## Description
Evolution changes are logged in lineage (the intent is recorded) but never actually written to the target file. The persona file remains frozen at a prior version while the lineage claims multiple subsequent versions were applied. Subsequent iterations operate with an outdated persona, missing safety rules that were specifically designed to prevent recurring failures.

## Detection Signal
- Lineage shows N evolutions but file content matches an earlier version
- `state.json personaVersion` doesn't advance despite lineage entries
- persona-history snapshots are identical across multiple versions
- Protective rules cited in reflections ("the persona already says X") don't exist in the actual file
- Same failure recurs despite targeted fixes — because the fixes were never applied

## Why It Happens
The evolution agent logs the lineage entry but crashes or fails before writing the updated persona file. The versioner snapshots the current (unchanged) file, creating a new version number for identical content. The next iteration's reflection assumes the changes took effect based on the lineage, masking the persistence failure.

## Prevention Strategy
1. After writing lineage, verify the target file actually changed (diff against the snapshot)
2. Compare `state.json personaVersion` against the latest lineage entry's `versionAfter`
3. Before any evolution, read the actual persona file — don't trust lineage summaries about its current state
4. If a targeted fix didn't work, check whether the fix was actually applied before assuming the diagnosis was wrong

## Impact
sewage-gold: 3 iterations (5, 6, 7) ran with a v005 persona while lineage claimed v006. The missing R5 (crash recovery) and R2 upgrade (zero prior-file loading) left the agent without its designed safety net, directly causing the oscillating crash-recovery pattern.

## Source
sewage-gold iterations 5-7.
