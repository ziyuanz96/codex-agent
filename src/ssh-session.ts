import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface RemoteConfig {
  enabled?: boolean;
  host: string;
  user: string;
  port?: number;
  keyPath?: string;
  strictHostKeyChecking?: "yes" | "no" | "accept-new";
}

interface SshSession {
  key: string;
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  queue: CommandWaiter[];
  createdAt: number;
  lastActiveAt: number;
  cwd: string;
}

interface CommandWaiter {
  markerId: string;
  timeout: NodeJS.Timeout;
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
}

export interface CommandResult {
  output: string;
  exitCode: number;
  cwd: string;
}

const sessions = new Map<string, SshSession>();
let shutdownRegistered = false;

function now() {
  return Date.now();
}

function q(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function registerShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const closeAll = () => {
    for (const [key, s] of sessions) {
      try {
        s.proc.stdin.write("exit\n");
      } catch {}
      try {
        s.proc.kill("SIGTERM");
      } catch {}
      sessions.delete(key);
    }
  };
  process.on("exit", closeAll);
  process.on("SIGINT", closeAll);
  process.on("SIGTERM", closeAll);
}

function sessionKey(userId: string, project: string): string {
  return `${userId}::${project}`;
}

function attachParser(s: SshSession): void {
  const onData = (chunk: Buffer) => {
    s.buffer += chunk.toString("utf8");
    consumeQueue(s);
  };
  s.proc.stdout.on("data", onData);
  s.proc.stderr.on("data", onData);

  const onExit = () => {
    for (const waiter of s.queue.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("SSH session closed"));
    }
    sessions.delete(s.key);
  };

  s.proc.on("close", onExit);
  s.proc.on("exit", onExit);
}

function consumeQueue(s: SshSession): void {
  if (s.queue.length === 0) return;
  const head = s.queue[0]!;
  const begin = `__OC_BEGIN_${head.markerId}__\n`;
  const endPrefix = `\n__OC_END_${head.markerId}__:`;

  const beginIdx = s.buffer.indexOf(begin);
  if (beginIdx < 0) return;
  const endIdx = s.buffer.indexOf(endPrefix, beginIdx + begin.length);
  if (endIdx < 0) return;

  const afterEndIdx = s.buffer.indexOf("\n", endIdx + endPrefix.length);
  if (afterEndIdx < 0) return;

  const body = s.buffer.slice(beginIdx + begin.length, endIdx);
  const endLine = s.buffer.slice(endIdx + endPrefix.length, afterEndIdx).trim();
  const exitCode = Number.parseInt(endLine, 10);

  let output = body;
  let cwd = s.cwd;
  const pwdMarker = "\n__OC_PWD__";
  const pwdIdx = body.lastIndexOf(pwdMarker);
  if (pwdIdx >= 0) {
    output = body.slice(0, pwdIdx);
    cwd = body.slice(pwdIdx + pwdMarker.length).trim() || cwd;
  }

  s.cwd = cwd;
  s.lastActiveAt = now();
  s.buffer = s.buffer.slice(afterEndIdx + 1);

  s.queue.shift();
  clearTimeout(head.timeout);
  head.resolve({
    output: output.trimEnd(),
    exitCode: Number.isNaN(exitCode) ? 1 : exitCode,
    cwd,
  });

  consumeQueue(s);
}

function enqueueCommand(s: SshSession, rawCommand: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const markerId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const waiter: CommandWaiter = {
      markerId,
      resolve,
      reject,
      timeout: setTimeout(() => {
        const idx = s.queue.findIndex((x) => x.markerId === markerId);
        if (idx >= 0) s.queue.splice(idx, 1);
        reject(new Error(`SSH command timeout after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs),
    };

    s.queue.push(waiter);

    const script = [
      `printf '__OC_BEGIN_${markerId}__\\n'`,
      rawCommand,
      "__oc_ec=$?",
      "printf '\\n__OC_PWD__%s' \"$PWD\"",
      `printf '\\n__OC_END_${markerId}__:%s\\n' \"$__oc_ec\"`,
    ].join("\n");

    try {
      s.proc.stdin.write(script + "\n");
    } catch (e: any) {
      clearTimeout(waiter.timeout);
      s.queue = s.queue.filter((x) => x !== waiter);
      reject(new Error(`Failed to send command: ${e?.message ?? String(e)}`));
    }
  });
}

export function startSshSession(params: {
  userId: string;
  project: string;
  projectPath: string;
  remote: RemoteConfig;
}): { ok: true; key: string; reused: boolean; cwd: string } | { ok: false; error: string } {
  registerShutdown();

  const key = sessionKey(params.userId, params.project);
  const existing = sessions.get(key);
  if (existing && existing.proc.exitCode == null && !existing.proc.killed) {
    return { ok: true, key, reused: true, cwd: existing.cwd };
  }

  const sshArgs: string[] = [];
  if (params.remote.port) sshArgs.push("-p", String(params.remote.port));
  if (params.remote.keyPath) sshArgs.push("-i", params.remote.keyPath);
  sshArgs.push("-o", `StrictHostKeyChecking=${params.remote.strictHostKeyChecking ?? "accept-new"}`);
  sshArgs.push(`${params.remote.user}@${params.remote.host}`);
  sshArgs.push("bash", "-il");

  const proc = spawn("ssh", sshArgs, { stdio: "pipe" });

  const session: SshSession = {
    key,
    proc,
    buffer: "",
    queue: [],
    createdAt: now(),
    lastActiveAt: now(),
    cwd: params.projectPath,
  };

  attachParser(session);
  sessions.set(key, session);

  enqueueCommand(session, `cd ${q(params.projectPath)}`, 15_000).catch(() => {
    // keep session, user may still run commands and inspect errors
  });

  return { ok: true, key, reused: false, cwd: params.projectPath };
}

export async function runSshCommand(params: {
  userId: string;
  project: string;
  command: string;
  timeoutSec: number;
}): Promise<{ ok: true; result: CommandResult } | { ok: false; error: string }> {
  const key = sessionKey(params.userId, params.project);
  const s = sessions.get(key);
  if (!s || s.proc.exitCode != null || s.proc.killed) {
    return { ok: false, error: `No active SSH session for project '${params.project}'. Run /ssh start ${params.project} first.` };
  }

  try {
    const result = await enqueueCommand(s, params.command, Math.max(5, params.timeoutSec) * 1000);
    return { ok: true, result };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export function stopSshSession(params: { userId: string; project: string }): { ok: boolean; message: string } {
  const key = sessionKey(params.userId, params.project);
  const s = sessions.get(key);
  if (!s) return { ok: false, message: `No active SSH session for project '${params.project}'.` };

  try {
    s.proc.stdin.write("exit\n");
  } catch {}
  try {
    s.proc.kill("SIGTERM");
  } catch {}

  sessions.delete(key);
  return { ok: true, message: `SSH session stopped for '${params.project}'.` };
}

export function getSshSessionStatus(params: { userId: string; project?: string }): { key: string; project: string; cwd: string; createdAt: number; lastActiveAt: number }[] {
  const prefix = `${params.userId}::`;
  const entries: { key: string; project: string; cwd: string; createdAt: number; lastActiveAt: number }[] = [];

  for (const [key, s] of sessions) {
    if (!key.startsWith(prefix)) continue;
    const project = key.slice(prefix.length);
    if (params.project && project !== params.project) continue;
    entries.push({
      key,
      project,
      cwd: s.cwd,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    });
  }

  return entries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
