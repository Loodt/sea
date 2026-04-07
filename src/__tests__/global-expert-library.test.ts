import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  promoteExpertsToGlobal,
  readGlobalExpertLibrary,
  findGlobalExperts,
} from "../global-expert-library.js";
import type { LibraryEntry } from "../types.js";

// ── Helpers ──

function makeLibraryEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    personaHash: "abc123def456",
    questionType: "landscape",
    domain: "gold recovery from wastewater",
    expertType: "hydrometallurgist specializing in precious metal recovery",
    avgIG: 12,
    dispatches: 3,
    lastUsed: "2026-04-01T00:00:00.000Z",
    personaPath: "experts/QQ001-iter-001/persona.md",
    score: 14.4,
    status: "active",
    ...overrides,
  };
}

async function setupDirs(): Promise<{
  projectDir: string;
  globalRoot: string;
  base: string;
}> {
  const base = await mkdtemp(path.join(os.tmpdir(), "sea-global-expert-test-"));
  const projectDir = path.join(base, "project");
  const globalRoot = base;
  await mkdir(path.join(projectDir, "expert-library"), { recursive: true });
  return { projectDir, globalRoot, base };
}

async function writeLibrary(
  projectDir: string,
  entries: LibraryEntry[]
): Promise<void> {
  const content =
    entries.map((e) => JSON.stringify(e)).join("\n") +
    (entries.length ? "\n" : "");
  await writeFile(
    path.join(projectDir, "expert-library", "library.jsonl"),
    content,
    "utf-8"
  );
}

// ── promoteExpertsToGlobal ──

describe("promoteExpertsToGlobal", () => {
  let projectDir: string;
  let globalRoot: string;
  let base: string;

  beforeEach(async () => {
    const dirs = await setupDirs();
    projectDir = dirs.projectDir;
    globalRoot = dirs.globalRoot;
    base = dirs.base;
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("promotes an eligible expert", async () => {
    await writeLibrary(projectDir, [makeLibraryEntry()]);
    const result = await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    expect(result.promoted).toBe(1);
    expect(result.skipped).toBe(0);

    const entries = await readGlobalExpertLibrary(globalRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].globalPersonaId).toBe("test-proj--abc123def456");
    expect(entries[0].projectName).toBe("test-proj");
    expect(entries[0].revokedAt).toBeNull();
  });

  it("skips entries below score threshold", async () => {
    await writeLibrary(projectDir, [makeLibraryEntry({ score: 1.5 })]);
    const result = await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    expect(result.promoted).toBe(0);
  });

  it("skips entries with too few dispatches", async () => {
    await writeLibrary(projectDir, [
      makeLibraryEntry({ dispatches: 1, score: 5.0 }),
    ]);
    const result = await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    expect(result.promoted).toBe(0);
  });

  it("skips retired entries", async () => {
    await writeLibrary(projectDir, [
      makeLibraryEntry({ status: "retired" }),
    ]);
    const result = await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    expect(result.promoted).toBe(0);
  });

  it("deduplicates by project + hash", async () => {
    await writeLibrary(projectDir, [makeLibraryEntry()]);
    await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);
    const result = await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);

    const entries = await readGlobalExpertLibrary(globalRoot);
    expect(entries).toHaveLength(1);
  });

  it("promotes same hash from different projects", async () => {
    await writeLibrary(projectDir, [makeLibraryEntry()]);
    await promoteExpertsToGlobal(projectDir, "proj-a", globalRoot);
    await promoteExpertsToGlobal(projectDir, "proj-b", globalRoot);

    const entries = await readGlobalExpertLibrary(globalRoot);
    expect(entries).toHaveLength(2);
    expect(entries[0].projectName).toBe("proj-a");
    expect(entries[1].projectName).toBe("proj-b");
  });

  it("returns empty when no library exists", async () => {
    const emptyDir = path.join(base, "empty-project");
    await mkdir(emptyDir, { recursive: true });
    const result = await promoteExpertsToGlobal(emptyDir, "empty", globalRoot);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(0);
  });
});

// ── findGlobalExperts ──

describe("findGlobalExperts", () => {
  let projectDir: string;
  let globalRoot: string;
  let base: string;

  beforeEach(async () => {
    const dirs = await setupDirs();
    projectDir = dirs.projectDir;
    globalRoot = dirs.globalRoot;
    base = dirs.base;
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("finds experts matching question type", async () => {
    await writeLibrary(projectDir, [
      makeLibraryEntry({ questionType: "landscape" }),
      makeLibraryEntry({
        personaHash: "xyz789",
        questionType: "mechanism",
        score: 10.0,
        dispatches: 2,
      }),
    ]);
    await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    const results = await findGlobalExperts("landscape", "gold recovery survey", 3, globalRoot);
    expect(results).toHaveLength(1);
    expect(results[0].questionType).toBe("landscape");
  });

  it("ranks by domain keyword overlap + score", async () => {
    await writeLibrary(projectDir, [
      makeLibraryEntry({
        personaHash: "aaa",
        domain: "gold recovery from wastewater",
        score: 10.0,
        dispatches: 2,
      }),
      makeLibraryEntry({
        personaHash: "bbb",
        domain: "iron ore processing",
        score: 15.0,
        dispatches: 3,
      }),
    ]);
    await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    const results = await findGlobalExperts(
      "landscape",
      "gold recovery from sewage wastewater",
      2,
      globalRoot
    );
    expect(results).toHaveLength(2);
    // The gold-related expert should rank higher due to domain overlap
    expect(results[0].domain).toContain("gold");
  });

  it("returns empty when no global library exists", async () => {
    const results = await findGlobalExperts("landscape", "anything", 3, globalRoot);
    expect(results).toHaveLength(0);
  });

  it("respects topN limit", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeLibraryEntry({
        personaHash: `hash${i}`,
        score: 10 + i,
        dispatches: 2,
      })
    );
    await writeLibrary(projectDir, entries);
    await promoteExpertsToGlobal(projectDir, "test-proj", globalRoot);

    const results = await findGlobalExperts("landscape", "gold", 2, globalRoot);
    expect(results).toHaveLength(2);
  });
});

// ── readGlobalExpertLibrary ──

describe("readGlobalExpertLibrary", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "sea-global-expert-read-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", async () => {
    const entries = await readGlobalExpertLibrary(base);
    expect(entries).toEqual([]);
  });

  it("reads entries from manifest", async () => {
    const entry = {
      globalPersonaId: "proj--abc",
      personaHash: "abc",
      projectName: "proj",
      questionType: "landscape",
      domain: "test",
      expertType: "tester",
      avgIG: 5,
      dispatches: 2,
      score: 3.5,
      personaPath: "experts/QQ001/persona.md",
      promotedAt: "2026-04-01T00:00:00.000Z",
      revokedAt: null,
    };
    await writeFile(
      path.join(base, "global-expert-library.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf-8"
    );

    const entries = await readGlobalExpertLibrary(base);
    expect(entries).toHaveLength(1);
    expect(entries[0].globalPersonaId).toBe("proj--abc");
  });
});
