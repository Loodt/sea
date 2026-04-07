import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  promoteToGlobalWiki,
  revokeGlobalEntry,
  updateGlobalWikiFromProject,
  seedFromGlobalWiki,
} from "../global-wiki.js";
import type { Finding } from "../types.js";

// ── Helpers ──

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F001",
    claim: "Test claim",
    tag: "SOURCE",
    source: "https://example.com/paper",
    confidence: 0.9,
    domain: "test",
    iteration: 1,
    status: "verified",
    verifiedAt: 3,
    supersededBy: null,
    engineeringType: "MEASUREMENT",
    ...overrides,
  };
}

async function setupDirs(): Promise<{ projectDir: string; globalRoot: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), "sea-global-wiki-test-"));
  const projectDir = path.join(base, "project");
  const globalRoot = path.join(base, "global-wiki");
  await mkdir(path.join(projectDir, "knowledge"), { recursive: true });
  await mkdir(globalRoot, { recursive: true });
  return { projectDir, globalRoot };
}

async function writeFindings(projectDir: string, findings: Finding[]): Promise<void> {
  const content = findings.map((f) => JSON.stringify(f)).join("\n") + (findings.length ? "\n" : "");
  await writeFile(path.join(projectDir, "knowledge", "findings.jsonl"), content, "utf-8");
}

// ── promoteToGlobalWiki ──

