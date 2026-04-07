import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFindings, readQuestions, findingCounts } from "./knowledge.js";
import {
  readConductorMetrics,
  computeDispatchEfficiency,
  detectConvergenceSignals,
} from "./metrics.js";
import type { Finding, Question } from "./types.js";

// ── Types ──

export interface AuditResult {
  findingIntegrity: {
    sourceWithoutUrl: string[];
    claimDuplicates: string[][];
  };
  wikiIntegrity: {
    orphanedFiles: string[];
    missingFiles: string[];
    manifestCount: number;
    diskCount: number;
  };
  questionHealth: {
    staleOpen: string[];
    openResolvedRatio: number;
    totalOpen: number;
    totalResolved: number;
  };
  convergence: {
    isConverging: boolean;
    signals: string[];
    recommendation: string;
  };
  dispatchEfficiency: {
    avgFindings: number;
    trend: string;
    recentAvg: number;
    priorAvg: number;
  };
}

// ── Constants ──

const WIKI_FOLDERS = ["facts", "relationships", "decisions", "assumptions"];
const STALE_ITERATION_THRESHOLD = 10;

// ── Core ──

export async function runAudit(projectDir: string): Promise<AuditResult> {
  const [findings, questions, metrics] = await Promise.all([
    readFindings(projectDir),
    readQuestions(projectDir),
    readConductorMetrics(projectDir),
  ]);

  const result: AuditResult = {
    findingIntegrity: auditFindingIntegrity(findings),
    wikiIntegrity: await auditWikiIntegrity(projectDir),
    questionHealth: auditQuestionHealth(questions, findings),
    convergence: auditConvergence(findings, questions, metrics),
    dispatchEfficiency: computeDispatchEfficiency(metrics),
  };

  await writeAuditReport(projectDir, result, findings, questions);
  return result;
}

// ── Finding Integrity ──

function auditFindingIntegrity(findings: Finding[]): AuditResult["findingIntegrity"] {
  const sourceWithoutUrl = findings
    .filter(
      (f) =>
        f.tag === "SOURCE" &&
        (!f.source || f.source === "null" || !f.source.startsWith("http"))
    )
    .map((f) => f.id);

  const claimMap = new Map<string, string[]>();
  for (const f of findings) {
    const key = f.claim.trim().toLowerCase();
    const ids = claimMap.get(key) ?? [];
    ids.push(f.id);
    claimMap.set(key, ids);
  }
  const claimDuplicates = [...claimMap.values()].filter((ids) => ids.length > 1);

  return { sourceWithoutUrl, claimDuplicates };
}

// ── Wiki Integrity ──

