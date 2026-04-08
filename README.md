# SEA - Self-Evolving Agent

A self-improving research & synthesis agent that evolves its own playbook, expert personas, and tools through execution feedback. No human labels needed — the system learns from its own traces.

SEA synthesizes ideas from frontier research into one architecture:

| Source | What SEA takes from it |
|--------|----------------------|
| **ACE** (Stanford/SambaNova) | Evolving playbook via Generator + Reflector + Curator |
| **HyperAgents** (Meta AI) | Self-referential meta-agent that modifies its own improvement logic |
| **Bilevel Autoresearch** | Outer meta-loop that injects new code mechanisms at runtime |
| **Pattern Language** | Reusable skills repository extracted from successful runs |
| **TurboQuant** (Google) | Context efficiency for long-running meta-reasoning |
| **ARIS** (Auto-claude-code-research) | Cross-model adversarial review for evaluation integrity |
| **Agent Lightning** (Microsoft) | Structured spans and credit assignment across multi-turn trajectories |
| **AgentEvolver / GEA / Memento-Skills** | Novelty pressure in evolution, skill libraries with utility scores |

## How it works

SEA has two operating modes:

### Conductor mode (recommended)

The **two-loop architecture** selects questions, creates bespoke expert personas, and dispatches research autonomously.

```
Terminal
  sea conduct <project>             thin CLI, runs until goal met
        |
        |  OUTER LOOP (Conductor)
        |
        |-- LLM "SELECT..."            reads knowledge frontier
        |   picks highest-value          ranks by info gain, feasibility,
        |   open question                domain data density
        |
        |-- LLM "CREATE..."            fresh context window
        |   crafts expert persona        200-300 lines, 6-section anatomy
        |   from creation framework      the "80% investment"
        |
        |   INNER LOOP (Expert)
        |   |-- LLM "RESEARCH..."       1-5 iterations
        |   |   plan → search → synth    until convergence or exhaustion
        |   |   writes findings           epistemic tags on every claim
        |   '-- converge? loop or exit
        |
        |-- LLM "INTEGRATE..."         validates + persists
        |   merges into knowledge store  deduplicates, checks contradictions
        |   updates summary              tracks goal progress
        |
        |-- (every ~3 iters) META       evolves the conductor itself
        |
        '-- repeat until goal met
```

### Pipeline mode

The original **6-step pipeline** for single-project deep-dive iterations with self-evaluation and persona evolution.

```
Terminal
  sea loop <project>                thin CLI, runs forever
        |
        |-- PLAN      → research plan from goal + knowledge
        |-- RESEARCH   → web search, source gathering
        |-- SUMMARIZE  → persist findings to knowledge store
        |-- SYNTHESIZE → write report from knowledge
        |-- EVALUATE   → score output (uses Sonnet for Axiom 1 separation)
        |-- EVOLVE     → improve persona (3 candidates, novelty-scored)
        |
        '-- repeat, auto-rollback on regression
```

### First-principles reasoning

When a project's knowledge store is mature (≥5 verified findings in a domain), the conductor can dispatch **reasoning experts** instead of research experts. These derive novel conclusions from existing findings rather than searching the web.

Two reasoning question types:

| Type | What it does | Iter cap | Search budget |
|------|-------------|----------|---------------|
| `first-principles` | Derive from axioms + verified findings (cost models, mechanism predictions, feasibility calculations) | 3 | 1 (validation only) |
| `design-space` | Map solution space from constraints, generate ≥3 approaches with trade-off analysis | 4 | 2 (validation only) |

Reasoning experts produce `[DERIVED]` findings with a **derivation chain** — machine-readable premises, method, assumptions, and uncertainty notes:

```json
{
  "claim": "Binder cost R455/t at Mpumalanga plant",
  "tag": "DERIVED",
  "source": null,
  "derivationChain": {
    "premises": ["F255: mix ratio", "F260: transport cost", "F166: FA source"],
    "method": "estimation",
    "assumptions": ["R1.00/t-km road transport", "FA grinding R150/t"],
    "uncertaintyNote": "Grinding cost uncertain (R100-250/t range)"
  }
}
```

**Guard rails against hallucination-as-reasoning:**
- Every conclusion must trace to stated premises (derivation chain integrity)
- DERIVED findings only graduate to verified when *all* premises are themselves verified (trust cascade)
- Confidence threshold is stricter: 0.90 vs 0.85 for SOURCE findings
- Low iteration caps prevent runaway speculation (3 iterations max)
- Store prerequisites ensure reasoning starts from solid empirical ground

