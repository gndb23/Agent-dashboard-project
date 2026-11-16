import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveClaude } from "@/lib/claude/run";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "win-"));

describe("finding the Claude CLI on Windows", () => {
  it("runs an npm claude.cmd shim through node (no shell needed)", () => {
    const npmDir = tmp();
    fs.writeFileSync(path.join(npmDir, "claude.cmd"), "@node %~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js %*");
    const cli = path.join(npmDir, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "");
    const r = resolveClaude({ PATH: npmDir, USERPROFILE: tmp() }, "win32");
    expect(r).toEqual({ command: process.execPath, prefixArgs: [cli], source: "PATH" });
  });

  it("prefers a native claude.exe and checks the usual install folders", () => {
    const home = tmp();
    const exe = path.join(home, ".local", "bin", "claude.exe");
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
    expect(resolveClaude({ PATH: tmp(), USERPROFILE: home }, "win32")).toEqual({ command: exe, prefixArgs: [], source: "default install location" });
  });

  it("returns null when Claude Code isn't installed, and honours AGENT_OPS_CLAUDE_BIN", () => {
    expect(resolveClaude({ PATH: tmp(), USERPROFILE: tmp(), HOME: tmp() }, "win32")).toBeNull();
    const script = path.join(tmp(), "fake.mjs");
    fs.writeFileSync(script, "");
    expect(resolveClaude({ AGENT_OPS_CLAUDE_BIN: script }, "win32")).toEqual({ command: process.execPath, prefixArgs: [script], source: "AGENT_OPS_CLAUDE_BIN" });
  });
});