async function auditWikiIntegrity(
  projectDir: string
): Promise<AuditResult["wikiIntegrity"]> {
  const result = {
    orphanedFiles: [] as string[],
    missingFiles: [] as string[],
    manifestCount: 0,
    diskCount: 0,
  };

  const mp = path.join(projectDir, "wiki", "manifest.json");
  if (!existsSync(mp)) return result;

  let manifestEntries: { findingId: string; wikiPath: string }[];
  try {
    const raw = JSON.parse(await readFile(mp, "utf-8"));
    manifestEntries = raw.entries ?? [];
  } catch {
    return result;
  }

  result.manifestCount = manifestEntries.length;
  const manifestPaths = new Set(manifestEntries.map((e) => e.wikiPath));

  // Missing files: in manifest but not on disk
  for (const entry of manifestEntries) {
    const fullPath = path.join(projectDir, entry.wikiPath.replace(/\//g, path.sep));
    if (!existsSync(fullPath)) {
      result.missingFiles.push(entry.wikiPath);
    }
  }

  // Orphaned files: on disk but not in manifest
  for (const folder of WIKI_FOLDERS) {
    const folderPath = path.join(projectDir, "wiki", folder);
    if (!existsSync(folderPath)) continue;
    try {
      const files = await readdir(folderPath);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        result.diskCount++;
        const wikiPath = `wiki/${folder}/${file}`;
        if (!manifestPaths.has(wikiPath)) {
          result.orphanedFiles.push(wikiPath);
        }
      }
    } catch {
      // folder read failed
    }
  }

  return result;
}

// ── Question Health ──

function auditQuestionHealth(
  questions: Question[],
  findings: Finding[]
): AuditResult["questionHealth"] {
  const openQuestions = questions.filter((q) => q.status === "open");
  const resolvedQuestions = questions.filter((q) => q.status === "resolved");

  const currentIteration =
    findings.length > 0 ? Math.max(...findings.map((f) => f.iteration)) : 0;

  const staleOpen = openQuestions
    .filter((q) => currentIteration - q.iteration >= STALE_ITERATION_THRESHOLD)
    .map((q) => q.id);

  const openResolvedRatio =
    resolvedQuestions.length > 0
      ? openQuestions.length / resolvedQuestions.length
      : openQuestions.length > 0
        ? Infinity
        : 0;

  return {
    staleOpen,
    openResolvedRatio,
    totalOpen: openQuestions.length,
    totalResolved: resolvedQuestions.length,
  };
}

// ── Convergence ──

function auditConvergence(
  findings: Finding[],
  questions: Question[],
  metrics: import("./types.js").ConductorMetric[]
): AuditResult["convergence"] {
  const assessment = detectConvergenceSignals(findings, questions, metrics);
  return {
    isConverging: assessment.isConverging,
    signals: assessment.signals,
    recommendation: assessment.recommendation,
  };
}

// ── Report Writer ──

async function writeAuditReport(
  projectDir: string,
  result: AuditResult,
  findings: Finding[],
  questions: Question[]
): Promise<void> {
  const outputDir = path.join(projectDir, "output");
  await mkdir(outputDir, { recursive: true });

  const counts = findingCounts(findings);
  const lines: string[] = [
    "# Audit Report",
    "",
    `*Generated: ${new Date().toISOString()}*`,
    "",
    "---",
    "",
    "## Finding Integrity",
    "",
    `Total findings: ${counts.total} (${counts.verified} verified, ${counts.provisional} provisional, ${counts.refuted} refuted)`,
    "",
  ];

  if (result.findingIntegrity.sourceWithoutUrl.length > 0) {
    lines.push(
      `**SOURCE findings without valid URL** (${result.findingIntegrity.sourceWithoutUrl.length}):`
    );
    for (const id of result.findingIntegrity.sourceWithoutUrl) {
      lines.push(`- ${id}`);
    }
    lines.push("");
  } else {
    lines.push("All SOURCE findings have valid URLs.", "");
  }

  if (result.findingIntegrity.claimDuplicates.length > 0) {
    lines.push(
      `**Duplicate claims** (${result.findingIntegrity.claimDuplicates.length} groups):`
    );
    for (const group of result.findingIntegrity.claimDuplicates) {
      lines.push(`- ${group.join(", ")}`);
    }
    lines.push("");
  } else {
    lines.push("No duplicate claims found.", "");
  }

  lines.push("## Wiki Integrity", "");
  if (result.wikiIntegrity.manifestCount > 0 || result.wikiIntegrity.diskCount > 0) {
    lines.push(`Manifest entries: ${result.wikiIntegrity.manifestCount}`);
    lines.push(`Disk nodes: ${result.wikiIntegrity.diskCount}`);
    if (result.wikiIntegrity.missingFiles.length > 0) {
      lines.push(
        "",
        `**Missing files** (in manifest but not on disk): ${result.wikiIntegrity.missingFiles.length}`
      );
      for (const f of result.wikiIntegrity.missingFiles) lines.push(`- ${f}`);
    }
    if (result.wikiIntegrity.orphanedFiles.length > 0) {
      lines.push(
        "",
        `**Orphaned files** (on disk but not in manifest): ${result.wikiIntegrity.orphanedFiles.length}`
      );
      for (const f of result.wikiIntegrity.orphanedFiles) lines.push(`- ${f}`);
    }
    if (
      result.wikiIntegrity.missingFiles.length === 0 &&
      result.wikiIntegrity.orphanedFiles.length === 0
    ) {
      lines.push("Wiki manifest and disk are in sync.");
    }
  } else {
    lines.push("No wiki found.");
  }
  lines.push("");

  lines.push("## Question Health", "");
  lines.push(
    `Open: ${result.questionHealth.totalOpen} | Resolved: ${result.questionHealth.totalResolved} | Ratio: ${result.questionHealth.openResolvedRatio === Infinity ? "∞" : result.questionHealth.openResolvedRatio.toFixed(2)}`
  );
  if (result.questionHealth.staleOpen.length > 0) {
    lines.push(
      "",
      `**Stale open questions** (${result.questionHealth.staleOpen.length}):`
    );
    for (const id of result.questionHealth.staleOpen) lines.push(`- ${id}`);
  }
  lines.push("");

  lines.push("## Convergence", "");
  if (result.convergence.isConverging) {
    lines.push(
      `**Converging** — recommendation: ${result.convergence.recommendation.toUpperCase()}`
    );
    for (const s of result.convergence.signals) lines.push(`- ${s}`);
  } else {
    lines.push("Not converging — continue dispatching.");
  }
  lines.push("");

  lines.push("## Dispatch Efficiency", "");
  lines.push(
    `Average findings/dispatch: ${result.dispatchEfficiency.avgFindings.toFixed(1)}`
  );
  lines.push(`Trend: ${result.dispatchEfficiency.trend}`);
  lines.push(
    `Recent avg: ${result.dispatchEfficiency.recentAvg.toFixed(1)} | Prior avg: ${result.dispatchEfficiency.priorAvg.toFixed(1)}`
  );
  lines.push("");

  await writeFile(path.join(outputDir, "audit-report.md"), lines.join("\n"), "utf-8");
}
