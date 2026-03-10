# codex-agent（OpenClaw 插件）

[English](./README.md) | [中文](./README_CN.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-6f42c1)](https://github.com/openclaw/openclaw)

- 项目仓库：https://github.com/ziyuanz96/codex-agent
- 参考项目：https://github.com/toheart/cursor-agent
- OpenClaw：https://github.com/openclaw/openclaw

一个面向 OpenClaw 的远程执行网关插件：把 `/codex` 指令通过 SSH 转发到**远程 Codex CLI**，并基于白名单目录做边界控制。

> 设计目标：OpenClaw 负责 IM 消息路由，Codex 负责代码执行。

---

## 功能概览

- `/codex <项目代号> <指令>`
- 通过 SSH 调用远程 `codex exec --json`
- **项目目录白名单**（禁止任意路径）
- `/codex reload` 热加载项目映射（无需重启网关）
- prompt/path 风险拦截（明显越界路径）
- 删除操作保护（命中 `rm` 类意图需 `--confirm-rm`）
- 删除确认 TTL（短时有效）
- 基础审计日志
- 失败重试上限（最多自动重试 1 次）
- **可选的持久 SSH 中继**（`/ssh`）用于连续多步远程操作
- `/ssh` 会按“用户+项目”维持会话，并限制在项目根目录内

---

## 命令用法

### 1）基础执行

```bash
/codex <project-key> <prompt>
```

`<project-key>` 就是项目代号（例如 `sa`、`sb`、`sc`）。
这些代号定义在 `plugins.entries.codex-agent.config.projects`。

示例：

```bash
/codex sa 列出当前目录文件
```

### 2）热加载白名单映射

```bash
/codex reload
```

### 3）继续会话

```bash
/codex sa --continue 继续刚才任务
/codex sa --resume <session_id> 继续这个会话
```

### 4）删除确认

删除意图会先被拦截：

```bash
/codex sa 删除 README.txt
# 先拦截并提示确认

/codex sa --confirm-rm 删除 README.txt
# 在确认时效内再次提交才会执行
```

### 5）持久 SSH 中继（`/ssh`）

当你需要“连续 shell 操作”而不是单次 `/codex` 时使用。

```bash
/ssh start <project>
/ssh cmd <project> <command>
/ssh status [project]
/ssh stop <project>
/ssh reset <project>
```

示例：

```bash
/ssh start sa
/ssh cmd sa pwd
/ssh cmd sa conda activate timeserieslibrary
/ssh cmd sa python train.py
/ssh status sa
/ssh stop sa
```

说明：

- `/ssh` 是**非 TTY 的命令中继**，不是完整终端 UI。
- `nvtop` 这类 TUI 程序在该模式下失败是预期行为。
- 长任务建议后台启动（`nohup ... &`）并配合日志查看。

---

## 当前安全模型

### 插件层保护

- 仅允许 `projects` 映射中的目录
- 拦截明显高风险路径模式（如 `/etc`、`/root`、`~/.ssh`、路径穿越等）
- 删除意图必须显式确认
- 执行/拦截行为写审计日志
- `/ssh` 会话强制限制在项目根目录内，越界会被阻断并拉回

### 重要说明

本插件提升了安全性，但**不能替代系统级强隔离**。
若用于高敏感场景，建议叠加 SSH 侧硬限制（`authorized_keys` 限权、forced command wrapper、最小权限账号等）。

---

## 安装

```bash
openclaw plugins install /path/to/codex-agent.tgz
```

或手动将构建产物放到 OpenClaw 扩展目录。

---

## 配置方法

编辑：`~/.openclaw/openclaw.json`

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
            "host": "你的远程主机",
            "user": "你的远程用户",
            "port": 22,
            "keyPath": "/你的SSH私钥路径",
            "strictHostKeyChecking": "accept-new",
            "codexPath": "/usr/local/bin/codex"
          }
        }
      }
    }
  }
}
```

首次启用后重启网关：

```bash
openclaw gateway restart
```

后续只改 `projects` 时可直接：

```bash
/codex reload
```

---

## 运行前提

- OpenClaw 网关正常运行
- OpenClaw 机器可 SSH 到远程算力机
- 远程机已安装并登录 Codex CLI
- 私钥文件对 OpenClaw 进程可读

---

## 审计日志

默认路径：

```text
/tmp/openclaw-codex-agent-audit.log
```

日志为 JSON Lines，包含 `run`、`reject`、`rm_blocked_needs_confirm` 等事件。

---

## 已知限制

- 当前防护含 prompt 规则判断，属于“策略层防护”，不是内核级隔离
- 共享 SSH 账号天然风险高于专用最小权限账号
- 更高安全等级建议增加 SSH 侧 forced command wrapper

---

## 致谢

本项目的插件结构与思路参考了：
- [toheart/cursor-agent](https://github.com/toheart/cursor-agent)

相关生态项目：
- [OpenClaw](https://github.com/openclaw/openclaw)
- [GitHub CLI](https://github.com/cli/cli)

感谢原项目提供了非常实用的 OpenClaw 插件实践范式。

---

## License

[Apache-2.0](./LICENSE)
