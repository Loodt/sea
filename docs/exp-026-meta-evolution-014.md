# EXP-026: Meta-Evolution 014 — v046→v047

## Trigger
Conductor iteration 3 (financial-advisor-intelligence). Scheduled meta-evolution check.

## Evidence Reviewed
6 projects: sewage-gold (10 iter), total-value-recovery (15 iter), chrome-pgm-tailings (6 iter), sa-self-activating-geopolymers (13 iter), herald-research (14 iter), financial-advisor-intelligence (2 iter).

## Cross-Project Patterns

### Confirmed improvements (v046)
- **Zero crashes in hybrid architecture**: 4 recent projects had 0 crashes. Pre-v046 projects averaged 2-3.
- **Resolution re-dispatch eliminated**: Code now enforces post-dispatch resolution writes + ID normalization with tests. The financial-advisor regression (Q016/Q014/Q018 re-dispatched after being answered) cannot recur.
- **Completion efficiency**: herald-research 14/14 resolved, sa-geopolymers 12/14. vs total-value-recovery 6/15. Hybrid single-call architecture is markedly more efficient.

### Remaining issues
- **Data-hunt dominance**: herald-research dispatched 4 consecutive data-hunts (iters 8-11, 53 findings). High yield but crowds out reasoning types. Same-type cap prompt warning now in code.
- **Reasoning types dispatch too late**: sa-geopolymers dispatched first-principles at iter 13 (should be ~5). herald-research: never dispatched either reasoning type in 14 iterations despite 176 findings. Code now warns at iter >= 4 (was >5/>6).

## Changes Made (v047)

### CLAUDE.md (122→117 lines)
1. **Removed infrastructure debt items 1+2** — resolution verification and question ID uniqueness now code-enforced (normalizeQuestionIds(), post-dispatch resolution enforcement, next-free-ID in prompts).
2. **Merged step gates** — reasoning diversity gate (redundant with type diversity + code enforcement) removed. Exhausted + answered re-dispatch blocks merged into single "Re-dispatch blocks" gate. Observations from financial-advisor moved to this doc.
3. **Added reasoning dispatch timing as debt item** — cross-project evidence shows this is the system's biggest remaining behavioral gap.
4. **Updated same-type cap and question ID gates** — noted code enforcement status.

### No code changes
v046 code changes (in working tree) already address the infrastructure needs. No additional code modifications required this cycle.

## Verification Plan
- financial-advisor-intelligence iter 3+: should see type diversity enforced (no 3+ consecutive same-type)
- Next project reaching iter 5 with >=5 verified findings: should dispatch first-principles or design-space
- Monitor for regression: answered questions re-dispatched (should be 0)

## Rollback Trigger
If composite scores drop >15% from 3-iteration rolling average after this change, revert to v046.
