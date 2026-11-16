import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveClaude } from "../claude/run";
import { hooksInstalled, globalSettingsFile } from "./hooks";
import { dataDir } from "../settings";

export type Check = { id: string; label: string; ok: boolean; detail: string; fix?: { label: string; action: string } };

function runJson(cmd: string, args: string[], timeoutMs = 10_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const p = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => {
      if (!done) p.kill();
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", () => {
      done = true;
      clearTimeout(t);
      resolve({ code: null, out });
    });
    p.on("close", (code) => {
      done = true;
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}

export async function claudeAuthStatus(): Promise<{ found: boolean; source?: string; loggedIn?: boolean; detail: string }> {
  const bin = resolveClaude();
  if (!bin) return { found: false, detail: "Claude Code isn't installed (or can't be found) on this computer." };
  const r = await runJson(bin.command, [...bin.prefixArgs, "auth", "status"]);
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf("{")));
    return { found: true, source: bin.source, loggedIn: Boolean(j.loggedIn), detail: j.loggedIn ? `Logged in (${j.authMethod ?? "account"})` : "Not logged in" };
  } catch {
    return { found: true, source: bin.source, loggedIn: undefined, detail: r.out.trim().split("\n")[0] || "Couldn't read login status" };
  }
}

export function gitInfo(root = process.cwd()): { commit?: string; branch?: string; isRepo: boolean } {
  if (!fs.existsSync(path.join(root, ".git"))) return { isRepo: false };
  const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  const br = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return { isRepo: true, commit: rev.stdout?.trim() || undefined, branch: br.stdout?.trim() || undefined };
}

/** git fetch + how many commits the local copy is behind. */
export async function updateAvailable(root = process.cwd()): Promise<{ behind: number; error?: string }> {
  if (!fs.existsSync(path.join(root, ".git"))) return { behind: 0, error: "Not a git checkout" };
  const f = await new Promise<number | null>((resolve) => {
    const p = spawn("git", ["fetch", "--quiet"], { cwd: root, windowsHide: true, stdio: "ignore" });
    const t = setTimeout(() => p.kill(), 20_000);
    p.on("close", (c) => (clearTimeout(t), resolve(c)));
    p.on("error", () => (clearTimeout(t), resolve(null)));
  });
  if (f !== 0) return { behind: 0, error: "Couldn't reach GitHub to check for updates" };
  const r = spawnSync("git", ["rev-list", "--count", "HEAD..@{u}"], { cwd: root, encoding: "utf8", windowsHide: true });
  return { behind: Number(r.stdout?.trim() || 0) };
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ id: "node", label: "Node.js", ok: major >= 20, detail: `v${process.versions.node}${major >= 20 ? "" : " (needs 20 or newer)"}` });

  let dbOk = true;
  let dbDetail = "Loaded";
  try {
    const Database = (await import("better-sqlite3")).default;
    new Database(":memory:").prepare("select 1").get();
  } catch (e) {
    dbOk = false;
    dbDetail = (e as Error).message.split("\n")[0];
  }
  checks.push({ id: "sqlite", label: "Database driver", ok: dbOk, detail: dbDetail });

  let writable = true;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.accessSync(dataDir(), fs.constants.W_OK);
  } catch {
    writable = false;
  }
  checks.push({ id: "data", label: "Data folder", ok: writable, detail: writable ? dataDir() : `Can't write to ${dataDir()}` });

  const auth = await claudeAuthStatus();
  checks.push({
    id: "claude",
    label: "Claude Code",
    ok: auth.found,
    detail: auth.found ? `Found (${auth.source})` : auth.detail,
  });
  checks.push({
    id: "login",
    label: "Claude login",
    ok: auth.loggedIn === true,
    detail: auth.found ? auth.detail : "Install Claude Code first",
    fix: auth.found && auth.loggedIn !== true ? { label: "Log in to Claude", action: "login" } : undefined,
  });

  const hooks = hooksInstalled();
  checks.push({
    id: "hooks",
    label: "Reporting hooks",
    ok: hooks,
    detail: hooks ? `Installed in ${globalSettingsFile()}` : "Not installed: live runs from Claude Code won't be reported",
    fix: hooks ? undefined : { label: "Install hooks", action: "hooks" },
  });
  checks.push({
    id: "supervisor",
    label: "Runs in the background",
    ok: process.env.AGENT_OPS_SUPERVISED === "1",
    detail: process.env.AGENT_OPS_SUPERVISED === "1" ? "Managed by the Agent Ops launcher (restarts and updates itself)" : "Started by hand (npm run dev/start); in-app update unavailable",
  });
  return checks;
}