The conductor dispatches reasoning experts automatically when it detects questions that need derivation rather than lookup — or you can tag a question with `questionType: "first-principles"` directly.

### Two-speed evolution

| Layer | File | Evolves | Purpose |
|-------|------|---------|---------|
| **Conductor** | `CLAUDE.md` or `AGENTS.md` | Every ~3-5 iterations | Orchestration protocols, meta-strategies |
| **Expert Persona** | `projects/{name}/persona.md` | Every iteration | Domain expertise, heuristics, strategies |

The conductor learns meta-lessons slowly across projects. Expert personas adapt rapidly to each project's domain. The conductor playbook filename matches the active provider (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex).

## Recent improvements (v0.2)

Five improvements validated on sewage-gold research project (5 conductor dispatches + 2 pipeline iterations, score 4.4 → 6.7):

| # | Feature | What it does |
|---|---------|-------------|
| 1 | **Cross-model evaluate** | Evaluate step uses Sonnet (different weights) while all other steps use Opus. Axiom 1: separate producer from evaluator. |
| 2 | **Structured spans** | Every step records timing, token counts, and findings to `metrics/spans.jsonl`. Enables credit assignment analysis. |
| 3 | **Success patterns** | High-IG dispatches auto-record strategy to `success-patterns/`. Loaded into expert creation alongside failure patterns. |
| 4 | **Novelty pressure** | Evolution generates 3 candidates scored on `performance×0.7 + novelty×0.3`. Diversity budget every 5th iteration forces exploration. |
| 5 | **Expert library** | Scores and reuses high-performing personas. Adapts existing persona instead of creating from scratch when a match exists. |

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- At least one supported LLM CLI:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` command) — default
  - [OpenAI Codex CLI](https://github.com/openai/codex) (`codex` command)

### Install

```bash
git clone https://github.com/Loodt/sea.git
cd sea
npm install
```

### Create a project

```bash
npx tsx src/cli.ts new my-research
```

Answer the discovery questions (goal, success criteria, domain, source preferences, output format). SEA creates:

```
projects/my-research/
  goal.md              problem statement + acceptance criteria
  persona.md           expert persona tailored to your domain
  state.json           iteration tracker
  knowledge/           structured findings store (JSONL)
  experts/             per-dispatch expert personas
  expert-library/      persona reuse with utility scores
  references/          all sources (links, PDFs, notes)
  experiments/         what was tried + results + WHY analysis
  traces/              raw execution logs with timing
  reflections/         scored evaluations per iteration
  metrics/             scores + spans + conductor metrics (JSONL)
  lineage/             what changed, why, before/after scores
  output/              final deliverables
```

### Run with conductor (recommended)

```bash
npx tsx src/cli.ts conduct my-research
```

The conductor selects questions, creates expert personas, dispatches research, and integrates results. Walk away — it runs until your goal criteria are met.

### Run with pipeline

```bash
npx tsx src/cli.ts loop my-research
```

The pipeline runs plan → research → summarize → synthesize → evaluate → evolve in a loop. The evaluate step uses Sonnet by default (Axiom 1 separation).

### Commands

```bash
sea new <project>                    # interactive project creation
sea conduct <project>                # two-loop conductor (recommended)
sea dispatch <project>               # single conductor iteration
sea loop <project>                   # continuous pipeline loop
sea run <project>                    # single pipeline iteration
sea status [project]                 # show current state and scores
sea history <project>                # evolution timeline with scores
sea wiki <project>                   # generate/update engineering wiki from findings
sea global-wiki [project]            # promote verified findings to cross-project wiki
sea audit <project>                  # integrity audit: findings, wiki, questions, convergence
sea rollback <project> [version]     # restore persona to earlier version
sea rollback conductor [version]     # restore conductor to earlier version

