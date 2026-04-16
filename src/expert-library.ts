import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { LibraryEntry, QuestionType } from "./types.js";
import { atomicAppendJsonl, atomicUpdateJsonl } from "./file-lock.js";

/**
 * Expert Library — scores and reuses high-performing expert personas.
 *
 * Instead of creating a fresh persona for every dispatch, the library
 * tracks which personas worked well (by question type, domain, and
 * average information gain). High-scoring personas can be adapted
 * for similar future questions rather than built from scratch.
 */

const LIBRARY_FILE = "expert-library/library.jsonl";

// ── Core Operations ──

export async function readLibrary(projectDir: string): Promise<LibraryEntry[]> {
  const filePath = path.join(projectDir, LIBRARY_FILE);
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new Error(`readLibrary: failed to read ${filePath}: ${(err as Error).message}`);
  }
  if (!content.trim()) return [];
  const lines = content.trim().split("\n").filter(Boolean);
  const out: LibraryEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      out.push(JSON.parse(lines[i]) as LibraryEntry);
    } catch (err: unknown) {
      throw new Error(
        `readLibrary: parse error in ${filePath} at line ${i + 1}: ${(err as Error).message}`
      );
    }
  }
  return out;
}

export async function appendLibraryEntry(projectDir: string, entry: LibraryEntry): Promise<void> {
  const dir = path.join(projectDir, "expert-library");
  await mkdir(dir, { recursive: true });
  await atomicAppendJsonl(path.join(projectDir, LIBRARY_FILE), entry);
}

export async function updateLibraryEntry(
  projectDir: string,
  personaHash: string,
  update: Partial<LibraryEntry>
): Promise<void> {
  await atomicUpdateJsonl<LibraryEntry>(
    path.join(projectDir, LIBRARY_FILE),
    (entries) => {
      const idx = entries.findIndex((e) => e.personaHash === personaHash);
      if (idx === -1) return entries;
      entries[idx] = { ...entries[idx], ...update };
      return entries;
    }
  );
}

// ── Matching ──

/**
 * Find library entries that match a question type and domain.
 * Ranked by composite of domain keyword overlap (0.4) and utility score (0.6).
 */
export function findMatchingExperts(
  library: LibraryEntry[],
  questionType: QuestionType,
  questionText: string,
  topN: number = 3
): LibraryEntry[] {
  const active = library.filter(
    (e) => e.status === "active" && e.questionType === questionType && e.score > 0
  );
  if (active.length === 0) return [];

  const keywords = extractKeywords(questionText);

  const scored = active.map((entry) => {
    const entryWords = extractKeywords(entry.domain + " " + entry.expertType);
    const overlap = keywords.filter((kw) => entryWords.includes(kw)).length;
    const normalizedOverlap = keywords.length > 0 ? overlap / keywords.length : 0;
    const maxScore = Math.max(...active.map((e) => e.score), 1);
    const normalizedScore = entry.score / maxScore;
    const composite = normalizedOverlap * 0.4 + normalizedScore * 0.6;
    return { entry, composite };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored.slice(0, topN).map((s) => s.entry);
}

// ── Scoring ──

export function hashPersona(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function computeUtilityScore(avgIG: number, dispatches: number): number {
  return avgIG * Math.log(dispatches + 1);
}

/**
 * Update an existing library entry's running average, or create a new one.
 */
export async function upsertLibraryEntry(
  projectDir: string,
  personaHash: string,
  questionType: QuestionType,
  domain: string,
  expertType: string,
  findingsAdded: number,
  personaPath: string,
  adaptedFrom?: string
): Promise<void> {
  const library = await readLibrary(projectDir);
  const existing = library.find((e) => e.personaHash === personaHash);

  if (existing) {
    const newDispatches = existing.dispatches + 1;
    const newAvgIG = (existing.avgIG * existing.dispatches + findingsAdded) / newDispatches;
    await updateLibraryEntry(projectDir, personaHash, {
      avgIG: newAvgIG,
      dispatches: newDispatches,
      lastUsed: new Date().toISOString(),
      score: computeUtilityScore(newAvgIG, newDispatches),
    });
  } else {
    await appendLibraryEntry(projectDir, {
      personaHash,
      questionType,
      domain,
      expertType,
      avgIG: findingsAdded,
      dispatches: 1,
      lastUsed: new Date().toISOString(),
      personaPath,
      score: computeUtilityScore(findingsAdded, 1),
      status: "active",
      ...(adaptedFrom ? { adaptedFrom } : {}),
    });
  }
}

// ── Helpers ──

export function extractKeywords(text: string): string[] {
  const stops = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "was", "has", "how", "its", "may", "what", "when", "where", "which",
    "with", "would", "could", "should", "about", "from", "into", "does",
    "have", "been", "that", "them", "then", "these", "they", "this",
    "those", "will", "more", "also",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stops.has(w));
}
