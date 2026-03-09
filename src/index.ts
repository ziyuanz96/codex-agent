import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { runCodexAgent } from "./runner.js";
import { formatRunResult } from "./formatter.js";
import { ensureShutdownHook, setMaxConcurrent } from "./process-registry.js";
import { createCodexAgentTool } from "./tool.js";
import type { CodexAgentConfig, ParsedCommand } from "./types.js";

const PLUGIN_ID = "codex-agent";
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_NO_OUTPUT_TIMEOUT_SEC = 120;
const DEFAULT_MODE = "agent" as const;
const RM_CONFIRM_TTL_MS = 60_000;
const MAX_RETRY = 1;
const DEFAULT_AUDIT_LOG = "/tmp/openclaw-codex-agent-audit.log";
const rmConfirmCache = new Map<string, number>();
const retryCounter = new Map<string, number>();

function detectCodexPath(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where codex" : "which codex";
    const result = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    const first = result.split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return first;
  } catch {}
  return null;
}

function defaultConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return join(home, ".openclaw", "openclaw.json");
}

function loadProjectsFromConfig(configPath: string): Record<string, string> | null {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    return cfg?.plugins?.entries?.["codex-agent"]?.config?.projects ?? null;
  } catch {
    return null;
  }
}

function hasDangerousPath(prompt: string): boolean {
  const patterns = [
    /\.{2}\/\.{2}/,
    /(^|\s)\/etc(\/|\s|$)/i,
    /(^|\s)\/root(\/|\s|$)/i,
    /(^|\s)~\/.ssh(\/|\s|$)/i,
    /(^|\s)\/home\/[^\s]+\/.ssh(\/|\s|$)/i,
    /(^|\s)\/var\/lib(\/|\s|$)/i,
  ];
  return patterns.some((re) => re.test(prompt));
}

function hasRmIntent(prompt: string): boolean {
  return /(\brm\b|rm\s+-rf|删除|移除|删掉|remove\s+file|remove\s+dir)/i.test(prompt);
}

function nowMs(): number {
  return Date.now();
}

function makeRmKey(userId: string, project: string, prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim().slice(0, 200);
  return `${userId}::${project}::${normalized}`;
}

function setRmConfirm(key: string): void {
  rmConfirmCache.set(key, nowMs());
}

function hasFreshRmConfirm(key: string): boolean {
  const at = rmConfirmCache.get(key);
  if (!at) return false;
  if (nowMs() - at > RM_CONFIRM_TTL_MS) {
    rmConfirmCache.delete(key);
    return false;
  }
  return true;
}

function clearRmConfirm(key: string): void {
  rmConfirmCache.delete(key);
}

function writeAudit(logPath: string, data: Record<string, unknown>): void {
  try {
    appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n");
  } catch {
    // ignore audit failures
  }
}

export function parseCommandArgs(args: string): ParsedCommand | { error: string } {
  if (!args?.trim()) {
    return {
      error:
        "Usage: /codex <project> <prompt>\n\nOptions:\n  reload              Reload project allowlist from config\n  --continue          Continue last session\n  --resume <id>       Resume a specific session\n  --mode <mode>       Set mode (agent|ask|plan)\n  --confirm-rm        Confirm dangerous delete operation",
    };
  }

  const tokens = tokenize(args.trim());
  if (tokens.length === 0) return { error: "Missing project parameter" };

  if (tokens.length === 1 && tokens[0] === "reload") {
    return { reload: true };
  }

  const project = tokens[0]!;
  let mode: "agent" | "ask" | "plan" = DEFAULT_MODE;
  let continueSession = false;
  let resumeSessionId: string | undefined;
  let confirmRm = false;
  const promptParts: string[] = [];

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token === "--continue") {
      continueSession = true;
      i++;
    } else if (token === "--confirm-rm") {
      confirmRm = true;
      i++;
    } else if (token === "--resume") {
      i++;
      if (i >= tokens.length) return { error: "--resume requires a session id" };
      resumeSessionId = tokens[i]!;
      i++;
    } else if (token === "--mode") {
      i++;
      if (i >= tokens.length) return { error: "--mode requires a mode (agent|ask|plan)" };
      const m = tokens[i]! as "agent" | "ask" | "plan";
      if (!["agent", "ask", "plan"].includes(m)) {
        return { error: `Unsupported mode: ${m}, available: agent, ask, plan` };
      }
      mode = m;
      i++;
    } else {
      promptParts.push(tokens.slice(i).join(" "));
      break;
    }
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) return { error: "Missing prompt parameter" };

  return { project, prompt, mode, continueSession, resumeSessionId, confirmRm };
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

