# Contributing to SEA

Thanks for your interest in SEA. Here's how to get involved.

## Trying SEA on your own problem

The best way to contribute is to run SEA on a real problem and share what you learn.

```bash
git clone https://github.com/Loodt/sea.git
cd sea
npm install
npx tsx src/cli.ts new my-research
npx tsx src/cli.ts conduct my-research
```

If you run SEA on an interesting problem, open a Discussion in the "Show & Tell" category — we'd love to hear what worked, what didn't, and what the agent discovered.

## Reporting issues

Open an issue with:
- What you were trying to do
- What happened instead
- The relevant log output (from `traces/` or the terminal)
- Your provider (Claude Code or Codex) and model

## Contributing code

1. Fork the repo and create a branch
2. Make your changes
3. Run tests: `npm test`
4. Run type-check: `npx tsc --noEmit`
5. Open a PR with a clear description of what changed and why

### Code conventions

- TypeScript, strict mode
- All tests in `src/__tests__/` using vitest
- Keep the CLI thin — intelligence lives in LLM sessions, orchestration in TypeScript
- Every finding must carry an epistemic tag — this is architectural, not optional
- Never-delete versioning: snapshot before mutation, full audit trail

### What's welcome

- Bug fixes
- New question types (with iteration caps and scoring weight overrides)
- Provider integrations (beyond Claude Code and Codex)
- Improvements to expert persona creation
- Better convergence detection heuristics
- Documentation and examples

### What's not welcome

- Changes that break the epistemic tagging requirement
- Changes that skip the evaluate step or weaken separation between producer and evaluator
- Changes to the safety rails in CLAUDE.md (these are immutable by design)

## Architecture overview

SEA has two loops:
- **Outer loop (conductor):** selects questions, creates expert personas, dispatches research, integrates findings
- **Inner loop (expert):** plan → research → summarize → synthesize → evaluate → evolve

The TypeScript CLI (~5,500 LOC in `src/`) orchestrates files and the loop. All intelligence lives in the LLM sessions. See the README for the full architecture diagram.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
