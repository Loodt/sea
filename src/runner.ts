import { spawn } from "node:child_process";
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn a `claude -p` session with the given prompt.
 * Writes prompt to a temp file and pipes it via stdin to avoid shell escaping issues.
 * Each session gets a fresh context window.
 */
export async function runClaudeSession(
  prompt: string,
  cwd: string,
  opts?: { timeoutMs?: number }
): Promise<RunResult> {
  const timeoutMs = opts?.timeoutMs ?? 600_000; // 10 min default

  // Write prompt to temp file to avoid shell escaping issues with long prompts
  const tempDir = await mkdtemp(path.join(tmpdir(), "sea-"));
  const promptFile = path.join(tempDir, "prompt.txt");
  await writeFile(promptFile, prompt, "utf-8");

  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "text", "--dangerously-skip-permissions"],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: timeoutMs,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      rm(tempDir, { recursive: true }).catch(() => {});
      reject(err);
    });

    child.on("close", (code) => {
      rm(tempDir, { recursive: true }).catch(() => {});
      resolve({ stdout, stderr, exitCode: code ?? 1 });
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
  opts?: { timeoutMs?: number }
): Promise<RunResult> {
  await mkdir(traceDir, { recursive: true });

  const result = await runClaudeSession(prompt, cwd, opts);

  const promptChars = prompt.length;
  const estimatedTokens = Math.ceil(promptChars / 4);

  const traceContent = [
    `# Trace: ${traceName}`,
    ``,
    `- Timestamp: ${new Date().toISOString()}`,
    `- Exit code: ${result.exitCode}`,
    `- Prompt size: ${(promptChars / 1024).toFixed(1)}KB (${promptChars} chars, ~${estimatedTokens} tokens)`,
    `- Output size: ${(result.stdout.length / 1024).toFixed(1)}KB`,
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
