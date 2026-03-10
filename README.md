# codex-agent (OpenClaw Plugin)

[English](./README.md) | [中文](./README_CN.md)

A secure-ish gateway plugin for OpenClaw that forwards `/codex` commands to **remote Codex CLI over SSH**, with project allowlist controls.

> Design goal: OpenClaw handles IM routing; Codex handles execution.

---

## Features

- `/codex <project> <prompt>` command
- Remote Codex execution via SSH (`codex exec --json`)
- **Project allowlist** (no arbitrary path input)
- `/codex reload` to hot-reload project mappings (no gateway restart)
- Prompt/path guardrails for obvious out-of-sandbox paths
- Delete intent protection (`rm` requires `--confirm-rm`)
- Confirmation TTL for dangerous delete actions
- Basic audit logging
- Failure retry cap (max 1 auto-retry)
- **Optional persistent SSH relay** (`/ssh`) for multi-step remote shell workflows
- `/ssh` keeps per-user per-project sessions and enforces project root cwd sandbox

---

## Command Usage

### 1) Basic

```bash
/codex <project-key> <prompt>
```

`<project-key>` is your project alias (for example `sa`, `sb`, `sc`).
Aliases are defined in `plugins.entries.codex-agent.config.projects`.

Example:

```bash
/codex sa list files in current directory
```

### 2) Reload allowlist mappings

```bash
/codex reload
```

### 3) Continue / Resume

```bash
/codex sa --continue continue previous task
/codex sa --resume <session_id> continue this session
```

### 4) Dangerous delete confirmation

If delete intent is detected, command is blocked first.

```bash
/codex sa delete README.txt
# blocked, asks confirmation

/codex sa --confirm-rm delete README.txt
# allowed (must be within confirmation TTL)
```

### 5) Persistent SSH relay (`/ssh`)

Use this when you need a continuous remote shell session instead of one-shot `/codex`.

```bash
/ssh start <project>
/ssh cmd <project> <command>
/ssh status [project]
/ssh stop <project>
/ssh reset <project>
```

Examples:

```bash
/ssh start sa
/ssh cmd sa pwd
/ssh cmd sa conda activate <your-env>
/ssh cmd sa python train.py
/ssh status sa
/ssh stop sa
```

Notes:

- `/ssh` is **non-TTY command relay**, not full terminal UI.
- TUI programs like `nvtop` are expected to fail in this mode.
- Long-running jobs should be started in background (`nohup ... &`) and checked by logs.

---

## Security Model (Current)

### Plugin-level controls

- Project path must come from configured `projects` map
- Prompt blocks obvious risky path patterns (`/etc`, `/root`, `~/.ssh`, traversal patterns, etc.)
- Delete intent requires explicit confirmation flag
- Audit records written to local log file
- `/ssh` sessions are bound to project root and auto-block cwd escaping out of allowlist root

### Important note

This plugin improves safety but does **not** replace system-level hard isolation.
For production/high-risk environments, add SSH-side restrictions (e.g. restricted `authorized_keys`, forced command wrapper, least-privilege account).

---

## Installation

```bash
openclaw plugins install /path/to/codex-agent.tgz
```

Or install from extension folder if you build manually.

---

## Configuration

Edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["codex-agent"],
    "entries": {
      "codex-agent": {
        "enabled": true,
        "config": {
          "codexPath": "codex",
          "projects": {
            "sa": "/remote/path/sandbox_a",
            "sb": "/remote/path/sandbox_b"
          },
          "defaultTimeoutSec": 600,
          "noOutputTimeoutSec": 120,
          "maxConcurrent": 2,
          "sandbox": "workspace-write",
          "skipGitRepoCheck": true,
          "enableAgentTool": false,
          "auditLogPath": "/tmp/openclaw-codex-agent-audit.log",
          "remote": {
            "enabled": true,
            "host": "YOUR_REMOTE_HOST",
            "user": "YOUR_REMOTE_USER",
            "port": 22,
            "keyPath": "/path/to/ssh_private_key",
            "strictHostKeyChecking": "accept-new",
            "codexPath": "/usr/local/bin/codex"
          }
        }
      }
    }
  }
}
```

Then restart gateway once for first load:

```bash
openclaw gateway restart
```

After that, use `/codex reload` for project mapping updates.

---

## Required Environment

- OpenClaw gateway running
- SSH connectivity from OpenClaw host to remote Codex host
- Remote host has `codex` CLI installed and authenticated
- Private key file readable by OpenClaw process

---

## Audit Log

Default path:

```text
/tmp/openclaw-codex-agent-audit.log
```

Each line is JSON for events like `run`, `reject`, `rm_blocked_needs_confirm`, etc.

---

## Known Limitations

- Guardrails are heuristic (prompt-level), not full syscall/file sandboxing
- Shared SSH account can still be risky vs dedicated least-privilege account
- Stronger protection should be added SSH-side (forced command wrapper)

---

## Acknowledgements

This project was initially inspired by the idea and structure of:
- [toheart/cursor-agent](https://github.com/toheart/cursor-agent)

Related ecosystem projects:
- [OpenClaw](https://github.com/openclaw/openclaw)
- [GitHub CLI](https://github.com/cli/cli)

Thanks to the original open-source work for the practical OpenClaw plugin pattern.

---

## License

[Apache-2.0](./LICENSE)
