import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { parseStreamLine } from "./parser.js";
import * as registry from "./process-registry.js";
import type { RunOptions, RunResult, CollectedEvent, ResultUsage } from "./types.js";

function shQuote(v: string): string {
  return `'${v.replace(/'/g, `'"'"'`)}'`;
}

function buildCodexArgs(opts: RunOptions): string[] {
  const cliArgs: string[] = [
    "exec",
    "--json",
    "--cd", opts.projectPath,
    "--sandbox", opts.sandbox ?? "workspace-write",
  ];

  if (opts.skipGitRepoCheck !== false) {
    cliArgs.push("--skip-git-repo-check");
  }

  if (opts.model) {
    cliArgs.push("--model", opts.model);
  }

  if (opts.resumeSessionId) {
    cliArgs.push("resume", opts.resumeSessionId);
  } else if (opts.continueSession) {
    cliArgs.push("resume", "--last");
  }

  cliArgs.push(...(opts.prefixArgs ?? []));
  cliArgs.push(opts.prompt);
  return cliArgs;
}

function buildCommand(opts: RunOptions): { cmd: string; args: string[]; shell: boolean } {
  const cliArgs = buildCodexArgs(opts);

  if (opts.remote?.enabled) {
    const sshArgs: string[] = [];
    if (opts.remote.port) sshArgs.push("-p", String(opts.remote.port));
    if (opts.remote.keyPath) sshArgs.push("-i", opts.remote.keyPath);
    sshArgs.push("-o", `StrictHostKeyChecking=${opts.remote.strictHostKeyChecking ?? "accept-new"}`);

    const remoteCodex = opts.remote.codexPath || opts.codexPath || "codex";
    const remoteCmd = [remoteCodex, ...cliArgs].map(shQuote).join(" ");

    sshArgs.push(`${opts.remote.user}@${opts.remote.host}`);
    sshArgs.push(remoteCmd);

    return { cmd: "ssh", args: sshArgs, shell: false };
  }

  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(opts.codexPath);
  return { cmd: opts.codexPath, args: cliArgs, shell: needsShell };
}

export async function runCodexAgent(opts: RunOptions): Promise<RunResult> {
  if (registry.isFull()) {
    return {
      success: false,
      resultText: `Concurrency limit reached (${registry.getActiveCount()}), please try again later`,
      durationMs: 0,
      toolCallCount: 0,
      error: "max concurrency reached",
      events: [],
    };
  }

  const runId = opts.runId ?? randomUUID();
  const startTime = Date.now();
  const { cmd, args, shell } = buildCommand(opts);

  const isUnix = process.platform !== "win32";
  const proc = spawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell,
    detached: isUnix,
  });
  if (isUnix) proc.unref();

  registry.register(runId, { proc, projectPath: opts.projectPath, startTime });

  let sessionId: string | undefined;
  let resultText = "";
  let completed = false;
  let error: string | undefined;
  let usage: ResultUsage | undefined;
  let lastOutputTime = Date.now();
  const events: CollectedEvent[] = [];
  const rawLines: string[] = [];

  const terminateProcess = () => {
    if (proc.exitCode !== null || proc.killed) return;
    registry.killWithGrace(proc);
  };

  const totalTimeout = setTimeout(() => {
    if (!completed) {
      error = `total timeout (${opts.timeoutSec}s)`;
      terminateProcess();
    }
  }, opts.timeoutSec * 1000);

  const noOutputCheck = setInterval(() => {
    if (Date.now() - lastOutputTime > opts.noOutputTimeoutSec * 1000) {
      if (!completed) {
        error = `no output timeout (${opts.noOutputTimeoutSec}s)`;
        terminateProcess();
      }
    }
  }, 5000);

  const onAbort = () => {
    if (!completed) {
      error = "aborted";
      terminateProcess();
    }
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise<RunResult>((resolve) => {
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

    rl.on("line", (line) => {
      rawLines.push(line);
      lastOutputTime = Date.now();
      const event = parseStreamLine(line);
      if (!event) return;

      if (event.type === "thread.started") {
        sessionId = event.thread_id;
        return;
      }

      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        const text = String(event.item?.text ?? "");
        if (text) {
          resultText = text;
          events.push({ type: "assistant", text });
        }
        return;
      }

      if (event.type === "item.completed" && event.item?.type === "reasoning") {
        const text = String(event.item?.text ?? "");
        if (text) events.push({ type: "reasoning", text });
        return;
      }

      if (event.type === "turn.completed") {
        usage = {
          inputTokens: event.usage?.input_tokens,
          outputTokens: event.usage?.output_tokens,
          cachedInputTokens: event.usage?.cached_input_tokens,
        };
        completed = true;
        events.push({ type: "result" });
      }
    });

    proc.stderr?.on("data", (buf) => {
      const s = String(buf || "").trim();
      if (!s) return;
      rawLines.push(s);
      if (!error) error = s;
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      clearTimeout(totalTimeout);
      clearInterval(noOutputCheck);
      opts.signal?.removeEventListener("abort", onAbort);
      registry.unregister(runId);

      const durationMs = Date.now() - startTime;
      const fallbackText = rawLines.filter(Boolean).slice(-20).join("\n");

      resolve({
        success: !error && completed,
        resultText: resultText || (error ? `Codex execution failed: ${error}` : (fallbackText || "No analysis result obtained")),
        sessionId,
        durationMs,
        toolCallCount: 0,
        error,
        usage,
        events,
        rawLines,
      });
    };

    proc.on("close", cleanup);
    proc.on("error", (err) => {
      error = err.message;
      cleanup();
    });
  });
}
