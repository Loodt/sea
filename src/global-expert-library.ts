import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./file-lock.js";
import { readLibrary, extractKeywords } from "./expert-library.js";
import type { GlobalExpertEntry, QuestionType } from "./types.js";
import {
  EXPERT_GLOBAL_PROMOTE_THRESHOLD,
  EXPERT_GLOBAL_MIN_DISPATCHES,
} from "./types.js";

// ── Paths ──

const MANIFEST_FILE = "global-expert-library.jsonl";

function defaultGlobalRoot(): string {
  return process.cwd();
}

function manifestPath(root: string): string {
  return path.join(root, MANIFEST_FILE);
}

// ── Manifest I/O ──

export async function readGlobalExpertLibrary(
  globalRoot?: string
): Promise<GlobalExpertEntry[]> {
  const mp = manifestPath(globalRoot ?? defaultGlobalRoot());
  try {
    const content = await readFile(mp, "utf-8");
    if (!content.trim()) return [];
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GlobalExpertEntry);
  } catch {
    return [];
  }
}

async function writeManifest(
  root: string,
  entries: GlobalExpertEntry[]
): Promise<void> {
  const content =
    entries.map((e) => JSON.stringify(e)).join("\n") +
    (entries.length ? "\n" : "");
  await writeFile(manifestPath(root), content, "utf-8");
}

// ── Promotion ──

export interface GlobalExpertUpdateResult {
  promoted: number;
  skipped: number;
}

/**
 * Promote high-scoring expert library entries from a project to the global library.
 * Criteria: score > threshold, dispatches >= minimum, status active.
 * Deduplicates by projectName + personaHash.
 */
export async function promoteExpertsToGlobal(
  projectDir: string,
  projectName: string,
  globalRoot?: string
): Promise<GlobalExpertUpdateResult> {
  const root = globalRoot ?? defaultGlobalRoot();
  const mp = manifestPath(root);

  const library = await readLibrary(projectDir);
  const eligible = library.filter(
    (e) =>
      e.status === "active" &&
      e.score > EXPERT_GLOBAL_PROMOTE_THRESHOLD &&
      e.dispatches >= EXPERT_GLOBAL_MIN_DISPATCHES
  );

  if (eligible.length === 0) return { promoted: 0, skipped: 0 };

  return await withFileLock(mp, async () => {
    const entries = await readGlobalExpertLibrary(root);
    let promoted = 0;
    let skipped = 0;

    for (const local of eligible) {
      const alreadyExists = entries.some(
        (e) =>
          e.projectName === projectName &&
          e.personaHash === local.personaHash &&
          !e.revokedAt
      );

      if (alreadyExists) {
        skipped++;
        continue;
      }

      const entry: GlobalExpertEntry = {
        globalPersonaId: `${projectName}--${local.personaHash}`,
        personaHash: local.personaHash,
        projectName,
        questionType: local.questionType,
        domain: local.domain,
        expertType: local.expertType,
        avgIG: local.avgIG,
        dispatches: local.dispatches,
        score: local.score,
        personaPath: local.personaPath,
        promotedAt: new Date().toISOString(),
        revokedAt: null,
      };

      entries.push(entry);
      promoted++;
    }

    if (promoted > 0) {
      await writeManifest(root, entries);
    }

    return { promoted, skipped };
  });
}

// ── Search ──

/**
 * Find global expert entries matching a question type and domain.
 * Same composite ranking as local findMatchingExperts:
 * domain keyword overlap (0.4) + utility score (0.6).
 */
export function findGlobalExperts(
  questionType: QuestionType,
  questionText: string,
  topN: number = 3,
  globalRoot?: string
): Promise<GlobalExpertEntry[]> {
  // Read manifest then rank — async wrapper for consistency
  return (async () => {
    const entries = await readGlobalExpertLibrary(globalRoot);

    const active = entries.filter(
      (e) =>
        e.questionType === questionType && e.score > 0 && !e.revokedAt
    );
    if (active.length === 0) return [];

    const keywords = extractKeywords(questionText);
    const maxScore = Math.max(...active.map((e) => e.score), 1);

    const scored = active.map((entry) => {
      const entryWords = extractKeywords(entry.domain + " " + entry.expertType);
      const overlap = keywords.filter((kw) => entryWords.includes(kw)).length;
      const normalizedOverlap =
        keywords.length > 0 ? overlap / keywords.length : 0;
      const normalizedScore = entry.score / maxScore;
      const composite = normalizedOverlap * 0.4 + normalizedScore * 0.6;
      return { entry, composite };
    });

    scored.sort((a, b) => b.composite - a.composite);
    return scored.slice(0, topN).map((s) => s.entry);
  })();
}
