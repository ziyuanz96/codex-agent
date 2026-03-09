# Project Context

## Purpose

Codex Agent is an OpenClaw plugin that invokes the local Codex Agent CLI from OpenClaw chat conversations for deep code analysis, troubleshooting, and diagnostics. It automatically loads project context from `.codex/rules`, `AGENTS.md`, etc., and supports enabling project-configured MCP servers (GitLab, databases, monitoring, etc.), providing users with full-stack code analysis capabilities.

## Tech Stack

- **Language**: TypeScript (ES2022, ESNext modules)
- **Build Tool**: esbuild (bundles into single-file ESM output)
- **Runtime**: Node.js
- **Host Framework**: OpenClaw plugin system
- **Dependencies**:
  - `@types/node` ^25.3.2 (dev dependency)
  - `esbuild` ^0.24.0 (build dependency)
  - `typescript` ^5.7.0 (type checking dependency)
- **External Dependency**: Codex Agent CLI (locally installed `agent` command)

## Project Conventions

### Code Style

- TypeScript strict mode
- ESM module format (`"type": "module"`)
- Import paths use `.js` suffix (ESM requirement)
- Naming conventions: camelCase for variables and functions, PascalCase for types, UPPER_SNAKE_CASE for constants
- English comments and English log messages
- No redundant comments in code

### Architecture Patterns

- Single plugin architecture, metadata declared via `openclaw.plugin.json`
- Source organization:
  - `src/index.ts` — Plugin entry, registers `codex_agent` tool
  - `src/types.ts` — Type definitions
  - `src/parser.ts` — Codex Agent stream-json output parser
  - `src/runner.ts` — CLI process management, timeout control, result collection
  - `src/formatter.ts` — Event stream formatting to Markdown output
  - `src/process-registry.ts` — Global process registry, concurrency control, Gateway exit cleanup
  - `src/tool.ts` — Agent Tool factory function
- Separation of concerns: entry (registration), types, parsing, execution as independent modules
- Bundled into single file for distribution via esbuild

### Testing Strategy

- Unit tests with Vitest
- Integration tests with mock-agent.mjs
- Test files co-located with source files (`*.test.ts`)

### Git Workflow

- Standard Git workflow
- Semantic versioning (synced between package.json and openclaw.plugin.json via `sync-version` script)

## Domain Context

- **OpenClaw**: AI Agent gateway platform with plugin extension support
- **Codex Agent CLI**: Command-line tool from Cursor IDE for AI-assisted code analysis
- **MCP (Model Context Protocol)**: Protocol for AI integration with external services
- Three execution modes: `ask` (read-only analysis), `plan` (generate plans), `agent` (can modify files)
- Multi-project mapping table for quick target switching by name

## Important Constraints

- Requires locally installed Codex Agent CLI
- Requires a valid Cursor subscription (CLI uses Cursor model quota)
- Per-invocation timeout limit (default 600 seconds)
- No-output timeout for hung process detection (default 120 seconds)
- Output parsed via `stream-json` format, depends on specific event structure

## External Dependencies

- **Codex Agent CLI**: Core dependency, installed via `curl https://codex.com/install`
- **OpenClaw Gateway**: v2026.2.24+, plugin host environment
- **Cursor Subscription**: CLI requires a valid Cursor account and model quota
