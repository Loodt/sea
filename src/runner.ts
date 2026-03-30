import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  startTime: string;
  endTime: string;
  durationMs: number;
}

export interface RunOptions {
  timeoutMs?: number;
  model?: string; // e.g. "sonnet", "opus", "claude-sonnet-4-6"
}

/**
 * Spawn a `claude -p` session with the given prompt.
 * Pipes prompt via stdin. Each session gets a fresh context window.
 */
export async function runClaudeSession(
  prompt: string,
  cwd: string,
  opts?: RunOptions
): Promise<RunResult> {
  const timeoutMs = opts?.timeoutMs ?? 600_000; // 10 min default
  const startTime = new Date().toISOString();
  const startMs = Date.now();

  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "text", "--dangerously-skip-permissions"];
    if (opts?.model) args.push("--model", opts.model);

    const child = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      const endTime = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      resolve({ stdout, stderr, exitCode: code ?? 1, startTime, endTime, durationMs });
    });

    // Pipe the prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Run a Claude session and save the output to a trace file.
 */
export async function runAndTrace(
  prompt: string,
  cwd: string,
  traceDir: string,
  traceName: string,
  opts?: RunOptions
): Promise<RunResult> {
  await mkdir(traceDir, { recursive: true });

  const result = await runClaudeSession(prompt, cwd, opts);

  const promptChars = prompt.length;
  const estimatedTokens = Math.ceil(promptChars / 4);

  const traceContent = [
    `# Trace: ${traceName}`,
    ``,
    `- Timestamp: ${result.startTime}`,
    `- Exit code: ${result.exitCode}`,
    `- Duration: ${result.durationMs}ms`,
    `- Prompt size: ${(promptChars / 1024).toFixed(1)}KB (${promptChars} chars, ~${estimatedTokens} tokens)`,
    `- Output size: ${(result.stdout.length / 1024).toFixed(1)}KB`,
    opts?.model ? `- Model: ${opts.model}` : "",
    ``,
    `## Output`,
    ``,
    result.stdout,
    ``,
    result.stderr ? `## Stderr\n\n${result.stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await writeFile(path.join(traceDir, `${traceName}.md`), traceContent, "utf-8");

  return result;
}
