export interface CodexAgentConfig {
  codexPath?: string;
  defaultTimeoutSec?: number;
  noOutputTimeoutSec?: number;
  model?: string;
  projects?: Record<string, string>;
  maxConcurrent?: number;
  enableAgentTool?: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  skipGitRepoCheck?: boolean;
  prefixArgs?: string[];
  remote?: {
    enabled?: boolean;
    host: string;
    user: string;
    port?: number;
    keyPath?: string;
    strictHostKeyChecking?: "yes" | "no" | "accept-new";
    codexPath?: string;
  };
}

export interface RunOptions {
  codexPath: string;
  projectPath: string;
  prompt: string;
  mode: "agent" | "ask" | "plan";
  timeoutSec: number;
  noOutputTimeoutSec: number;
  model?: string;
  signal?: AbortSignal;
  continueSession?: boolean;
  resumeSessionId?: string;
  runId?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  skipGitRepoCheck?: boolean;
  prefixArgs?: string[];
  remote?: {
    enabled?: boolean;
    host: string;
    user: string;
    port?: number;
    keyPath?: string;
    strictHostKeyChecking?: "yes" | "no" | "accept-new";
    codexPath?: string;
  };
}

export interface ResultUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

interface BaseCollectedEvent {
  timestamp?: number;
}

export interface AssistantCollectedEvent extends BaseCollectedEvent {
  type: "assistant";
  text?: string;
}

export interface ReasoningCollectedEvent extends BaseCollectedEvent {
  type: "reasoning";
  text?: string;
}

export interface ResultCollectedEvent extends BaseCollectedEvent {
  type: "result";
}

export interface ToolStartCollectedEvent extends BaseCollectedEvent {
  type: "tool_start";
  toolName?: string;
  toolArgs?: string;
}

export type CollectedEvent =
  | AssistantCollectedEvent
  | ReasoningCollectedEvent
  | ResultCollectedEvent
  | ToolStartCollectedEvent;

export interface ResolvedBinary {
  nodeBin: string;
  entryScript: string;
}

export interface RunResult {
  success: boolean;
  resultText: string;
  sessionId?: string;
  durationMs: number;
  toolCallCount: number;
  error?: string;
  usage?: ResultUsage;
  events: CollectedEvent[];
  rawLines?: string[];
}

export interface ParsedCommand {
  project?: string;
  prompt?: string;
  mode?: "agent" | "ask" | "plan";
  continueSession?: boolean;
  resumeSessionId?: string;
  reload?: boolean;
  confirmRm?: boolean;
  confirmWrite?: boolean;
  confirmRisk?: boolean;
}
