import { describe, it, expect } from "vitest";
import { parseCommandArgs, resolveProjectPath } from "./index.js";

describe("codex-agent smoke", () => {
  it("parses reload", () => {
    expect(parseCommandArgs("reload")).toEqual({ reload: true });
  });

  it("parses confirm rm", () => {
    const p = parseCommandArgs("sa --confirm-rm 删除 README.txt");
    if ("error" in p) throw new Error(p.error);
    expect(p.project).toBe("sa");
    expect(p.confirmRm).toBe(true);
  });

  it("parses confirm write/risk", () => {
    const p = parseCommandArgs("sa --confirm-write --confirm-risk 覆盖 config 文件");
    if ("error" in p) throw new Error(p.error);
    expect(p.confirmWrite).toBe(true);
    expect(p.confirmRisk).toBe(true);
  });

  it("resolves allowlist only", () => {
    expect(resolveProjectPath("sa", { sa: "/x/a" })).toBe("/x/a");
    expect(resolveProjectPath("/tmp", { sa: "/x/a" })).toBeNull();
  });
});
