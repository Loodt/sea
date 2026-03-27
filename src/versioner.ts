import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { padVersion } from "./types.js";

/**
 * Snapshot a file to its history directory before mutation.
 * Returns the version number of the snapshot.
 *
 * Example: snapshotFile("projects/foo/persona.md", "projects/foo/persona-history")
 *   → copies persona.md to persona-history/v001.md (or v002.md, etc.)
 */
export async function snapshotFile(
  filePath: string,
  historyDir: string
): Promise<number> {
  await mkdir(historyDir, { recursive: true });

  // Determine next version number
  const existing = await getVersionFiles(historyDir);
  const nextVersion = existing.length > 0
    ? Math.max(...existing.map(extractVersionNumber)) + 1
    : 1;

  const destPath = path.join(historyDir, `${padVersion(nextVersion)}.md`);

  try {
    await copyFile(filePath, destPath);
  } catch {
    // File might not exist yet (first creation) — write empty snapshot
    await writeFile(destPath, `# Initial version (empty)\nCreated: ${new Date().toISOString()}\n`, "utf-8");
  }

  return nextVersion;
}

/**
 * Restore a file from a specific version in history.
 */
export async function restoreVersion(
  historyDir: string,
  version: number,
  targetPath: string
): Promise<void> {
  const sourcePath = path.join(historyDir, `${padVersion(version)}.md`);
  const content = await readFile(sourcePath, "utf-8");
  await writeFile(targetPath, content, "utf-8");
}

/**
 * Get the current version number (latest in history dir).
 */
export async function getCurrentVersion(historyDir: string): Promise<number> {
  const files = await getVersionFiles(historyDir);
  if (files.length === 0) return 0;
  return Math.max(...files.map(extractVersionNumber));
}

async function getVersionFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => /^v\d{3,}\.md$/.test(f));
  } catch {
    return [];
  }
}

function extractVersionNumber(filename: string): number {
  const match = filename.match(/^v(\d+)\.md$/);
  return match ? parseInt(match[1], 10) : 0;
}
