# Fix-Resistant Identical Failure

## Description
The same failure mode recurs in consecutive iterations after a targeted corrective evolution, indicating the root cause diagnosis was wrong or incomplete. The fix was well-reasoned and well-executed — it just addressed the wrong cause.

## Detection Signal
Two consecutive iterations with:
- Same failure mode (e.g., crash before research)
- Same exit code
- Same stage of failure
- Despite evolution between them that directly targeted the diagnosed cause

## Prevention Strategy

### Before the first corrective evolution:
1. Record specific diagnostic evidence for the failure — not just the assumed cause. What files were loaded? What was the last successful operation? What error was thrown?
2. If no diagnostic data exists, add instrumentation BEFORE attempting the fix.

### After the first corrective evolution:
3. Verify the fix mechanism was actually engaged. If R2 says "do selective loading," confirm the trace shows selective loading happened.
4. Track whether the corrected behavior was observed even if the outcome was the same failure.

### After the second identical failure:
5. **Stop iterating on the assumed root cause.** The diagnosis is wrong.
6. Escalate to a fundamentally different approach:
   - Change execution architecture (e.g., reduce scope radically, change the iteration launch pattern)
   - Run a diagnostic iteration before attempting real work
   - Consider causes outside the usual scope (infrastructure, environment, system overhead, tool failures)
   - Audit the non-negotiable baseline overhead to see if the problem is structural

## Key Insight
Well-reasoned fixes can fail because the reasoning chain started from a wrong premise. "The agent produced nothing → context exhaustion → persona too large" may be wrong at the first arrow. Without trace evidence showing WHERE the crash occurred, every downstream diagnosis is speculation.

## Source
sewage-gold project, iterations 4-5. Persona consolidation (113→60 lines) was executed correctly but didn't resolve the crash. The root cause may be infrastructure overhead, not persona bloat.