# Use a different provider
sea --provider codex conduct <project>
SEA_PROVIDER=codex sea conduct <project>
```

Replace `sea` with `npx tsx src/cli.ts` until you build and link globally.

### Key options

| Flag | Commands | Default | Purpose |
|------|----------|---------|---------|
| `--provider <name>` | all | claude | LLM backend: `claude` or `codex` |
| `-c, --cooldown <seconds>` | conduct, loop | 30 | Pause between iterations |
| `-m, --max <n>` | conduct, loop | unlimited | Stop after N iterations |
| `-e, --expert-max <n>` | conduct, dispatch | 5 | Max expert inner iterations |
| `--meta-every <n>` | conduct, loop | 3 / 5 | Conductor/meta evolution frequency |
| `--evaluate-model <model>` | run, loop, conduct, dispatch | sonnet | Model for evaluate step (Axiom 1) |

## Architecture

```
sea/
  CLAUDE.md / AGENTS.md        THE CONDUCTOR - evolving playbook (provider-dependent)
  conductor-history/           every version of the conductor playbook
  failure-patterns/            cross-project failure library
  success-patterns/            cross-project success library (gitignored — domain-specific)
  eval/
    rubrics.md                 5-dimension scoring rubrics
    integrity.md               10 truthfulness axioms (evolvable)
  templates/
    expert-creation-framework.md   6-section persona anatomy
  src/                         TypeScript CLI (~5,500 LOC)
    cli.ts                     command dispatcher
    conductor.ts               outer loop orchestration
    expert-loop.ts             inner loop iteration
    expert-factory.ts          persona creation + library lookup
    expert-library.ts          persona scoring and reuse
    knowledge.ts               findings + questions JSONL store
    wiki.ts                    engineering wiki generator (per-project)
    global-wiki.ts             cross-project wiki promotion/seeding
    audit.ts                   integrity auditor (findings, wiki, questions)
    metrics.ts                 scores + spans + convergence detection
    context.ts                 prompt assembly for pipeline steps
    conductor-context.ts       prompt assembly for conductor steps
    runner.ts                  spawn LLM CLI sessions (claude/codex)
    loop.ts                    pipeline iteration flow
    safety.ts                  regression detection + rollback
    versioner.ts               snapshot/restore
    discovery.ts               interactive project setup
    integrity.ts               knowledge store validation
    pattern-filter.ts          domain/question-type filtering for patterns
    types.ts                   all interfaces + defaults
  global-wiki/                 cross-project verified findings (gitignored)
  projects/
    {name}/
      goal.md                  problem statement
      persona.md               expert persona (evolves every iteration)
      persona-history/         every version of persona.md
      knowledge/
        findings.jsonl         structured fact store with lifecycle
        questions.jsonl         open research frontier
        summary.md             compressed state (max 2KB)
      wiki/                    engineering wiki (Obsidian-compatible)
        index.md               domain-grouped finding index
        facts/                 MEASUREMENT + STANDARD nodes
        relationships/         DERIVED nodes
        decisions/             DESIGN nodes
        assumptions/           ASSUMPTION + HYPOTHESIS nodes
        manifest.json          content-hash diffing state
      experts/                 per-dispatch expert personas
      expert-library/          persona reuse library (JSONL)
      metrics/
        scores.jsonl           pipeline score trajectory
        spans.jsonl            structured timing per step
        conductor-metrics.jsonl dispatch outcomes
      lineage/changes.jsonl    evolution decisions
      traces/                  raw session output
      reflections/             scored evaluations
      output/                  deliverables + audit reports
```

### Knowledge layer

Every finding carries a lifecycle and epistemic tag:

- **Tags:** `[SOURCE]` (URL-backed), `[DERIVED]` (computed/reasoned), `[ESTIMATED]` (judgment), `[ASSUMED]` (untrusted), `[UNKNOWN]` (honest gap)
- **Lifecycle:** provisional → verified or refuted/superseded
  - SOURCE graduation: confidence ≥ 0.85, URL present, age ≥ 3 dispatches, not contradicted
  - DERIVED graduation: confidence ≥ 0.90, derivation chain present with ≥ 2 verified premises, age ≥ 3 dispatches (trust cascade)
- **Questions:** open → resolved (by finding ID), deferred, or empirical-gate (needs physical measurement)

### Scoring rubrics

Pipeline iterations are scored on five dimensions (1-10):

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Accuracy | 0.25 | Factual correctness, proper sourcing |
| Coverage | 0.20 | Breadth of relevant topics addressed |
| Coherence | 0.15 | Logical flow, structure, readability |
| Insight Quality | 0.20 | Novel connections, depth, actionability |
| Process Compliance | 0.20 | Artifacts, epistemic tags, references |

For reasoning types (first-principles, design-space), Insight Quality increases to 0.30 and Coverage drops to 0.10 — depth of derivation matters more than breadth.

If the rolling 3-iteration average drops >15%, the persona auto-rollbacks to the previous version.

### Design principles

- **Never delete anything.** Every mutation snapshots the old file. Full audit trail.
- **Persona is strategy.** 80% of research quality comes from expert persona fit. The creation framework is the core investment.
- **Exhaustion is knowledge.** When a question exhausts, the negative result becomes a structured finding documenting what was searched.
- **Structure over rules.** Constraints are architectural (iteration caps, separate scoring model, staged workflow) not instructional.
- **Kill fast, invest slow.** Question types have iteration caps (synthesis: 2, first-principles: 3, design-space: 4, others: 5) to prevent wasted iterations.
- **Think, don't just search.** When the knowledge store is rich enough, reasoning experts derive novel conclusions from verified findings instead of dispatching more web searchers.
- **Learn bidirectionally.** Both failure patterns AND success patterns feed into expert creation.
- **Knowledge compounds.** Verified findings promote to a global wiki that seeds new projects.

## Running SEA

SEA spawns LLM CLI sessions for each step — every session gets a fresh context window. The TypeScript CLI orchestrates files and the loop; all intelligence lives in the LLM sessions.

### Supported providers

| Provider | CLI | Conductor playbook | Example |
|----------|-----|-------------------|---------|
| **Claude Code** (default) | `claude -p` | `CLAUDE.md` | `sea conduct my-project` |
| **OpenAI Codex** | `codex exec` | `AGENTS.md` | `sea --provider codex conduct my-project` |

When switching providers on an existing project, the conductor playbook is read from whichever file exists (falls back across providers). The first meta-evolution step writes the playbook to the new provider's native filename.

### The simplest way to start

Open Claude Code (or Codex) in the `sea/` directory:

```
cd sea
claude         # or: codex
```

Then:

```
Create a project called "lithium-recycling" with the goal below, then run
sea conduct for 5 iterations. Use npx tsx src/cli.ts to run commands.

