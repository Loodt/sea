# EXP-013: Deliverable Comparison — Original SEA (MAS) vs Unified SAS

## Inputs

| | Original SEA v2 | Unified SAS |
|---|---|---|
| Findings | 262 (126 verified) | 105 (17 verified) |
| Questions | 23 (21 resolved, 2 empirical-gated) | 11 (11 resolved) |
| Iterations | 20 | 8 |
| LLM calls | ~80+ | ~9 |
| Human intervention | 1 nudge at iter 14 -> 8 questions | 2 seeded questions at iter 7 -> 0 follow-ons |

---

## Section-by-Section Comparison

### 1. GOVERNANCE MODEL

**Original SEA:** NPC (Non-Profit Company) under Companies Act. Visa governance evolution mapped across 5 phases (proprietary -> franchise -> member-owned -> branded -> IPO) with compressed 3-phase NPC version. Dee Hock's 6 chaordic principles mapped to NPC Section 21 design. Explicitly kills governance tokens as incompatible with NPC structure. Volume-proportional voting with cap to prevent capture (BankservAfrica problem identified).

**Unified SAS:** Secondary cooperative under Co-operatives Act 14 of 2005. Visa four-party role mapping (shipper=cardholder, carrier=merchant, funder=issuer/acquirer, exchange=VisaNet). Dee Hock chaordic principles referenced. Visa IPO flagged as cautionary tale. Maximum single-member voting cap.

**Verdict:** Original is **deeper**. It has the 5-phase governance evolution timeline, kills governance tokens explicitly, identifies the BankservAfrica capture problem, and provides a compressed 3-phase path for the NPC. The unified SAS has the Visa mapping and chaordic principles but lacks the governance evolution detail and the NPC-vs-cooperative choice rationale.

**Notable difference:** Original chose NPC, unified chose cooperative. Both are valid but different legal structures with different implications (NPC: no distributable surplus, cooperative: member-owned with surplus distribution rules). The original explicitly considered and rejected the cooperative form because of capture risk from concentrated carrier membership. The unified SAS doesn't engage with this tradeoff.

---

### 2. DATA MODEL & PRIVACY

**Original SEA v2:** Architectural privacy (not cryptographic). Network-topology privacy modeled on Visa's four-party model — each party sees only what their role requires. Explicit table showing what each party sees/doesn't see. Rejects ZK proofs as unnecessary given architectural separation. Minimum capacity signal specified (corridor, equipment type, weight class, time window, constraint flags).

**Unified SAS:** Three-layer cryptographic privacy (TEE + SMPC + ZK proofs). First-principles derivation of minimum information set (~17-27 bits per signal). Myerson-Satterthwaite impossibility theorem applied to show theoretical limits on price privacy. Repeated interaction inference attack identified as gap. Quantifies information leakage per match (~17.4 bits worst case).

**Verdict:** Unified SAS is **deeper on theory**, original is **more practical**. The unified SAS's first-principles derivation (Myerson-Satterthwaite, Yao garbled circuits, information leakage quantification) is genuinely novel analysis that the original doesn't have. But the original's Visa-topology approach is more implementable — it solves the same problem with role-based access control instead of cryptography. The original explicitly argues against ZK proofs; the unified SAS builds the architecture around them.

**This is a real design disagreement, not a quality difference.** The two systems reached different architectural conclusions from the same problem statement.

---

### 3. MATCHING ALGORITHM

**Original SEA v2:** Constraint-satisfaction layer + optimization. Hard gates (same 5 categories). Weighted optimization with published formula: `match_score = 0.40*deadhead + 0.25*time_fit + 0.20*equipment + 0.15*reliability`. Batch-forward architecture (4-6 hour cycles, not real-time). Governance of weights (board-controlled, published).

**Unified SAS:** Hard constraints (7 categories — adds cross-border and customs bonded as separate gates). Optimization objective: minimize total empty km subject to constraints. Runs inside TEE.

**Verdict:** Original is **more complete**. It has the explicit optimization formula with weights, the batch-forward latency architecture, and the governance of weight changes. The unified SAS has the right structure but less operational detail.

---

### 4. SETTLEMENT MECHANISM

**Original SEA v2:** Exchange never takes cession, guarantees payment, or custodies funds. 7-step settlement flow specified. Dispute resolution via reserve pool. Credit insurance wraps (CGIC, Allianz Trade). Days-to-cash: 30-60 -> 2-5 days. Enforcement timing gap identified with 3 structural deceleration mechanisms (circuit breakers, escrow cooling, AFSA arbitration). Settlement is identified as "the single most important adoption driver for small carriers."

**Unified SAS:** Settlement IS the primary product (F997 — "financial gravity model"). Exchange-automated verification vs traditional factoring cost comparison. Thumeza death spiral as validation. Global freight fintech convergence (5 developments: DAT/Outgo, TriumphPay, Relay Payments). iloli identified as SA emerging trucker funder. Invoice dispute economics (USD 10B+ global cost). Five convergence signals that payment networks trump matching networks.

