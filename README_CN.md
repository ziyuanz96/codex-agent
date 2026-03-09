# codex-agent（OpenClaw 插件）

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

---

## 命令用法

### 1）基础执行

```bash
/codex <project-key> <prompt>
```

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

---

## 当前安全模型

### 插件层保护

- 仅允许 `projects` 映射中的目录
- 拦截明显高风险路径模式（如 `/etc`、`/root`、`~/.ssh`、路径穿越等）
- 删除意图必须显式确认
- 执行/拦截行为写审计日志

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
- `toheart/cursor-agent`

感谢原项目提供了非常实用的 OpenClaw 插件实践范式。

---

## License

Apache-2.0