Goal:
Find technically viable methods for recovering lithium from spent EV
batteries at >90% recovery rate. Compare hydrometallurgical vs
pyrometallurgical vs direct recycling routes.
```

The LLM will run `sea new` interactively, then start the conductor loop.

### Monitoring

```bash
npx tsx src/cli.ts status my-research    # state + scores
npx tsx src/cli.ts history my-research   # evolution timeline
```

Or read files directly:

| What you want to know | Where to look |
|----------------------|---------------|
| Current knowledge | `knowledge/summary.md` |
| All findings | `knowledge/findings.jsonl` |
| Open questions | `knowledge/questions.jsonl` |
| Browsable wiki | `wiki/index.md` (Obsidian-compatible) |
| Cross-project findings | `global-wiki/manifest.jsonl` |
| Integrity issues | `output/audit-report.md` |
| Convergence status | `output/convergence-report.md` |
| Last iteration output | `output/` |
| How it was scored | `reflections/iter-NNN.md` |
| Persona evolution | `lineage/changes.jsonl` |
| Step timing | `metrics/spans.jsonl` |

## Roadmap

- [x] **Wave 1**: Scaffold + CLI + runner + context assembly
- [x] **Wave 2**: Live reflection + scoring pipeline
- [x] **Wave 3**: Evolution + never-delete versioning
- [x] **Wave 4**: Continuous loop + regression rollback
- [x] **Wave 5**: Meta-evolution (conductor self-improvement)
- [x] **Wave 6**: Two-loop conductor/expert architecture
- [x] **Wave 7**: Cross-model evaluate, structured spans, success patterns, novelty pressure, expert library
- [x] **Wave 8**: Engineering wiki (per-project Obsidian-compatible), global wiki (cross-project promotion), audit command, convergence detection
- [x] **Wave 9**: First-principles reasoning (derivation chains, trust cascade graduation, reasoning-mode expert prompts, design-space analysis)
- [ ] **Wave 10**: Skills repository (cross-project reusable patterns)
- [ ] **Wave 11**: Bilevel code injection (runtime tool generation)
- [ ] **Wave 12**: Context efficiency (trace summarization, skill filtering)

## Research foundation

This project synthesizes ideas from:

- **ACE: Agentic Context Engineering** — Turn static prompts into a living playbook updated via execution feedback
- **HyperAgents** (Meta AI) — Self-referential multi-agent system where the Meta Agent edits its own improvement logic
- **Bilevel Autoresearch** — Inner research loop + outer meta-loop that injects new mechanisms at runtime
- **Pattern Language for Skills-Based Agentic AI** — Extract reusable patterns from real runs into a skills repository
- **TurboQuant** (Google) — KV-cache compression for long-context meta-reasoning
- **ARIS** (Auto-claude-code-research-in-sleep) — Cross-model adversarial review, markdown-native state machines
- **Agent Lightning** (Microsoft) — Structured observability spans, RL credit assignment across trajectories
- **AgentEvolver** — Self-questioning + self-attributing for autonomous improvement
- **GEA** (Group-Evolving Agents) — Performance-Novelty scoring to escape local optima
- **Memento-Skills** — Skill libraries with utility scores, Read-Execute-Reflect-Write loops
- **OpenSpace** — Auto-fix, auto-improve, and cross-agent learning

## License

MIT
