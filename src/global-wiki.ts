import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { withFileLock } from "./file-lock.js";
import { readFindings } from "./knowledge.js";
import { buildWikiNode, inferEngineeringType, classifyToFolder } from "./wiki.js";
import type { Finding, EngineeringType } from "./types.js";

// ── Types ──

export interface GlobalEntry {
  globalId: string;
  findingId: string;
  projectName: string;
  claim: string;
  domain: string;
  confidence: number;
  source: string;
  engineeringType: string;
  promotedAt: string;
  revokedAt: string | null;
  wikiPath: string;
}

export interface GlobalWikiUpdateResult {
  promoted: number;
  revoked: number;
  skipped: number;
}

// ── Paths ──

function defaultGlobalRoot(): string {
  return path.join(process.cwd(), "global-wiki");
}

function manifestFile(root: string): string {
  return path.join(root, "manifest.jsonl");
}

// ── Manifest I/O ──

async function readManifestEntries(root: string): Promise<GlobalEntry[]> {
  const file = manifestFile(root);
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new Error(`readManifestEntries: failed to read ${file}: ${(err as Error).message}`);
  }
  if (!content.trim()) return [];
  const lines = content.trim().split("\n").filter(Boolean);
  const out: GlobalEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      out.push(JSON.parse(lines[i]) as GlobalEntry);
    } catch (err: unknown) {
      throw new Error(
        `readManifestEntries: parse error in ${file} at line ${i + 1}: ${(err as Error).message}`
      );
    }
  }
  return out;
}

