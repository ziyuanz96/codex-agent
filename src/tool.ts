import { runCodexAgent } from "./runner.js";
import { formatRunResult } from "./formatter.js";
import type { CodexAgentConfig } from "./types.js";

function resolveProjectPath(projectKey: string, projects: Record<string, string>): string | null {
  if (projects[projectKey]) return projects[projectKey]!;
  const lowerKey = projectKey.toLowerCase();
  for (const [name, path] of Object.entries(projects)) {
    if (name.toLowerCase() === lowerKey) return path;
  }
  return null;
}

export function createCodexAgentTool(params: {
  codexPath: string;
  projects: Record<string, string>;
  cfg: CodexAgentConfig;
}) {
  const projectNames = Object.keys(params.projects);
  const projectListStr = projectNames.join(", ");

  return () => ({
    name: "codex_agent",
    label: "Codex Agent",
    description: `Invoke local Codex CLI on allowlisted projects only. Projects: ${projectListStr}`,
    parameters: {
      type: "object" as const,
      properties: {
        project: { type: "string" as const },
        prompt: { type: "string" as const },
      },
      required: ["project", "prompt"],
    },

    async execute(_toolCallId: string, args: Record<string, unknown>, signal?: AbortSignal) {
      const project = String(args.project ?? "");
      const prompt = String(args.prompt ?? "");
      const projectPath = resolveProjectPath(project, params.projects);
      if (!projectPath) {
        return { content: [{ type: "text", text: `Project not found or not allowed: ${project}` }] };
      }

      const result = await runCodexAgent({
        codexPath: params.codexPath,
        projectPath,
        prompt,
        mode: "ask",
        timeoutSec: params.cfg.defaultTimeoutSec ?? 600,
        noOutputTimeoutSec: params.cfg.noOutputTimeoutSec ?? 120,
        model: params.cfg.model,
        signal,
        sandbox: params.cfg.sandbox ?? "workspace-write",
        skipGitRepoCheck: params.cfg.skipGitRepoCheck ?? true,
        remote: params.cfg.remote,
      });

      return { content: [{ type: "text", text: formatRunResult(result).join("\n\n") }] };
    },
  });
}
