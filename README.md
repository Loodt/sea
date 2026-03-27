# SEA - Self-Evolving Agent

A self-improving research & synthesis agent that evolves its own playbook, expert personas, and tools through execution feedback. No human labels needed — the system learns from its own traces.

SEA synthesizes five frontier approaches into one architecture:

| Paper | What SEA takes from it |
|-------|----------------------|
| **ACE** (Stanford/SambaNova) | Evolving playbook via Generator + Reflector + Curator |
| **HyperAgents** (Meta AI) | Self-referential meta-agent that modifies its own improvement logic |
| **Bilevel Autoresearch** | Outer meta-loop that injects new code mechanisms at runtime |
| **Pattern Language** | Reusable skills repository extracted from successful runs |
| **TurboQuant** (Google) | Context efficiency for long-running meta-reasoning |

## How it works

```
Terminal
  sea loop <project>              thin CLI, no LLM, runs forever
        |
        |-- claude -p "EXECUTE..."     fresh 200k context
        |   reads persona.md            researches, fetches sources
        |   writes trace + experiment    saves all references
        |
        |-- claude -p "REFLECT..."     fresh 200k context
        |   scores output               extracts patterns
        |   writes reflection            identifies what worked and WHY
        |
        |-- claude -p "EVOLVE..."      fresh 200k context
        |   reads reflections            proposes persona improvement
        |   snapshots old version        applies surgical change
        |
        |-- (every ~5 iters) META      fresh 200k context
        |   reads cross-project data     updates the conductor itself
        |
        '-- repeat until goal met
```

Each step spawns a **fresh Claude Code session** via `claude -p`, so the loop runs indefinitely without context pressure. The TypeScript CLI just manages files and the loop — all intelligence lives in the Claude sessions.

### Two-speed evolution

| Layer | File | Evolves | Purpose |
|-------|------|---------|---------|
| **Conductor** | `CLAUDE.md` | Every ~5 iterations | Orchestration protocols, meta-strategies |
| **Expert Persona** | `projects/{name}/persona.md` | Every iteration | Domain expertise, heuristics, strategies |

The conductor learns meta-lessons slowly across projects. The expert persona adapts rapidly to each project's domain.

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command available)

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
  references/          all sources (links, PDFs, notes)
  experiments/         what was tried + results + WHY analysis
  traces/              raw execution logs
  reflections/         scored evaluations per iteration
  metrics/             score history (JSONL)
  lineage/             what changed, why, before/after scores
  output/              final deliverables
```

### Run the loop

```bash
npx tsx src/cli.ts loop my-research
```

Walk away. SEA will:

1. Research your goal using web search, web fetch, and file tools
2. Score its own output on accuracy, coverage, coherence, and insight quality
3. Evolve the expert persona based on what worked and what didn't
4. Every ~5 iterations, update the conductor itself
5. Auto-rollback if performance regresses

### Other commands

```bash
sea status [project]              # show current state and scores
sea history <project>             # evolution timeline with scores
sea run <project>                 # single iteration (execute + reflect + evolve)
sea rollback <project> [version]  # restore persona to earlier version
sea rollback conductor [version]  # restore conductor to earlier version
```

Replace `sea` with `npx tsx src/cli.ts` until you build and link globally.

## Architecture

```
sea/
  CLAUDE.md                    THE CONDUCTOR - evolving playbook
  conductor-history/           every version of CLAUDE.md ever
  projects/
    {name}/
      goal.md                  problem statement
      persona.md               expert persona (evolves every iteration)
      persona-history/         every version of persona.md
      references/              links, PDFs, notes
      experiments/             hypothesis + method + result + WHY
      traces/                  raw session output
      reflections/             scored analysis
      metrics/scores.jsonl     score trajectory
      lineage/changes.jsonl    what changed and why
      output/                  deliverables
  skills/                      cross-project reusable patterns
  tools/                       bilevel-injected TypeScript tools
  eval/rubrics.md              scoring rubrics
  eval/integrity.md            truthfulness principles (evolvable)
  src/                         TypeScript CLI (thin orchestrator)
```

### Design principles

- **Never delete anything.** Every mutation snapshots the old file to `*-history/`. Full audit trail for post-op analysis.
- **Explainability is mandatory.** If you can't explain HOW you found an answer, the answer means nothing. Experiment logs require WHY analysis. Lineage records require reasoning.
- **Safety through structure.** Versioning, snapshots, A/B gates, regression checks — not human confirmation prompts.
- **Projects are self-contained.** Everything needed to audit a project lives in one folder.
- **.md files for everything.** Human-readable, git-diffable, Claude-native.

### Scoring rubrics

Each iteration is scored on four dimensions (1-10):

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Accuracy | 0.30 | Factual correctness, proper sourcing |
| Coverage | 0.25 | Breadth of relevant topics addressed |
| Coherence | 0.20 | Logical flow, structure, readability |
| Insight Quality | 0.25 | Novel connections, depth, actionability |

Scores are tracked in `metrics/scores.jsonl`. If the rolling average drops >15%, the persona auto-rollbacks to the previous version.

## Running with Claude Code

SEA is built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Every step in the loop (EXECUTE, REFLECT, EVOLVE, META) spawns a fresh `claude -p` session with its own 200k context window. The TypeScript CLI orchestrates files and the loop — all research, scoring, and evolution happens inside Claude sessions.

### Prerequisites

- Claude Code CLI installed and authenticated — `claude --version` should work in your terminal
- The repo includes `.claude/settings.local.json` with `bypassPermissions` enabled, so spawned sessions run in full-auto mode (web search, file writes, etc. without prompts)

### The simplest way to start

Open Claude Code in the `sea/` directory and tell it what you want to research:

```
cd sea
claude
```

Then describe your project and tell Claude to create and run it:

```
Create a project called "lithium-recycling" with the goal below, then run
sea loop for as many iterations as it takes. Use npx tsx src/cli.ts to run
commands.