**Verdict:** Unified SAS is **more insightful on the strategic reframe**, original is **more detailed on the mechanism**. The unified SAS's "settlement is the product, not a feature" finding with supporting evidence (Thumeza, TriumphPay, DAT/Outgo) is a higher-level strategic insight. But the original has the actual 7-step settlement flow, the dispute resolution mechanism, the credit insurance specifics, and the enforcement timing gap mitigation. Both arrive at the same conclusion (settlement drives adoption) but from different angles — the unified SAS sees it as the core business model, the original treats it as the strongest feature.

---

### 5. COLD-START STRATEGY

**Original SEA v2:** JHB-CPT chosen (cleaner public data), but notes JHB-DBN may be better once carrier conversations begin. Visa cold-start playbook: 7 transferable mechanisms mapped, 3 non-transferable mechanisms identified. Four-stage onboarding sequence. Carrier-sourced backhaul demand as Mode 1 (no shipper participation needed at launch).

**Unified SAS:** JHB-DBN chosen (highest density). Fresno Drop as cold-start model. Five design principles from SWIFT/IATA/GS1 precedent. Four-stage onboarding. Settlement acceleration as primary adoption hook.

**Verdict:** Original is **more detailed**. The 7-transferable/3-non-transferable Visa mechanism analysis, the three-mode shipper model (carrier-sourced -> shipper opt-in -> direct), and the explicit lane selection reasoning with caveat are more actionable. Both identify settlement as the adoption driver.

**Lane disagreement:** Original chose JHB-CPT (better public data for modeling), unified chose JHB-DBN (higher density). The original acknowledges this should be revisited based on the first carrier's corridor. Different choice, both reasonable.

---

### 6. DRIVER INTELLIGENCE

**Original SEA v2:** Two-layer model (restricted evidence store + public corridor fact layer). Explicit data schema with TypeScript-style interface definition. Verification rules (corroboration > volume, time/location bounded, confidence decay). Privacy boundary (NIST re-identification risk). Feedback loop into matching.

**Unified SAS:** Three-tier capture (passive telemetry, event-triggered, incentivized reporting). Less detail on schema and verification. Mentions gamified ranking.

**Verdict:** Original is **more complete**. The data schema, verification rules, and privacy architecture are production-ready specifications. The unified SAS has the right idea but at a higher level of abstraction.

---

### 7. REGULATORY PATHWAY

**Original SEA v2:** Three-tier approach (s79A advisory -> Block Exemption -> s10 exemption). Ten-element minimum fact pattern for filing. Eight governance commitments. Eight pilot behaviors ranked by risk. ECTA deep dive: s20 electronic agents, 4 SA case law citations (Spring Forest Trading, Kgopana, Johnston v Leal, Endumeni), Van Eck & Agbeko + Sobikwa & Linington academic commentary, UK Law Commission, MSA-prevails approach, enforcement timing gap + 3 mitigations. SA neutral exchange operational lessons (Safex, ICASA, ECX, SAPP). Advisory opinion cost: ~R60K.

**Unified SAS:** Dual-track approach (Block Exemption in-scope confirmation + s10 individual exemption). Block Exemption scope analysis (road corridor provisions narrower than ports/rail — critical finding). Competition Commission Guidelines on Competitively Sensitive Information (2023) — future-looking capacity signals as risk. Aviation code-share exemption as precedent (6 occasions since 2000). ECTA coverage (s20, s11, Van Eck & Agbeko, FirstRand v Govendor). Structural design requirements for compliance. Advisory opinion: R100K-R350K.

**Verdict:** Both are **strong but different**. The original has more case law depth (4 citations vs 2), the 10-element fact pattern, the 8 governance commitments, and the SA exchange operational lessons. The unified SAS has the critical Block Exemption scope finding (road corridor is narrower than ports/rail — F979) and the competition-sensitive information guidelines analysis (future-looking data risk — F980) that the original misses. The advisory opinion cost differs significantly (R60K vs R100-350K) — the unified SAS figure may be more current.

---

### 8. COMPETITIVE LANDSCAPE

**Original SEA v2:** Four-tier competitive landscape (Linebooker, MyLoad, Apexloads, Saloodo, Bid Logistics, RFA load list, WhatsApp groups). Five differentiation thresholds. Detailed analysis of each competitor's model and the exchange's structural advantages.

**Unified SAS:** Not covered. No competitive landscape section.

**Verdict:** Original **wins by default**. The unified agent never investigated the competitive landscape — this was one of the 8 follow-on questions the original's conductor generated from the human nudge that the unified agent did not produce.

---

### 9. TECHNOLOGY ECOSYSTEM

