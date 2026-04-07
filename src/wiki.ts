import { readFile, writeFile, mkdir, rename, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { withFileLock } from "./file-lock.js";
import { readFindings, batchUpdateFindings } from "./knowledge.js";
import type { Finding, EngineeringType } from "./types.js";
import { ENGINEERING_TYPE_PRIORITY } from "./types.js";

// ── Wiki Manifest (output state, not finding state) ──

interface WikiManifestEntry {
  findingId: string;
  contentHash: string;
  wikiPath: string; // relative to project dir, forward slashes
  writtenAt: string;
}

interface WikiManifest {
  entries: WikiManifestEntry[];
}

// ── Constants ──

const WIKI_CONFIDENCE_THRESHOLD = 0.7;

const TYPE_FOLDER_MAP: Record<EngineeringType, string> = {
  MEASUREMENT: "facts",
  STANDARD: "facts",
  DERIVED: "relationships",
  DESIGN: "decisions",
  ASSUMPTION: "assumptions",
  HYPOTHESIS: "assumptions",
};

// ── Pure Functions ──

/**
 * Escape a string value for safe YAML frontmatter output.
 * Wraps in double quotes when the value contains YAML-special characters.
 */
export function escapeYamlValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return "null";
  const s = String(value);
  if (s === "") return '""';

  const needsQuoting =
    /[:#{}[\]"'`\n\r|>&*!%@,?\\]/.test(s) ||
    /^[->\s|*&!%@`]/.test(s) ||
    /^\s/.test(s) ||
    /\s$/.test(s) ||
    s === "true" ||
    s === "false" ||
    s === "null" ||
    s === "yes" ||
    s === "no";

  if (!needsQuoting) return s;

  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/**
 * Infer an engineering type from a finding's epistemic tag and confidence.
 * Used to backfill findings that predate the engineeringType field.
 */
export function inferEngineeringType(finding: Finding): EngineeringType {
  if (finding.tag === "SOURCE" && finding.confidence >= 0.9) return "MEASUREMENT";
  if (finding.tag === "SOURCE") return "STANDARD";
  if (finding.tag === "DERIVED") return "DERIVED";
  if (finding.tag === "ASSUMED") return "ASSUMPTION";
  if (finding.tag === "ESTIMATED") return "HYPOTHESIS";
  return "ASSUMPTION";
}

/**
 * Map an engineering type to its wiki folder name.
 */
export function classifyToFolder(engType: EngineeringType): string {
  return TYPE_FOLDER_MAP[engType] ?? "assumptions";
}

/**
 * Deterministic content hash of a finding for change detection.
 */
export function findingContentHash(finding: Finding): string {
  return createHash("sha256").update(JSON.stringify(finding)).digest("hex").slice(0, 16);
}

/**
 * Build the complete markdown content for a wiki node.
 * @param wikiPathMap Optional map from finding ID to wiki path (e.g. "wiki/facts/F002.md")
 *   for resolving cross-folder links. Without it, linked findings use same-folder relative links.
 */
export function buildWikiNode(finding: Finding, wikiPathMap?: Map<string, string>): string {
  const engType = finding.engineeringType ?? inferEngineeringType(finding);
  const humanReview =
    finding.humanReviewRequired ?? (engType === "ASSUMPTION" || engType === "HYPOTHESIS");

  const fm = [
    "---",
    `id: ${escapeYamlValue(finding.id)}`,
    `claim: ${escapeYamlValue(finding.claim)}`,
    `type: ${engType}`,
    `tag: ${finding.tag}`,
    `confidence: ${finding.confidence}`,
    `domain: ${escapeYamlValue(finding.domain)}`,
    `source: ${escapeYamlValue(finding.source)}`,
    `status: ${finding.status}`,
    `iteration: ${finding.iteration}`,
    `human_review_required: ${humanReview}`,
  ];

  if (finding.linkedFindings?.length) {
    fm.push(`linked_findings: [${finding.linkedFindings.map(escapeYamlValue).join(", ")}]`);
  }

  if (finding.quantitative) {
    const q = finding.quantitative;
    fm.push("quantitative:");
    if (q.value !== undefined) fm.push(`  value: ${q.value}`);
    if (q.unit) fm.push(`  unit: ${escapeYamlValue(q.unit)}`);
    if (q.uncertainty) fm.push(`  uncertainty: ${escapeYamlValue(q.uncertainty)}`);
    if (q.variableA) fm.push(`  variable_a: ${escapeYamlValue(q.variableA)}`);
    if (q.variableB) fm.push(`  variable_b: ${escapeYamlValue(q.variableB)}`);
    if (q.relationship) fm.push(`  relationship: ${q.relationship}`);
  }

  fm.push("---");

  const body: string[] = ["", `## ${finding.claim}`, ""];

  if (finding.status === "refuted") {
    body.push("> **Refuted** -- this finding has been contradicted by later evidence.", "");
  }
  if (finding.status === "superseded" && finding.supersededBy) {
    body.push(
      `> **Superseded** by [${finding.supersededBy}](./${finding.supersededBy}.md)`,
      ""
    );
  }

  if (finding.quantitative?.relationship) {
    body.push(`**Relationship**: ${finding.quantitative.relationship}`, "");
  }
  if (finding.quantitative?.value !== undefined) {
    const q = finding.quantitative;
    const valStr = q.unit ? `${q.value} ${q.unit}` : `${q.value}`;
    const uncStr = q.uncertainty ? ` (${q.uncertainty})` : "";
    body.push(`**Value**: ${valStr}${uncStr}`, "");
  }

  body.push(`**Source**: ${finding.source ?? "unknown"}`);
  body.push(`**Confidence**: ${(finding.confidence * 100).toFixed(0)}%`);

  if (humanReview) {
    body.push("", "> This node requires human review before use in design decisions.");
  }

  if (finding.linkedFindings?.length) {
    const links = finding.linkedFindings
      .map((id) => {
        if (wikiPathMap) {
          const targetPath = wikiPathMap.get(id);
          if (targetPath) {
            // Resolve cross-folder relative link from this node's folder
            const thisFolder = classifyToFolder(engType);
            const targetRel = targetPath.replace(/^wiki\//, "");
            return `[${id}](../${targetRel})`;
          }
        }
        // Fallback: same-folder link (may break for cross-type links)
        return `[${id}](./${id}.md)`;
      })
      .join(", ");
    body.push("", `**Related findings**: ${links}`);
  }

  return fm.join("\n") + "\n" + body.join("\n") + "\n";
}

// ── Manifest I/O ──

function manifestPath(projectDir: string): string {
  return path.join(projectDir, "wiki", "manifest.json");
}

async function readManifest(projectDir: string): Promise<WikiManifest> {
  const mp = manifestPath(projectDir);
  try {
    const content = await readFile(mp, "utf-8");
    return JSON.parse(content) as WikiManifest;
  } catch {
    return { entries: [] };
  }
}

async function writeManifest(projectDir: string, manifest: WikiManifest): Promise<void> {
  const mp = manifestPath(projectDir);
  await withFileLock(mp, async () => {
    await writeFile(mp, JSON.stringify(manifest, null, 2), "utf-8");
  });
}

// ── Wiki Node Writer ──

/**
 * Write a single finding as a wiki node. Returns the relative path (forward slashes).
 */
export async function writeWikiNode(
  projectDir: string,
  finding: Finding,
  wikiPathMap?: Map<string, string>
): Promise<string> {
  const engType = finding.engineeringType ?? inferEngineeringType(finding);
  const folder = classifyToFolder(engType);
  const wikiDir = path.join(projectDir, "wiki", folder);
  await mkdir(wikiDir, { recursive: true });

  const content = buildWikiNode(finding, wikiPathMap);
  const filePath = path.join(wikiDir, `${finding.id}.md`);
  await writeFile(filePath, content, "utf-8");

  // Return forward-slash relative path for markdown links
  return `wiki/${folder}/${finding.id}.md`;
}

// ── Incremental Update Engine ──

export interface WikiUpdateResult {
  written: number;
  skipped: number;
  archived: number;
  backfilled: number;
}

/**
 * Main entry point: incrementally update the wiki from findings.jsonl.
 * - Backfills engineeringType on old findings
 * - Only writes nodes that changed (content-hash diffing)
 * - Archives nodes for refuted/superseded/deleted findings
 */
export async function updateWiki(projectDir: string): Promise<WikiUpdateResult> {
  let findings = await readFindings(projectDir);
  const manifest = await readManifest(projectDir);
  const result: WikiUpdateResult = { written: 0, skipped: 0, archived: 0, backfilled: 0 };

  // Build lookup from manifest
  const manifestMap = new Map<string, WikiManifestEntry>();
  for (const entry of manifest.entries) {
    manifestMap.set(entry.findingId, entry);
  }

  // Backfill pass: batch-enrich old findings that lack engineeringType.
  // Single atomic read-modify-write instead of N individual updateFinding calls.
  const missingTypeCount = findings.filter((f) => !f.engineeringType).length;
  if (missingTypeCount > 0) {
    await batchUpdateFindings(projectDir, (allFindings) => {
      for (const f of allFindings) {
        if (!f.engineeringType) {
          f.engineeringType = inferEngineeringType(f);
          f.humanReviewRequired =
            f.engineeringType === "ASSUMPTION" || f.engineeringType === "HYPOTHESIS";
        }
      }
      return allFindings;
    });
    // Re-read so in-memory findings reflect the persisted state
    findings = await readFindings(projectDir);
    result.backfilled = missingTypeCount;
  }

  // Determine which findings should have wiki nodes
  const eligibleFindings = findings.filter(
    (f) =>
      f.confidence >= WIKI_CONFIDENCE_THRESHOLD &&
      f.status !== "refuted" &&
      f.status !== "superseded"
  );
  const eligibleIds = new Set(eligibleFindings.map((f) => f.id));

  // Build a wiki path map for cross-folder link resolution.
  // Includes both existing manifest entries and new paths computed ahead of time.
  const wikiPathMap = new Map<string, string>();
  for (const entry of manifest.entries) {
    wikiPathMap.set(entry.findingId, entry.wikiPath);
  }
  for (const f of eligibleFindings) {
    if (!wikiPathMap.has(f.id)) {
      const engType = f.engineeringType ?? inferEngineeringType(f);
      const folder = classifyToFolder(engType);
      wikiPathMap.set(f.id, `wiki/${folder}/${f.id}.md`);
    }
  }

  // Write/update eligible findings
  const newEntries: WikiManifestEntry[] = [];
  for (const finding of eligibleFindings) {
    const hash = findingContentHash(finding);
    const existing = manifestMap.get(finding.id);

    if (existing && existing.contentHash === hash) {
      // No change — keep existing entry
      newEntries.push(existing);
      result.skipped++;
    } else {
      // New or changed — write wiki node
      const wikiPath = await writeWikiNode(projectDir, finding, wikiPathMap);
      newEntries.push({
        findingId: finding.id,
        contentHash: hash,
        wikiPath,
        writtenAt: new Date().toISOString(),
      });
      result.written++;
    }
  }

  // Archive stale manifest entries (finding deleted, refuted, or superseded)
  const archiveDir = path.join(projectDir, "wiki", "_archive");
  for (const entry of manifest.entries) {
    if (!eligibleIds.has(entry.findingId)) {
      // Archive the file
      const srcPath = path.join(projectDir, entry.wikiPath.replace(/\//g, path.sep));
      if (existsSync(srcPath)) {
        await mkdir(archiveDir, { recursive: true });
        const archivePath = path.join(archiveDir, `${entry.findingId}.md`);
        try {
          await rename(srcPath, archivePath);
        } catch {
          // If rename fails (cross-device), copy+delete
          const content = await readFile(srcPath, "utf-8");
          await writeFile(archivePath, content, "utf-8");
          await unlink(srcPath);
        }
      }
      result.archived++;
    }
  }

  // Write updated manifest and rebuild index (pass manifest directly, no re-read)
  manifest.entries = newEntries;
  await mkdir(path.join(projectDir, "wiki"), { recursive: true });
  await writeManifest(projectDir, manifest);
  await updateWikiIndex(projectDir, findings, manifest);

  return result;
}

/**
 * Regenerate wiki/index.md from findings and manifest.
 * Accepts manifest directly to avoid redundant disk I/O when called from updateWiki.
 */
export async function updateWikiIndex(
  projectDir: string,
  findings: Finding[],
  manifest?: WikiManifest
): Promise<void> {
  const m = manifest ?? await readManifest(projectDir);
  if (m.entries.length === 0) return;

  const entryIds = new Set(m.entries.map((e) => e.findingId));
  const wikiPathMap = new Map(m.entries.map((e) => [e.findingId, e.wikiPath]));

  // Only include findings that have wiki nodes
  const wikiFindingsUnsorted = findings.filter((f) => entryIds.has(f.id));

  // Group by domain
  const byDomain = new Map<string, Finding[]>();
  for (const f of wikiFindingsUnsorted) {
    const group = byDomain.get(f.domain) ?? [];
    group.push(f);
    byDomain.set(f.domain, group);
  }

  const lines: string[] = [
    "# Engineering Knowledge Wiki",
    "",
    `*${m.entries.length} nodes across ${byDomain.size} domains*`,
    "",
    "---",
    "",
  ];

  // Sort domains alphabetically
  const sortedDomains = [...byDomain.keys()].sort();
  for (const domain of sortedDomains) {
    const domainFindings = byDomain.get(domain)!;

    // Sort: by engineering type priority, then confidence desc
    domainFindings.sort((a, b) => {
      const aPri = ENGINEERING_TYPE_PRIORITY[a.engineeringType ?? "ASSUMPTION"];
      const bPri = ENGINEERING_TYPE_PRIORITY[b.engineeringType ?? "ASSUMPTION"];
      if (aPri !== bPri) return aPri - bPri;
      return b.confidence - a.confidence;
    });

    lines.push(`## ${domain}`);
    lines.push("");

    for (const f of domainFindings) {
      const wikiPath = wikiPathMap.get(f.id);
      if (!wikiPath) continue;
      // Make path relative from wiki/index.md
      const relPath = wikiPath.replace(/^wiki\//, "./");
      const typeTag = f.engineeringType ?? "?";
      const conf = `${(f.confidence * 100).toFixed(0)}%`;
      lines.push(`- [${f.claim}](${relPath}) — ${typeTag} ${conf}`);
    }

    lines.push("");
  }

  const wikiDir = path.join(projectDir, "wiki");
  await mkdir(wikiDir, { recursive: true });
  await writeFile(path.join(wikiDir, "index.md"), lines.join("\n"), "utf-8");
}
