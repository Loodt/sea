import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { atomicAppendJsonl, atomicUpdateJsonl } from "../file-lock.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "sea-lock-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── atomicAppendJsonl ──

describe("atomicAppendJsonl", () => {
  it("creates file and appends entry when file does not exist", async () => {
    const filePath = path.join(tmpDir, "data", "test.jsonl");
    await atomicAppendJsonl(filePath, { id: 1, value: "first" });

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ id: 1, value: "first" });
  });

  it("appends multiple entries sequentially", async () => {
    const filePath = path.join(tmpDir, "seq.jsonl");
    await atomicAppendJsonl(filePath, { id: 1 });
    await atomicAppendJsonl(filePath, { id: 2 });
    await atomicAppendJsonl(filePath, { id: 3 });

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).id).toBe(1);
    expect(JSON.parse(lines[1]).id).toBe(2);
    expect(JSON.parse(lines[2]).id).toBe(3);
  });

  it("creates nested directories if needed", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c", "deep.jsonl");
    await atomicAppendJsonl(filePath, { nested: true });

    const content = await readFile(filePath, "utf-8");
    expect(JSON.parse(content.trim())).toEqual({ nested: true });
  });
});

// ── atomicUpdateJsonl ──

describe("atomicUpdateJsonl", () => {
  it("transforms entries correctly", async () => {
    const filePath = path.join(tmpDir, "update.jsonl");

    // Seed with 3 entries
    await atomicAppendJsonl(filePath, { id: 1, val: "a" });
    await atomicAppendJsonl(filePath, { id: 2, val: "b" });
    await atomicAppendJsonl(filePath, { id: 3, val: "c" });

    // Update entry with id=2
    await atomicUpdateJsonl<{ id: number; val: string }>(filePath, (entries) => {
      const idx = entries.findIndex((e) => e.id === 2);
      if (idx >= 0) entries[idx].val = "updated";
      return entries;
    });

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ id: 2, val: "updated" });
  });

  it("handles empty file", async () => {
    const filePath = path.join(tmpDir, "empty.jsonl");

    await atomicUpdateJsonl<{ id: number }>(filePath, (entries) => {
      entries.push({ id: 1 });
      return entries;
    });

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ id: 1 });
  });

  it("can delete entries via filter", async () => {
    const filePath = path.join(tmpDir, "delete.jsonl");
    await atomicAppendJsonl(filePath, { id: 1 });
    await atomicAppendJsonl(filePath, { id: 2 });
    await atomicAppendJsonl(filePath, { id: 3 });

    await atomicUpdateJsonl<{ id: number }>(filePath, (entries) =>
      entries.filter((e) => e.id !== 2)
    );

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe(1);
    expect(JSON.parse(lines[1]).id).toBe(3);
  });
});

// ── Concurrent writes ──

describe("concurrent writes", () => {
  it("5 parallel appends produce 5 entries (no data loss)", async () => {
    const filePath = path.join(tmpDir, "concurrent.jsonl");

    // 5 concurrent writes — within the 5-retry budget of proper-lockfile
    const promises = Array.from({ length: 5 }, (_, i) =>
      atomicAppendJsonl(filePath, { id: i })
    );
    await Promise.all(promises);

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(5);

    // All 5 IDs present (order may vary due to lock contention)
    const ids = lines.map((line) => JSON.parse(line).id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4]);
  });

  it("parallel updates don't corrupt data", async () => {
    const filePath = path.join(tmpDir, "parallel-update.jsonl");

    // Seed with 5 entries
    for (let i = 0; i < 5; i++) {
      await atomicAppendJsonl(filePath, { id: i, count: 0 });
    }

    // 5 parallel updates, each incrementing a different entry's count
    const promises = Array.from({ length: 5 }, (_, i) =>
      atomicUpdateJsonl<{ id: number; count: number }>(filePath, (entries) => {
        const entry = entries.find((e) => e.id === i);
        if (entry) entry.count += 1;
        return entries;
      })
    );
    await Promise.all(promises);

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(5);

    // Each entry should have count=1
    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry.count).toBe(1);
    }
  });
});