async function writeManifest(root: string, entries: GlobalEntry[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  await writeFile(manifestFile(root), content, "utf-8");
}

// ── Eligibility ──

function isPromotionEligible(f: Finding): boolean {
  return (
    f.status === "verified" &&
    f.confidence >= 0.85 &&
    f.tag === "SOURCE" &&
    !!f.source &&
    f.source !== "null" &&
    f.source.startsWith("http")
  );
}

// ── Wiki Node Writing ──

async function writeGlobalNode(
  root: string,
  finding: Finding,
  globalId: string
): Promise<string> {
  const engType = finding.engineeringType ?? inferEngineeringType(finding);
  const folder = classifyToFolder(engType);
  const wikiDir = path.join(root, folder);
  await mkdir(wikiDir, { recursive: true });

  const content = buildWikiNode(finding);
  await writeFile(path.join(wikiDir, `${globalId}.md`), content, "utf-8");

  return `global-wiki/${folder}/${globalId}.md`;
}

async function moveToRevoked(
  root: string,
  entry: GlobalEntry
): Promise<void> {
  const relPath = entry.wikiPath.replace(/^global-wiki\//, "");
  const srcPath = path.join(root, relPath);
  const revokedDir = path.join(root, "_revoked");
  await mkdir(revokedDir, { recursive: true });
  const destPath = path.join(revokedDir, `${entry.globalId}.md`);

  if (existsSync(srcPath)) {
    try {
      await rename(srcPath, destPath);
    } catch {
      const fileContent = await readFile(srcPath, "utf-8");
      await writeFile(destPath, fileContent, "utf-8");
      await unlink(srcPath);
    }
  }
}

// ── Public API ──

/**
 * Promote a single finding to the global wiki.
 * Criteria: verified, confidence >= 0.85, SOURCE tag, HTTP URL source.
 * Deduplicates by projectName + findingId.
 */
export async function promoteToGlobalWiki(
  finding: Finding,
  projectName: string,
  globalRoot?: string
): Promise<GlobalEntry | null> {
  if (!isPromotionEligible(finding)) return null;

  const root = globalRoot ?? defaultGlobalRoot();
  const mp = manifestFile(root);

  return await withFileLock(mp, async () => {
    const entries = await readManifestEntries(root);

    if (entries.some((e) => e.projectName === projectName && e.findingId === finding.id && !e.revokedAt)) {
      return null;
    }

    const engType = finding.engineeringType ?? inferEngineeringType(finding);
    const globalId = `${projectName}--${finding.id}`;
    const wikiPath = await writeGlobalNode(root, finding, globalId);

    const entry: GlobalEntry = {
      globalId,
      findingId: finding.id,
      projectName,
      claim: finding.claim,
      domain: finding.domain,
      confidence: finding.confidence,
      source: finding.source!,
      engineeringType: String(engType),
      promotedAt: new Date().toISOString(),
      revokedAt: null,
      wikiPath,
    };

    entries.push(entry);
    await writeManifest(root, entries);
    return entry;
  });
}

/**
 * Revoke a global wiki entry. Sets revokedAt and moves the file to _revoked/.
 */
export async function revokeGlobalEntry(
  findingId: string,
  projectName: string,
  globalRoot?: string
): Promise<boolean> {
  const root = globalRoot ?? defaultGlobalRoot();
  const mp = manifestFile(root);

  return await withFileLock(mp, async () => {
    const entries = await readManifestEntries(root);
    const entry = entries.find(
      (e) => e.findingId === findingId && e.projectName === projectName && !e.revokedAt
    );
    if (!entry) return false;

    entry.revokedAt = new Date().toISOString();
    await moveToRevoked(root, entry);
    await writeManifest(root, entries);
    return true;
  });
}

/**
 * Orchestrator: promote eligible findings, revoke refuted ones.
 * Single lock acquisition for the entire operation.
 */
export async function updateGlobalWikiFromProject(
  projectDir: string,
  projectName: string,
  globalRoot?: string
): Promise<GlobalWikiUpdateResult> {
  const root = globalRoot ?? defaultGlobalRoot();
  const mp = manifestFile(root);
  const findings = await readFindings(projectDir);

  return await withFileLock(mp, async () => {
    const entries = await readManifestEntries(root);
    const result: GlobalWikiUpdateResult = { promoted: 0, revoked: 0, skipped: 0 };

    const activeSet = new Set(
      entries
        .filter((e) => e.projectName === projectName && !e.revokedAt)
        .map((e) => e.findingId)
    );

    // Promote eligible
    for (const f of findings) {
      if (!isPromotionEligible(f)) continue;
      if (activeSet.has(f.id)) {
        result.skipped++;
        continue;
      }

      const engType = f.engineeringType ?? inferEngineeringType(f);
      const globalId = `${projectName}--${f.id}`;
      const wikiPath = await writeGlobalNode(root, f, globalId);

      entries.push({
        globalId,
        findingId: f.id,
        projectName,
        claim: f.claim,
        domain: f.domain,
        confidence: f.confidence,
        source: f.source!,
        engineeringType: String(engType),
        promotedAt: new Date().toISOString(),
        revokedAt: null,
        wikiPath,
      });
      activeSet.add(f.id);
      result.promoted++;
    }

    // Revoke entries for refuted findings
    const refutedIds = new Set(
      findings.filter((f) => f.status === "refuted").map((f) => f.id)
    );
    for (const entry of entries) {
      if (entry.projectName !== projectName || entry.revokedAt) continue;
      if (!refutedIds.has(entry.findingId)) continue;

      entry.revokedAt = new Date().toISOString();
      await moveToRevoked(root, entry);
      result.revoked++;
    }

    await writeManifest(root, entries);
    return result;
  });
}

/**
 * Seed a project with verified findings from the global wiki.
 * Returns SEED-prefixed findings matching domain and keywords.
 * Skips revoked entries.
 */
export async function seedFromGlobalWiki(
  projectDir: string,
  domain: string,
  keywords: string[],
  globalRoot?: string
): Promise<Finding[]> {
  const root = globalRoot ?? defaultGlobalRoot();
  const entries = await readManifestEntries(root);

  const eligible = entries.filter((e) => {
    if (e.revokedAt) return false;
    if (domain && e.domain !== domain) return false;
    if (keywords.length > 0) {
      const claimLower = e.claim.toLowerCase();
      if (!keywords.some((kw) => claimLower.includes(kw.toLowerCase()))) return false;
    }
    return true;
  });

  return eligible.map((e) => ({
    id: `SEED-${e.globalId}`,
    claim: e.claim,
    tag: "SOURCE" as const,
    source: e.source,
    confidence: e.confidence,
    domain: e.domain,
    iteration: 0,
    status: "verified" as const,
    verifiedAt: 0,
    supersededBy: null,
    engineeringType: e.engineeringType as EngineeringType,
  }));
}
