import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCodexAgent } from "./runner.js";
import { formatRunResult } from "./formatter.js";
import { ensureShutdownHook, setMaxConcurrent } from "./process-registry.js";
import { createCodexAgentTool } from "./tool.js";
import type { CodexAgentConfig, ParsedCommand } from "./types.js";

const PLUGIN_ID = "codex-agent";
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_NO_OUTPUT_TIMEOUT_SEC = 120;
const DEFAULT_MODE = "agent" as const;
const RISK_CONFIRM_TTL_MS = 60_000;
const MAX_RETRY = 1;
const DEFAULT_AUDIT_LOG = "/tmp/openclaw-codex-agent-audit.log";
const riskConfirmCache = new Map<string, number>();
const retryCounter = new Map<string, number>();

type RiskIntent = "delete" | "write";

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

function loadPluginConfig(configPath: string): { projects?: Record<string, string> } | null {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    return cfg?.plugins?.entries?.[PLUGIN_ID]?.config ?? null;
  } catch {
    return null;
  }
}

function hasDangerousPath(prompt: string): boolean {
  const patterns = [
    /\.\.\/\.\./,
    /(^|\s)\/etc(\/|\s|$)/i,
    /(^|\s)\/root(\/|\s|$)/i,
    /(^|\s)~\/.ssh(\/|\s|$)/i,
    /(^|\s)\/home\/[^\s]+\/.ssh(\/|\s|$)/i,
    /(^|\s)\/var\/lib(\/|\s|$)/i,
  ];
  return patterns.some((re) => re.test(prompt));
}

function detectRiskIntent(prompt: string): RiskIntent | null {
  if (/(\brm\b|rm\s+-rf|删除|移除|删掉|remove\s+file|remove\s+dir|删除目录)/i.test(prompt)) {
    return "delete";
  }

  if (/(覆盖|覆写|truncate|overwrite|replace\s+all|批量修改|批量更新|chmod|chown|rename\s+.*\s+to\s+.*|mv\s+.*\s+.*)/i.test(prompt)) {
    return "write";
  }

  return null;
}

function nowMs(): number {
  return Date.now();
}

function makeRiskKey(userId: string, project: string, intent: RiskIntent, prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim().slice(0, 240);
  return `${userId}::${project}::${intent}::${normalized}`;
}

function setRiskConfirm(key: string): void {
  riskConfirmCache.set(key, nowMs());
}

function hasFreshRiskConfirm(key: string): boolean {
  const at = riskConfirmCache.get(key);
  if (!at) return false;
  if (nowMs() - at > RISK_CONFIRM_TTL_MS) {
    riskConfirmCache.delete(key);
    return false;
  }
  return true;
}

function clearRiskConfirm(key: string): void {
  riskConfirmCache.delete(key);
}

function writeAudit(logPath: string, data: Record<string, unknown>): void {
  try {
    appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), plugin: PLUGIN_ID, ...data }) + "\n");
  } catch {
    // ignore audit failures
  }
}

function isSafeProjectKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(key);
}