export default {
  id: PLUGIN_ID,
  configSchema: { type: "object" as const },

  register(api: any) {
    const cfg: CodexAgentConfig & { auditLogPath?: string } = api.pluginConfig ?? {};
    const codexPath = cfg.codexPath || detectCodexPath() || "codex";
    if (!cfg.remote?.enabled && !detectCodexPath() && !cfg.codexPath) {
      console.warn(`[${PLUGIN_ID}] codex CLI not found locally (set codexPath or enable remote mode), plugin disabled`);
      return;
    }

    if (cfg.maxConcurrent) setMaxConcurrent(cfg.maxConcurrent);
    ensureShutdownHook();

    const configPath = defaultConfigPath();
    let projects = cfg.projects ?? {};

    const projectList = () => {
      const names = Object.keys(projects);
      return names.length > 0 ? names.join(", ") : "none";
    };

    api.registerCommand({
      name: "codex",
      description: `Invoke Codex CLI with strict project allowlist. Available projects: ${projectList()}`,
      acceptsArgs: true,
      requireAuth: false,

      async handler(ctx: any) {
        const parsed = parseCommandArgs(ctx.args ?? "");
        if ("error" in parsed) return { text: parsed.error };

        if (parsed.reload) {
          const loaded = loadProjectsFromConfig(configPath);
          if (loaded && typeof loaded === "object") {
            projects = loaded;
            return { text: `✅ codex projects reloaded. Available: ${Object.keys(projects).join(", ") || "none"}` };
          }
          return { text: `❌ reload failed: cannot read projects from ${configPath}` };
        }

        const userId = String(ctx?.senderId ?? ctx?.userId ?? "unknown");
        const projectPath = resolveProjectPath(parsed.project!, projects);
        if (!projectPath) {
          writeAudit(cfg.auditLogPath ?? DEFAULT_AUDIT_LOG, { action: "reject", reason: "project_not_allowed", userId, project: parsed.project });
          return { text: `Project not found or not allowed: ${parsed.project}\nAvailable: ${projectList()}` };
        }

        if (hasDangerousPath(parsed.prompt!)) {
          writeAudit(cfg.auditLogPath ?? DEFAULT_AUDIT_LOG, { action: "reject", reason: "dangerous_path", userId, project: parsed.project });
          return { text: "❌ Blocked: detected risky path traversal / out-of-sandbox path in prompt. Please operate within project allowlist only." };
        }

        const rmKey = makeRmKey(userId, parsed.project!, parsed.prompt!);
        if (hasRmIntent(parsed.prompt!)) {
          if (parsed.confirmRm) {
            if (!hasFreshRmConfirm(rmKey)) {
              setRmConfirm(rmKey);
              writeAudit(cfg.auditLogPath ?? DEFAULT_AUDIT_LOG, { action: "rm_confirm_requested", userId, project: parsed.project });
              return { text: "⚠️ Delete confirmation expired or missing. Re-run the SAME command once more with `--confirm-rm` within 60s to execute." };
            }
            clearRmConfirm(rmKey);
          } else {
            setRmConfirm(rmKey);
            writeAudit(cfg.auditLogPath ?? DEFAULT_AUDIT_LOG, { action: "rm_blocked_needs_confirm", userId, project: parsed.project });
            return { text: "⚠️ Detected delete intent (rm/remove). Re-run with `--confirm-rm` within 60s if you really want to execute deletion." };
          }
        }

        const requestKey = `${userId}::${parsed.project}::${(parsed.prompt ?? "").slice(0, 120)}`;
        let result = await runCodexAgent({
          codexPath,
          projectPath,
          prompt: parsed.prompt!,
          mode: parsed.mode ?? DEFAULT_MODE,
          timeoutSec: cfg.defaultTimeoutSec ?? DEFAULT_TIMEOUT_SEC,
          noOutputTimeoutSec: cfg.noOutputTimeoutSec ?? DEFAULT_NO_OUTPUT_TIMEOUT_SEC,
          model: cfg.model,
          prefixArgs: cfg.prefixArgs,
          continueSession: parsed.continueSession,
          resumeSessionId: parsed.resumeSessionId,
          sandbox: cfg.sandbox ?? "workspace-write",
          skipGitRepoCheck: cfg.skipGitRepoCheck ?? true,
          remote: cfg.remote,
        });

        if (!result.success) {
          const cnt = (retryCounter.get(requestKey) ?? 0);
          if (cnt < MAX_RETRY) {
            retryCounter.set(requestKey, cnt + 1);
            result = await runCodexAgent({
              codexPath,
              projectPath,
              prompt: parsed.prompt!,
              mode: parsed.mode ?? DEFAULT_MODE,
              timeoutSec: cfg.defaultTimeoutSec ?? DEFAULT_TIMEOUT_SEC,
              noOutputTimeoutSec: cfg.noOutputTimeoutSec ?? DEFAULT_NO_OUTPUT_TIMEOUT_SEC,
              model: cfg.model,
              prefixArgs: cfg.prefixArgs,
              continueSession: parsed.continueSession,
              resumeSessionId: parsed.resumeSessionId,
              sandbox: cfg.sandbox ?? "workspace-write",
              skipGitRepoCheck: cfg.skipGitRepoCheck ?? true,
              remote: cfg.remote,
            });
          }
        }
        retryCounter.delete(requestKey);

        writeAudit(cfg.auditLogPath ?? DEFAULT_AUDIT_LOG, {
          action: "run",
          userId,
          project: parsed.project,
          success: result.success,
          error: result.error,
          sessionId: result.sessionId,
          durationMs: result.durationMs,
        });

        const messages = formatRunResult(result);
        return { text: messages.join("\n\n---\n\n") };
      },
    });

    if (cfg.enableAgentTool === true && Object.keys(projects).length > 0) {
      api.registerTool(createCodexAgentTool({ codexPath, projects, cfg }), { name: "codex_agent", optional: true });
    }

    console.log(`[${PLUGIN_ID}] registered /codex (codex: ${codexPath}, projects: ${projectList()})`);
  },
};

export function resolveProjectPath(projectKey: string, projects: Record<string, string>): string | null {
  if (projects[projectKey]) return projects[projectKey]!;
  const lowerKey = projectKey.toLowerCase();
  for (const [name, path] of Object.entries(projects)) {
    if (name.toLowerCase() === lowerKey) return path;
  }
  return null;
}