describe("promoteToGlobalWiki", () => {
  let projectDir: string;
  let globalRoot: string;
  let base: string;

  beforeEach(async () => {
    const dirs = await setupDirs();
    projectDir = dirs.projectDir;
    globalRoot = dirs.globalRoot;
    base = path.dirname(projectDir);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("promotes an eligible finding", async () => {
    const finding = makeFinding();
    const entry = await promoteToGlobalWiki(finding, "test-project", globalRoot);

    expect(entry).not.toBeNull();
    expect(entry!.globalId).toBe("test-project--F001");
    expect(entry!.findingId).toBe("F001");
    expect(entry!.projectName).toBe("test-project");
    expect(entry!.revokedAt).toBeNull();

    // Check wiki file exists
    const wikiFile = path.join(globalRoot, "facts", "test-project--F001.md");
    expect(existsSync(wikiFile)).toBe(true);

    // Check manifest
    const manifest = await readFile(path.join(globalRoot, "manifest.jsonl"), "utf-8");
    const entries = manifest.trim().split("\n").map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    expect(entries[0].globalId).toBe("test-project--F001");
  });

  it("rejects non-verified finding", async () => {
    const finding = makeFinding({ status: "provisional" });
    const entry = await promoteToGlobalWiki(finding, "proj", globalRoot);
    expect(entry).toBeNull();
  });

  it("rejects low-confidence finding", async () => {
    const finding = makeFinding({ confidence: 0.7 });
    const entry = await promoteToGlobalWiki(finding, "proj", globalRoot);
    expect(entry).toBeNull();
  });

  it("rejects non-SOURCE tag", async () => {
    const finding = makeFinding({ tag: "DERIVED" });
    const entry = await promoteToGlobalWiki(finding, "proj", globalRoot);
    expect(entry).toBeNull();
  });

  it("rejects null source", async () => {
    const finding = makeFinding({ source: null });
    const entry = await promoteToGlobalWiki(finding, "proj", globalRoot);
    expect(entry).toBeNull();
  });

  it("rejects non-URL source", async () => {
    const finding = makeFinding({ source: "local file" });
    const entry = await promoteToGlobalWiki(finding, "proj", globalRoot);
    expect(entry).toBeNull();
  });

  it("deduplicates by projectName + findingId", async () => {
    const finding = makeFinding();
    await promoteToGlobalWiki(finding, "proj", globalRoot);
    const second = await promoteToGlobalWiki(finding, "proj", globalRoot);
    expect(second).toBeNull();

    const manifest = await readFile(path.join(globalRoot, "manifest.jsonl"), "utf-8");
    expect(manifest.trim().split("\n")).toHaveLength(1);
  });

  it("allows same finding from different projects", async () => {
    const finding = makeFinding();
    const e1 = await promoteToGlobalWiki(finding, "proj-a", globalRoot);
    const e2 = await promoteToGlobalWiki(finding, "proj-b", globalRoot);
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
    expect(e1!.globalId).toBe("proj-a--F001");
    expect(e2!.globalId).toBe("proj-b--F001");
  });

  it("classifies to correct folder based on engineering type", async () => {
    const derived = makeFinding({ id: "F002", engineeringType: "DERIVED" });
    const entry = await promoteToGlobalWiki(derived, "proj", globalRoot);
    expect(entry!.wikiPath).toContain("relationships");
    expect(existsSync(path.join(globalRoot, "relationships", "proj--F002.md"))).toBe(true);
  });
});

// ── revokeGlobalEntry ──

describe("revokeGlobalEntry", () => {
  let globalRoot: string;
  let base: string;

  beforeEach(async () => {
    const dirs = await setupDirs();
    globalRoot = dirs.globalRoot;
    base = path.dirname(dirs.projectDir);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("revokes an existing entry and moves file", async () => {
    const finding = makeFinding();
    await promoteToGlobalWiki(finding, "proj", globalRoot);

    const revoked = await revokeGlobalEntry("F001", "proj", globalRoot);
    expect(revoked).toBe(true);

    // Original file gone
    expect(existsSync(path.join(globalRoot, "facts", "proj--F001.md"))).toBe(false);
    // Moved to _revoked/
    expect(existsSync(path.join(globalRoot, "_revoked", "proj--F001.md"))).toBe(true);

    // Manifest updated with revokedAt
    const manifest = await readFile(path.join(globalRoot, "manifest.jsonl"), "utf-8");
    const entry = JSON.parse(manifest.trim());
    expect(entry.revokedAt).not.toBeNull();
  });

  it("returns false for non-existent entry", async () => {
    const revoked = await revokeGlobalEntry("F999", "proj", globalRoot);
    expect(revoked).toBe(false);
  });

  it("returns false for already-revoked entry", async () => {
    const finding = makeFinding();
    await promoteToGlobalWiki(finding, "proj", globalRoot);
    await revokeGlobalEntry("F001", "proj", globalRoot);

    const second = await revokeGlobalEntry("F001", "proj", globalRoot);
    expect(second).toBe(false);
  });
});

// ── updateGlobalWikiFromProject ──

describe("updateGlobalWikiFromProject", () => {
  let projectDir: string;
  let globalRoot: string;
  let base: string;

  beforeEach(async () => {
    const dirs = await setupDirs();
    projectDir = dirs.projectDir;
    globalRoot = dirs.globalRoot;
    base = path.dirname(projectDir);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("promotes eligible findings from project", async () => {
    const findings = [
      makeFinding({ id: "F001" }),
      makeFinding({ id: "F002", claim: "Second claim" }),
    ];
    await writeFindings(projectDir, findings);

    const result = await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);
    expect(result.promoted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.revoked).toBe(0);
  });

  it("skips already-promoted findings", async () => {
    const findings = [makeFinding({ id: "F001" })];
    await writeFindings(projectDir, findings);

    await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);
    const result = await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);

    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("revokes entries for refuted findings", async () => {
    // First promote
    const findings = [makeFinding({ id: "F001" })];
    await writeFindings(projectDir, findings);
    await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);

    // Now refute
    const updated = [makeFinding({ id: "F001", status: "refuted" })];
    await writeFindings(projectDir, updated);
    const result = await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);

    expect(result.revoked).toBe(1);
    expect(existsSync(path.join(globalRoot, "_revoked", "proj--F001.md"))).toBe(true);
  });

  it("skips ineligible findings", async () => {
    const findings = [
      makeFinding({ id: "F001", status: "provisional" }),
      makeFinding({ id: "F002", confidence: 0.5 }),
      makeFinding({ id: "F003", tag: "DERIVED" }),
    ];
    await writeFindings(projectDir, findings);

    const result = await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);
    expect(result.promoted).toBe(0);
  });

  it("handles mixed promote and revoke in single call", async () => {
    // Promote F001
    const initial = [makeFinding({ id: "F001" })];
    await writeFindings(projectDir, initial);
    await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);

    // F001 refuted, F002 new eligible
    const updated = [
      makeFinding({ id: "F001", status: "refuted" }),
      makeFinding({ id: "F002", claim: "New claim" }),
    ];
    await writeFindings(projectDir, updated);
    const result = await updateGlobalWikiFromProject(projectDir, "proj", globalRoot);

    expect(result.promoted).toBe(1);
    expect(result.revoked).toBe(1);
  });
});

// ── seedFromGlobalWiki ──

describe("seedFromGlobalWiki", () => {
  let projectDir: string;
  let globalRoot: string;
  let base: string;

  beforeEach(async () => {
    const dirs = await setupDirs();
    projectDir = dirs.projectDir;
    globalRoot = dirs.globalRoot;
    base = path.dirname(projectDir);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("returns SEED-prefixed findings", async () => {
    const finding = makeFinding({ domain: "gold" });
    await promoteToGlobalWiki(finding, "proj", globalRoot);

    const seeded = await seedFromGlobalWiki(projectDir, "gold", [], globalRoot);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].id).toBe("SEED-proj--F001");
    expect(seeded[0].status).toBe("verified");
    expect(seeded[0].tag).toBe("SOURCE");
    expect(seeded[0].iteration).toBe(0);
  });

  it("filters by domain", async () => {
    await promoteToGlobalWiki(makeFinding({ id: "F001", domain: "gold" }), "p", globalRoot);
    await promoteToGlobalWiki(
      makeFinding({ id: "F002", domain: "water", claim: "Water claim" }),
      "p",
      globalRoot
    );

    const seeded = await seedFromGlobalWiki(projectDir, "gold", [], globalRoot);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].domain).toBe("gold");
  });

  it("filters by keywords", async () => {
    await promoteToGlobalWiki(
      makeFinding({ id: "F001", claim: "Gold recovery rate is 95%", domain: "gold" }),
      "p",
      globalRoot
    );
    await promoteToGlobalWiki(
      makeFinding({ id: "F002", claim: "Water pH level is 7.2", domain: "gold" }),
      "p",
      globalRoot
    );

    const seeded = await seedFromGlobalWiki(projectDir, "gold", ["recovery"], globalRoot);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].claim).toContain("recovery");
  });

  it("skips revoked entries", async () => {
    await promoteToGlobalWiki(makeFinding({ id: "F001", domain: "gold" }), "p", globalRoot);
    await revokeGlobalEntry("F001", "p", globalRoot);

    const seeded = await seedFromGlobalWiki(projectDir, "gold", [], globalRoot);
    expect(seeded).toHaveLength(0);
  });

  it("returns empty for no matches", async () => {
    await promoteToGlobalWiki(makeFinding({ domain: "gold" }), "p", globalRoot);

    const seeded = await seedFromGlobalWiki(projectDir, "water", [], globalRoot);
    expect(seeded).toHaveLength(0);
  });

  it("returns all domains when domain is empty", async () => {
    await promoteToGlobalWiki(makeFinding({ id: "F001", domain: "gold" }), "p", globalRoot);
    await promoteToGlobalWiki(
      makeFinding({ id: "F002", domain: "water", claim: "Water claim" }),
      "p",
      globalRoot
    );

    const seeded = await seedFromGlobalWiki(projectDir, "", [], globalRoot);
    expect(seeded).toHaveLength(2);
  });
});