function validateProjects(projects: Record<string, string>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const entries = Object.entries(projects);
  if (entries.length === 0) {
    errors.push("projects map is empty");
  }

  for (const [key, path] of entries) {
    if (!isSafeProjectKey(key)) errors.push(`invalid key: ${key}`);
    if (typeof path !== "string" || path.trim().length === 0) {
      errors.push(`invalid path for ${key}: empty`);
      continue;
    }
    if (!path.startsWith("/")) {
      errors.push(`invalid path for ${key}: must be absolute path`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function diffProjects(prev: Record<string, string>, next: Record<string, string>): { added: string[]; removed: string[]; changed: string[] } {
  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));

  const added = [...nextKeys].filter((k) => !prevKeys.has(k)).sort();
  const removed = [...prevKeys].filter((k) => !nextKeys.has(k)).sort();
  const changed = [...nextKeys].filter((k) => prevKeys.has(k) && prev[k] !== next[k]).sort();

  return { added, removed, changed };
}

export function parseCommandArgs(args: string): ParsedCommand | { error: string } {
  if (!args?.trim()) {
    return {
      error:
        "Usage: /codex <project> <prompt>\n\nOptions:\n  reload                 Reload project allowlist from config\n  --continue             Continue last session\n  --resume <id>          Resume a specific session\n  --mode <mode>          Set mode (agent|ask|plan)\n  --confirm-rm           Confirm risky delete operations\n  --confirm-write        Confirm risky write operations\n  --confirm-risk         Confirm any risky operation",
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
  let confirmWrite = false;
  let confirmRisk = false;
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
    } else if (token === "--confirm-write") {
      confirmWrite = true;
      i++;
    } else if (token === "--confirm-risk") {
      confirmRisk = true;
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

  return { project, prompt, mode, continueSession, resumeSessionId, confirmRm, confirmWrite, confirmRisk };
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
    
    // 远程模式下跳过本地 codex 检测
    const codexPath = cfg.remote?.enabled 
      ? (cfg.remote.codexPath || "codex")
      : (cfg.codexPath || detectCodexPath() || "codex");
    
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

        const auditLogPath = cfg.auditLogPath ?? DEFAULT_AUDIT_LOG;
        const userId = String(ctx?.senderId ?? ctx?.userId ?? "unknown");
        const requestId = randomUUID();

        if (parsed.reload) {
          const loaded = loadPluginConfig(configPath);
          if (!loaded || typeof loaded !== "object" || !loaded.projects || typeof loaded.projects !== "object") {
            writeAudit(auditLogPath, { requestId, action: "reload", result: "rejected", reason: "projects_missing", userId });
            return { text: `❌ reload failed: cannot read projects from ${configPath}` };
          }

          const validation = validateProjects(loaded.projects);
          if (!validation.ok) {
            writeAudit(auditLogPath, {
              requestId,
              action: "reload",
              result: "rejected",
              reason: "validation_failed",
              userId,
              errors: validation.errors,
            });
            return { text: `❌ reload blocked: invalid projects config\n- ${validation.errors.join("\n- ")}` };
          }

          const delta = diffProjects(projects, loaded.projects);
          projects = loaded.projects;

          writeAudit(auditLogPath, {
            requestId,
            action: "reload",
            result: "success",
            userId,
            added: delta.added,
            removed: delta.removed,
            changed: delta.changed,
            total: Object.keys(projects).length,
          });

          return {
            text: [
              `✅ codex projects reloaded. Available: ${Object.keys(projects).join(", ") || "none"}`,
              `Δ added: ${delta.added.join(", ") || "none"}`,
              `Δ removed: ${delta.removed.join(", ") || "none"}`,
              `Δ changed: ${delta.changed.join(", ") || "none"}`,
            ].join("\n"),
          };
        }

        const projectPath = resolveProjectPath(parsed.project!, projects);
        if (!projectPath) {
          writeAudit(auditLogPath, {
            requestId,
            action: "run",
            result: "rejected",
            reason: "project_not_allowed",
            userId,
            project: parsed.project,
          });
          return { text: `Project not found or not allowed: ${parsed.project}\nAvailable: ${projectList()}` };
        }

        if (hasDangerousPath(parsed.prompt!)) {
          writeAudit(auditLogPath, {
            requestId,
            action: "run",
            result: "rejected",
            reason: "dangerous_path",
            userId,
            project: parsed.project,
          });
          return { text: "❌ Blocked: detected risky path traversal / out-of-sandbox path in prompt. Please operate within project allowlist only." };
        }

        const riskIntent = detectRiskIntent(parsed.prompt!);
        if (riskIntent) {
          const riskKey = makeRiskKey(userId, parsed.project!, riskIntent, parsed.prompt!);
          const confirmed = parsed.confirmRisk || (riskIntent === "delete" ? parsed.confirmRm : parsed.confirmWrite);

          if (confirmed) {
            if (!hasFreshRiskConfirm(riskKey)) {
              setRiskConfirm(riskKey);
              writeAudit(auditLogPath, {
                requestId,
                action: "run",
                result: "blocked",
                reason: "risk_confirm_missing_or_expired",
                userId,
                project: parsed.project,
                riskIntent,
              });
              return { text: `⚠️ ${riskIntent === "delete" ? "Delete" : "Write"} confirmation expired or missing. Re-run the SAME command once more with \`--confirm-${riskIntent === "delete" ? "rm" : "write"}\` (or \`--confirm-risk\`) within 60s.` };
            }
            clearRiskConfirm(riskKey);
          } else {
            setRiskConfirm(riskKey);
            writeAudit(auditLogPath, {
              requestId,
              action: "run",
              result: "blocked",
              reason: "risk_confirm_required",
              userId,
              project: parsed.project,
              riskIntent,
            });
            return { text: `⚠️ Detected risky ${riskIntent} intent. Re-run with \`--confirm-${riskIntent === "delete" ? "rm" : "write"}\` (or \`--confirm-risk\`) within 60s if you want to continue.` };
          }
        }

        const requestKey = `${userId}::${parsed.project}::${(parsed.prompt ?? "").slice(0, 120)}`;
        const startedAt = nowMs();
        let retries = 0;

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
          const cnt = retryCounter.get(requestKey) ?? 0;
          if (cnt < MAX_RETRY) {
            retries = 1;
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

        writeAudit(auditLogPath, {
          requestId,
          action: "run",
          result: result.success ? "success" : "failed",
          userId,
          project: parsed.project,
          mode: parsed.mode ?? DEFAULT_MODE,
          riskIntent,
          retries,
          durationMs: nowMs() - startedAt,
          error: result.error,
          sessionId: result.sessionId,
          toolCallCount: result.toolCallCount,
        });

        const messages = formatRunResult(result);
        return { text: messages.join("\n\n---\n\n") };
      },
    });

    if (cfg.enableAgentTool === true && Object.keys(projects).length > 0) {
      api.registerTool(createCodexAgentTool({ codexPath, projects, cfg }), { name: "codex_agent", optional: true });
    }

    // 美观的注册日志（带时间戳和颜色，与其他插件对齐）
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0];
    const gray = '\x1b[90m';
    const purple = '\x1b[35m';
    const cyan = '\x1b[36m';
    const reset = '\x1b[0m';
    const mode = cfg.remote?.enabled ? `remote (${cfg.remote.host})` : "local";
    console.log(`${gray}${timestamp}${reset} ${purple}[plugins]${reset} ${cyan}${PLUGIN_ID}:${reset} ${cyan}Registered /codex command${reset}`);
    console.log(`${gray}${timestamp}${reset} ${purple}[plugins]${reset} ${cyan}${PLUGIN_ID}:${reset} ${cyan}mode: ${mode}${reset}`);
    console.log(`${gray}${timestamp}${reset} ${purple}[plugins]${reset} ${cyan}${PLUGIN_ID}:${reset} ${cyan}codex: ${codexPath}${reset}`);
    console.log(`${gray}${timestamp}${reset} ${purple}[plugins]${reset} ${cyan}${PLUGIN_ID}:${reset} ${cyan}projects: ${projectList()}${reset}`);
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
