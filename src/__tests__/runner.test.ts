import { describe, it, expect } from "vitest";
import { buildSpawnArgs } from "../runner.js";

describe("buildSpawnArgs", () => {
  const codexBinary = process.platform === "win32" ? "cmd.exe" : "codex";

  it("defaults to claude provider", () => {
    const { binary, args } = buildSpawnArgs();
    expect(binary).toBe("claude");
    expect(args).toContain("-p");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("uses claude provider explicitly", () => {
    const { binary, args } = buildSpawnArgs({ provider: "claude" });
    expect(binary).toBe("claude");
    expect(args).toEqual(["-p", "--output-format", "text", "--dangerously-skip-permissions"]);
  });

  it("uses codex provider", () => {
    const { binary, args } = buildSpawnArgs({ provider: "codex" });
    expect(binary).toBe(codexBinary);
    expect(args).toContain("exec");
    expect(args).toContain("-");
    expect(args).toContain("-a");
    expect(args).toContain("never");
    expect(args).toContain("--search");
  });

  it("appends model flag for claude", () => {
    const { binary, args } = buildSpawnArgs({ provider: "claude", model: "sonnet" });
    expect(binary).toBe("claude");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
  });

  it("appends model flag for codex", () => {
    const { binary, args } = buildSpawnArgs({ provider: "codex", model: "o4-mini" });
    expect(binary).toBe(codexBinary);
    expect(args).toContain("--model");
    expect(args).toContain("o4-mini");
  });

  it("does not include model flag when no model specified", () => {
    const { args } = buildSpawnArgs({ provider: "codex" });
    expect(args).not.toContain("--model");
  });
});
