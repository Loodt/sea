import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

const STALE_MS = 30_000; // 30s — locks older than this are considered stale

/**
 * Acquire an exclusive lock on a file, run the operation, then release.
 * Uses proper-lockfile for cross-platform advisory locking.
 */
export async function withFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>
): Promise<T> {
  // Ensure the target file exists (lockfile requires it)
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await readFile(targetPath);
  } catch {
    await writeFile(targetPath, "", "utf-8");
  }

  const release = await lockfile.lock(targetPath, {
    stale: STALE_MS,
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
  });

  try {
    return await operation();
  } finally {
    await release();
  }
}

/**
 * Atomically append a JSONL entry to a file.
 * Acquires a file lock, reads current content, appends the new entry.
 */
export async function atomicAppendJsonl<T>(
  filePath: string,
  entry: T
): Promise<void> {
  await withFileLock(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(filePath, "utf-8");
    } catch {
      // File doesn't exist yet
    }
    await writeFile(filePath, existing + JSON.stringify(entry) + "\n", "utf-8");
  });
}

/**
 * Atomically read-modify-write a JSONL file.
 * Acquires a file lock, reads all entries, applies the update function, writes back.
 */
export async function atomicUpdateJsonl<T>(
  filePath: string,
  updateFn: (entries: T[]) => T[]
): Promise<void> {
  await withFileLock(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    let entries: T[] = [];
    try {
      const content = await readFile(filePath, "utf-8");
      if (content.trim()) {
        entries = content
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as T);
      }
    } catch {
      // File doesn't exist or is empty
    }

    const updated = updateFn(entries);
    const content = updated.map((e) => JSON.stringify(e)).join("\n") + (updated.length ? "\n" : "");
    await writeFile(filePath, content, "utf-8");
  });
}