Goal:
Find technically viable methods for recovering lithium from spent EV
batteries at >90% recovery rate. Compare hydrometallurgical vs
pyrometallurgical vs direct recycling routes. Produce a comparison
matrix with recovery efficiency, cost per kg Li recovered, environmental
impact, and technology readiness level for each method.
```

Claude Code will run `sea new` interactively, then start the loop. You can walk away — each iteration runs autonomously, evolves the persona, and writes everything to files.

### Running manually

If you prefer to drive each step yourself:

```bash
# Create the project (interactive discovery questions)
npx tsx src/cli.ts new lithium-recycling

# Run a single iteration to test
npx tsx src/cli.ts run lithium-recycling

# Run the continuous loop
npx tsx src/cli.ts loop lithium-recycling
```

Loop options:

| Flag | Default | Purpose |
|------|---------|---------|
| `--cooldown <seconds>` | 30 | Pause between iterations |
| `--max <n>` | unlimited | Stop after N iterations |
| `--meta-every <n>` | 5 | Conductor evolution frequency |

### What happens during the loop

Each iteration spawns 3 fresh Claude sessions in sequence:

1. **EXECUTE** — reads persona + goal, researches via web search/fetch, writes output + experiment log + trace
2. **REFLECT** — reads the execution trace, scores it on 4 dimensions (accuracy, coverage, coherence, insight), writes reflection
3. **EVOLVE** — reads last 3 reflections, identifies highest-leverage improvement, snapshots old persona, writes updated persona

Every ~5 iterations, a **META** step reads lineage across all projects and updates the conductor (`CLAUDE.md`) itself.

If scores regress >15% from the rolling average, the persona auto-rollbacks to the previous version.

### Monitoring a running project

```bash
# Current state, scores, and trend
npx tsx src/cli.ts status lithium-recycling

# Full evolution timeline with score matrix
npx tsx src/cli.ts history lithium-recycling
```

Or read the files directly:

| What you want to know | Where to look |
|----------------------|---------------|
| What did the last iteration produce? | `output/` |
| What worked and what didn't? | `experiments/exp-NNN.md` |
| How was it scored and why? | `reflections/iter-NNN.md` |
| How is the persona evolving? | `persona.md` (current) or `persona-history/` (all versions) |
| What changed and why? | `lineage/changes.jsonl` |
| Score trajectory | `metrics/scores.jsonl` |

### Stopping, resuming, and rolling back

- **Stop:** `Ctrl+C` — finishes the current iteration gracefully, then exits
- **Resume:** Run `sea loop` again — all state is in files, it picks up where it left off
- **Single step:** `sea run <project>` — one iteration at a time for closer observation
- **Rollback persona:** `sea rollback <project> [version]` — restore an earlier persona version
- **Rollback conductor:** `sea rollback conductor [version]` — restore an earlier conductor version

## Roadmap

- [x] **Wave 1**: Scaffold + CLI + runner + context assembly
- [x] **Wave 2**: Live reflection + scoring pipeline
- [x] **Wave 3**: Evolution + never-delete versioning
- [x] **Wave 4**: Continuous loop + regression rollback
- [x] **Wave 5**: Meta-evolution (conductor self-improvement)
- [ ] **Wave 6**: Skills repository (cross-project patterns)
- [ ] **Wave 7**: Bilevel code injection (runtime tool generation)
- [ ] **Wave 8**: Context efficiency (trace summarization, skill filtering)

## Research foundation

This project synthesizes ideas from:

- **ACE: Agentic Context Engineering** — Turn static prompts into a living playbook updated via execution feedback. Small models beat expensive agents on benchmarks.
- **HyperAgents** (Meta AI) — Self-referential multi-agent system where the Meta Agent edits code, prompts, tools, and its own improvement logic.
- **Bilevel Autoresearch** (arXiv 2603.23420) — Inner research loop + outer meta-loop that reads inner code, spots bottlenecks, and injects new Python mechanisms at runtime. 5x performance jump on pretraining benchmarks.
- **Pattern Language for Skills-Based Agentic AI** — Extract reusable, observable patterns from real runs into a skills repository.
- **TurboQuant** (Google) — KV-cache compression delivering 6-8x memory/speed gains for long-context meta-reasoning.

## License

MIT
