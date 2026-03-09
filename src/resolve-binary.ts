import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { ResolvedBinary } from "./types.js";

const VERSION_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/;

/**
 * 将版本目录名（如 "2026.2.27-e7d2ef6"）转为可排序的数值（如 20260227）。
 * 与 codex-agent.ps1 中的 Parse-VersionString 逻辑保持一致。
 */
function versionToNum(name: string): number {
  const datePart = name.split("-")[0]!;
  const [year, month, day] = datePart.split(".");
  return parseInt(`${year}${month!.padStart(2, "0")}${day!.padStart(2, "0")}`, 10);
}

/** 平台对应的 node 可执行文件名 */
function nodeBinName(): string {
  return process.platform === "win32" ? "node.exe" : "node";
}

/**
 * 在 baseDir 下查找 node 可执行文件 + index.js。
 * 对应 codex-agent.ps1 中 "Are we somehow in the same dir as the script?" 分支。
 */
function probeDir(dir: string): ResolvedBinary | null {
  const nodeBin = join(dir, nodeBinName());
  const entry = join(dir, "index.js");
  if (existsSync(nodeBin) && existsSync(entry)) {
    return { nodeBin, entryScript: entry };
  }
  return null;
}

/**
 * 扫描 baseDir/versions/ 下所有版本目录，取最新版本中的 node + index.js。
 * 对应 codex-agent.ps1 中 "Find the latest version" 分支。
 */
function probeVersions(baseDir: string): ResolvedBinary | null {
  const versionsDir = join(baseDir, "versions");
  if (!existsSync(versionsDir)) return null;

  let entries: string[];
  try {
    entries = readdirSync(versionsDir);
  } catch {
    return null;
  }

  const matched = entries
    .filter((name) => VERSION_PATTERN.test(name))
    .sort((a, b) => versionToNum(b) - versionToNum(a));

  for (const ver of matched) {
    const result = probeDir(join(versionsDir, ver));
    if (result) return result;
  }
  return null;
}

/**
 * 从 agentPath（.cmd / shell script / 任意路径）解析出底层的 node + index.js。
 *
 * 解析策略（复刻 codex-agent.ps1 的逻辑，跨平台通用）：
 * 1. agentPath 所在目录直接有 node + index.js → 使用
 * 2. agentPath 所在目录有 versions/ 子目录 → 取最新版本
 * 3. 解析失败返回 null，调用方回退到原始 spawn 方式
 */
export function resolveAgentBinary(agentPath: string): ResolvedBinary | null {
  const baseDir = dirname(resolve(agentPath));

  const direct = probeDir(baseDir);
  if (direct) return direct;

  const versioned = probeVersions(baseDir);
  if (versioned) return versioned;

  return null;
}
