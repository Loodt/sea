# EXP-017: Meta-Evolution 005 — Conductor v037 → v038

## Objective
Consolidate playbook under budget pressure (121 > 120 threshold), add evidence-based data-hunt fatigue rule, tighten verification floor.

## Analysis Scope
- 10 projects, 136+ conductor dispatches, 1,593 findings, 84 questions
- All conductor-metrics.jsonl, questions.jsonl, findings.jsonl across projects
- 11 failure patterns, 40+ success patterns in expert library
- 5 infrastructure debt items verified against source code

## Key Evidence

### 1. Data-hunt exhaustion dominance
- **7 of 8 exhaustion events (87.5%) are data-hunt type**
- Projects with 2+ data-hunt exhaustions: sa-self-activating-geopolymers, total-value-recovery
- Remaining open data-hunts in these projects trend toward same fate
- Root cause: factual data saturates before reasoning types are dispatched

### 2. Reasoning type starvation
- **Only 3/136 dispatches (2.7%) are reasoning types** (first-principles + design-space)
- Infrastructure debt #1 confirmed: `conductor-context.ts` uses `iter >6/>5`, playbook says `≥4`
- Code threshold delays reasoning diversity gate by 2-3 iterations per project
- This is a CODE fix, not a playbook fix — annotated in debt item

### 3. Verification floor timing
- Current rule triggers at 10+ dispatches with verified/total <35%
- Evidence shows projects hitting 8 dispatches with verified/total <25%
- Tightened to 8+ dispatches, <30% threshold

### 4. Duplicate rules identified
- "Compounding signal" (line 16) and "Convergence taper" (line 20): both trigger on store maturity → boost synthesis
- "Design-space generation" (line 22) duplicates design-space table row (line 32)

### 5. Knowledge store health
- Epistemic tag distribution: 53% SOURCE, 41.5% DERIVED, 3.8% ESTIMATED, 0.5% UNKNOWN
- Tag discipline is strong — only total-value-recovery has 10% untagged (localized)
- 5 projects completed, 2 active, 3 partially complete

### 6. Infrastructure debt audit (ALL 5 STILL OPEN)
| Item | Code status | Severity |
|------|-----------|----------|
| Dispatch thresholds | OPEN — code uses >6/>5, needs ≥4 | CRITICAL |
| Question state injection | PARTIAL — empirical-gate type exists, no auto-gating | Medium |
| Early-exit rule | OPEN — no code implementation | High |
| Observability logging | PARTIAL — convergence signals exist, no named events | Medium |
| Lineage code enforcement | OPEN — LLM-dependent, no code write/validate | High |

## Changes Made

### New rule: Data-hunt fatigue
```
≥2 data-hunt exhaustions in a project → deprioritize remaining open data-hunts;
rotate to synthesis/reasoning to extract value from existing store.
```
**Hypothesis:** Prevents 3rd+ data-hunt exhaustion by rotating budget to reasoning types earlier.
**Measurement:** Track data-hunt exhaustion count in projects with this rule active vs. historical.
**Rollback trigger:** If reasoning dispatches produce <3 findings/dispatch (i.e., rotating away from data-hunt yields nothing better), revert.

### Consolidations (net -8 lines, 121 → 113)
| Change | Lines saved |
|--------|-------------|
| "Compounding signal" + "Convergence taper" → "Store maturity signal" | -1 |
| Remove duplicate "Design-space generation" | -1 |
| Merge adaptation floor into Expert Pacing | -1 |
| Merge crash-score exclusion into crash gate | -1 |
| Merge score persistence into summarize completeness | -1 |
| Merge 3 Hard Rules pairs (tags, store writes, reasoning findings) | -3 |
| **Total consolidation** | **-8** |
| Add "Data-hunt fatigue" rule | +1 |
| **Net change** | **-7 lines** |

### Refinements
- Verification floor: 10+ dispatches → 8+ dispatches (earlier intervention)
- Debt item #1: Annotated with "2.7% reasoning dispatches across 136 runs" evidence

## Success Criteria
1. **Zero 3rd+ data-hunt exhaustion** in a project where data-hunt fatigue rule is active
2. **Reasoning dispatch rate >5%** in new projects reaching iter 4+ (requires code fix for debt #1)
3. **Verification floor trigger** catches projects at 8 dispatches instead of silently reaching 10
4. **Line count** stays ≤120 for next meta-evolution cycle

## Priority Code Fixes (not playbook changes)
These are the top infrastructure debt items to fix before next meta-evolution:
1. `src/conductor-context.ts:202-205` — Change `conductorIteration > 6` to `>= 4` and `> 5` to `>= 4`
2. `src/conductor.ts` or `src/knowledge.ts` — Implement data-gap cascade auto-gating
3. `src/loop.ts` — Add code-enforced lineage writes after evolve step