**Original SEA v2:** Telematics "Big 5" mapped (Cartrack, MiX, Tracker/Netstar, Ctrack, Geotab) with API access status. GoMetro Bridge identified as aggregation layer. TMS landscape gap (no SA TMS has public API). Two-tier participation model (signal contributors vs settlement users). Pilot technology path (5 steps).

**Unified SAS:** TMS landscape mentioned briefly (F915 lists platforms). No integration analysis.

**Verdict:** Original is **significantly more detailed**. The telematics API audit and two-tier participation model are concrete implementation guidance that the unified SAS doesn't attempt.

---

### 10. IMPLEMENTATION SEQUENCE

**Original SEA v2:** 17 gates, 4 serial steps on critical path. Four parallel workstreams (Legal, Technical, Commercial, Operational) with dependency diagram. Timeline: 10-16 weeks to first matched load. Team: 3 FTE + 3 contracted. Monthly burn: R250-350K.

**Unified SAS:** Not covered. No implementation section.

**Verdict:** Original **wins by default**. Implementation sequencing was another conductor-generated follow-on question the unified agent didn't produce.

---

### 11. KILL-CHECKS & CONFIDENCE

**Original SEA v2:** 5 failure modes (adds FM4: incumbent litigation from ICASA precedent, FM5: stress-period defection from SAPP). Convoy non-replication checklist (5 items). African freight digitization barriers (7 categories with immunity analysis). Overall: 7.5/10 (up from 7.0 in v1). 8 component scores. 4 collapsing assumptions. Review gap resolution matrix (10 gaps tracked).

**Unified SAS:** 3 failure modes (cold-start, regulatory block, funder unwillingness). Convoy non-replication table (5 items). Overall: 7/10. 5 component scores. 4 collapsing assumptions.

**Verdict:** Original is **more thorough**. The 2 additional failure modes (incumbent litigation, stress-period defection) come from the SA neutral exchange operational lessons research. The African freight digitization barriers analysis is entirely absent from the unified SAS. The review gap resolution matrix shows systematic tracking of quality issues.

---

## Summary

| Section | Original SEA v2 | Unified SAS | Winner |
|---|---|---|---|
| Governance | 5-phase evolution, NPC, kills tokens | Cooperative, Visa mapping | Original (more detailed) |
| Privacy/Data | Visa-topology, practical | TEE/SMPC/ZK, theoretical | **Different conclusions** |
| Matching | Formula + weights + latency + governance | Hard constraints + TEE | Original |
| Settlement | 7-step flow, dispute resolution, deceleration | "Settlement IS the product" reframe | **Draw** (different strengths) |
| Cold-start | 7+3 Visa mechanisms, 3-mode shipper | Fresno Drop, SWIFT/IATA/GS1 | Original |
| Driver intelligence | Schema + verification + privacy | Three-tier capture | Original |
| Regulatory | 4 case law, 10-element fact pattern, SA exchanges | Block Exemption scope, competition guidelines | **Draw** (different findings) |
| Competitive landscape | 4-tier analysis, 5 thresholds | Not covered | Original |
| Technology ecosystem | Big 5 telematics, API audit, two-tier | Not covered | Original |
| Implementation | 17 gates, 4 workstreams, timeline, team | Not covered | Original |
| Kill-checks | 5 FMs, 7 African barriers, gap matrix | 3 FMs, Convoy table | Original |
| Confidence | 7.5/10, 8 components | 7/10, 5 components | Original |

**Sections where unified SAS produced genuinely novel analysis not in the original:**
1. First-principles privacy derivation (Myerson-Satterthwaite, information leakage quantification)
2. "Settlement is the product" strategic reframe with global convergence evidence
3. Block Exemption road corridor scope limitation (narrower than ports/rail)
4. Competition-sensitive information guidelines analysis (future-looking data risk)

**Sections entirely absent from unified SAS:**
1. Competitive landscape
2. Technology ecosystem / integration
3. Implementation sequence
4. African freight digitization barriers
5. SA neutral exchange operational lessons

---

## Bottom Line

The original SEA deliverable is a **more complete, more actionable document** — it covers more ground, goes deeper on operational detail, and includes implementation-ready specifications (team, timeline, burn rate, integration path). This is a direct consequence of having 2.5x more findings and 2x more questions to draw from.

The unified SAS deliverable is **more theoretically rigorous in specific areas** — the first-principles privacy analysis and the settlement-as-product reframe are genuine intellectual contributions that the original missed or treated superficially. It also found regulatory nuances (Block Exemption scope, competition guidelines) that the original didn't.

**The quality-per-finding is comparable.** The difference is breadth, not depth-per-topic. The unified SAS produced strong analysis on the topics it investigated but investigated fewer topics. This maps directly to the Phase 1 finding: the single agent is efficient at answering questions but doesn't expand the research frontier.

**If you could only read one:** the original. **If you want the deepest thinking on privacy and settlement:** the unified SAS adds value the original doesn't have.
