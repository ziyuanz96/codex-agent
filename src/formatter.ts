import type { CollectedEvent, RunResult } from "./types.js";

/** Maximum characters per message */
const MAX_MESSAGE_LENGTH = 3800;

/**
 * Format execution results into a concise summary. Layout order:
 * 1. Status line (✅/❌)
 * 2. Tool call summary (if any)
 * 3. Agent conclusion (main content, most prominent)
 * 4. Stats + session ID (footer, metadata grouped at bottom)
 */
export function formatRunResult(result: RunResult): string[] {
  const sections: string[] = [];

  sections.push(buildHeader(result));

  const fileSummary = buildFileSummary(result.events);
  if (fileSummary) sections.push(fileSummary);

  const conclusion = buildConclusion(result.events);
  if (conclusion) sections.push(conclusion);

  sections.push(buildFooter(result));

  return splitMessages(sections);
}

function buildHeader(result: RunResult): string {
  const status = result.success ? "✅" : "❌";
  const statusText = result.success ? "Completed" : "Failed";
  return `${status} **Codex Agent** ${statusText}`;
}

/** Extract file modification summary from tool call events */
function buildFileSummary(events: CollectedEvent[]): string {
  const toolPairs = collectToolPairs(events);
  if (toolPairs.length === 0) return "";

  const lines: string[] = ["**Tool Calls:**"];
  for (const pair of toolPairs) {
    const icon = getToolIcon(pair.name);
    const target = pair.args ? ` \`${pair.args}\`` : "";
    lines.push(`${icon} ${pair.name}${target}`);
  }
  return lines.join("\n");
}

interface ToolPair {
  name: string;
  args: string;
}

/** Collect tool_start events into pairs */
function collectToolPairs(events: CollectedEvent[]): ToolPair[] {
  const pairs: ToolPair[] = [];
  for (const event of events) {
    if (event.type === "tool_start") {
      pairs.push({
        name: event.toolName ?? "unknown",
        args: event.toolArgs ?? "",
      });
    }
  }
  return pairs;
}

function getToolIcon(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes("edit") || name.includes("write") || name.includes("replace")) return "📝";
  if (name.includes("read") || name.includes("view")) return "📖";
  if (name.includes("shell") || name.includes("bash") || name.includes("command")) return "⚙️";
  if (name.includes("search") || name.includes("grep") || name.includes("glob") || name.includes("find")) return "🔍";
  if (name.includes("delete") || name.includes("remove")) return "🗑️";
  if (name.includes("list")) return "📋";
  return "🔧";
}

/** Extract the Agent's final conclusion (last assistant message) */
function buildConclusion(events: CollectedEvent[]): string {
  let lastAssistantText = "";
  for (const event of events) {
    if (event.type === "assistant" && event.text) {
      lastAssistantText = event.text;
    }
  }
  if (!lastAssistantText) return "";
  return lastAssistantText;
}

function buildFooter(result: RunResult): string {
  const parts: string[] = [
    `⏱ ${(result.durationMs / 1000).toFixed(1)}s`,
    `🔧 ${result.toolCallCount} tool calls`,
  ];
  if (result.usage) {
    parts.push(`📊 ${result.usage.inputTokens}in / ${result.usage.outputTokens}out tokens`);
  }
  if (result.error) {
    parts.push(`⚠️ ${result.error}`);
  }
  if (result.sessionId) {
    parts.push(`💬 ${result.sessionId}`);
  }
  return `\n---\n_${parts.join(" | ")}_`;
}

/** Merge multiple text sections and split into messages by max length */
function splitMessages(sections: string[]): string[] {
  const messages: string[] = [];
  let current = "";

  for (const section of sections) {
    if (section.length > MAX_MESSAGE_LENGTH) {
      if (current.trim()) {
        messages.push(current.trim());
        current = "";
      }
      const chunks = splitLongText(section, MAX_MESSAGE_LENGTH);
      messages.push(...chunks);
      continue;
    }

    const candidate = current ? current + "\n\n" + section : section;
    if (candidate.length > MAX_MESSAGE_LENGTH) {
      if (current.trim()) {
        messages.push(current.trim());
      }
      current = section;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    messages.push(current.trim());
  }

  return messages.length > 0 ? messages : ["Codex Agent produced no output"];
}

/** Extract list of modified files from event stream */
export function extractModifiedFiles(events: CollectedEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_start") continue;
    const name = (event.toolName ?? "").toLowerCase();
    const isWrite = name.includes("edit") || name.includes("write")
      || name.includes("replace") || name.includes("delete");
    if (isWrite && event.toolArgs) {
      files.add(event.toolArgs);
    }
  }
  return Array.from(files);
}

/** Split long text at line boundaries */
function splitLongText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    const candidate = current ? current + "\n" + line : line;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
