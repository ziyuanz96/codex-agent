#!/usr/bin/env node
/**
 * Mock Cursor Agent CLI that outputs stream-json formatted event streams.
 * Used for integration tests without depending on the real Cursor CLI.
 *
 * Usage: node mock-agent.mjs <prompt>
 * Environment variables:
 *   MOCK_DELAY_MS  - Delay between events (default 10ms)
 *   MOCK_SCENARIO  - Scenario: success (default) | error | timeout | sigterm
 */

const prompt = process.argv.find(a => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]) || "test";
const delay = parseInt(process.env.MOCK_DELAY_MS || "10", 10);
const scenario = process.env.MOCK_SCENARIO || "success";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSuccess() {
  emit({ type: "system", subtype: "init", session_id: "mock-session-001", model: "mock-model", cwd: process.cwd(), timestamp_ms: Date.now() });
  await sleep(delay);

  emit({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] }, timestamp_ms: Date.now() });
  await sleep(delay);

  emit({
    type: "tool_call", subtype: "started", call_id: "tc-1",
    tool_call: { readToolCall: { args: { path: "/tmp/test/main.ts" } } },
    timestamp_ms: Date.now(),
  });
  await sleep(delay);

  emit({
    type: "tool_call", subtype: "completed", call_id: "tc-1",
    tool_call: { readToolCall: { result: "export function main() { return 42; }" } },
    timestamp_ms: Date.now(),
  });
  await sleep(delay);

  emit({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: `Analysis completed: ${prompt}` }] },
    timestamp_ms: Date.now(),
  });
  await sleep(delay);

  emit({
    type: "result", subtype: "success", result: "Analysis completed successfully",
    duration_ms: 500, is_error: false,
    usage: { inputTokens: 200, outputTokens: 100 },
    timestamp_ms: Date.now(),
  });
}

async function runError() {
  emit({ type: "system", subtype: "init", session_id: "mock-session-err", model: "mock-model", cwd: process.cwd(), timestamp_ms: Date.now() });
  await sleep(delay);

  emit({
    type: "result", subtype: "error", result: "Error: something went wrong",
    duration_ms: 100, is_error: true,
    timestamp_ms: Date.now(),
  });
  process.exit(1);
}

async function runTimeout() {
  emit({ type: "system", subtype: "init", session_id: "mock-session-hang", model: "mock-model", cwd: process.cwd(), timestamp_ms: Date.now() });
  // No more output, simulating a hung process
  await new Promise(() => {});
}

async function runSigterm() {
  emit({ type: "system", subtype: "init", session_id: "mock-session-sig", model: "mock-model", cwd: process.cwd(), timestamp_ms: Date.now() });
  await sleep(delay);

  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Analyzing..." }] }, timestamp_ms: Date.now() });

  // Respond to SIGTERM properly
  process.on("SIGTERM", () => {
    process.exit(0);
  });

  // Keep outputting until terminated
  while (true) {
    await sleep(500);
  }
}

switch (scenario) {
  case "error": await runError(); break;
  case "timeout": await runTimeout(); break;
  case "sigterm": await runSigterm(); break;
  default: await runSuccess(); break;
}
