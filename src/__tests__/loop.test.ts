import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runIteration } from "../loop.js";
import type { ProjectState } from "../types.js";

// runIteration uses process.cwd() as SEA_ROOT, so we chdir into a tmpdir
// that contains a minimal projects/<name>/state.json. The completion-gate
// should fire before any pipeline step runs.

describe("runIteration completion-gate", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-loop-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeState(projectName: string, state: ProjectState): Promise<void> {
    const projectDir = path.join(tmpDir, "projects", projectName);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "state.json"), JSON.stringify(state));
  }

  function baseState(overrides: Partial<ProjectState> = {}): ProjectState {
    return {
      name: "test",
      iteration: 1,
      status: "active",
      personaVersion: 1,
      conductorVersionAtCreation: 14,
      currentTask: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scores: [],
      ...overrides,
    };
  }

  it("halts when state.status is 'completed'", async () => {
    await writeState(
      "test",
      baseState({
        status: "completed",
        completedAt: "2026-05-04T00:00:00.000Z",
        completionReason: "All questions terminal",
      })
    );

    const result = await runIteration("test");

    expect(result.halted).toEqual({ reason: "completed" });
    expect(result.score).toBeNull();
  });

  it("halts when state.status is 'paused'", async () => {
    await writeState("test", baseState({ status: "paused" }));

    const result = await runIteration("test");

    expect(result.halted).toEqual({ reason: "paused" });
  });

  it("includes completionReason in console output when present", async () => {
    await writeState(
      "test",
      baseState({
        status: "completed",
        completionReason: "All questions terminal",
      })
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(String(msg));
    try {
      await runIteration("test");
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("All questions terminal"))).toBe(true);
  });
});
