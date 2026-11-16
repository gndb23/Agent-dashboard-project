import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseManifest, nextScheduledRun, ruleKey, defaultManifestYaml } from "@/lib/registry/manifest";
import { loadRegistry } from "@/lib/registry/registry";

const valid = `
id: portfolio-research
name: Portfolio Research
type: claude-code
schedule: "37 7,18 * * *"
timezone: Asia/Singapore
tags: [finance]
alert_rules:
  - type: consecutive_failures
    threshold: 2
  - type: no_run_within
    hours: 13
    severity: critical
`;

describe("parseManifest", () => {
  it("accepts a valid manifest and applies defaults", () => {
    const r = parseManifest(valid, "portfolio-research.yaml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.description).toBe("");
    expect(r.manifest.alert_rules[0]).toEqual({ type: "consecutive_failures", threshold: 2, severity: "warning" });
    expect(r.manifest.alert_rules[1].severity).toBe("critical");
  });

  it("rejects invalid YAML", () => {
    const r = parseManifest("id: [oops", "x.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Invalid YAML/);
  });

  it("rejects bad ids, unknown fields, bad cron and unknown rule types", () => {
    const cases = [
      "id: Bad Id\nname: x",
      "id: a\nname: x\nunknown_field: 1",
      'id: a\nname: x\nschedule: "every day"',
      "id: a\nname: x\nalert_rules:\n  - type: vibes\n    threshold: 1",
      "id: a\nname: x\nalert_rules:\n  - type: consecutive_failures\n    threshold: 0",
    ];
    for (const c of cases) expect(parseManifest(c).ok, c).toBe(false);
  });

  it("requires the file name to match the id", () => {
    const r = parseManifest(valid, "other.yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must match id/);
  });

  it("generates a default manifest that parses", () => {
    const r = parseManifest(defaultManifestYaml("my-new-agent"), "my-new-agent.yaml");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.name).toBe("My New Agent");
  });
});

describe("schedule + rule keys", () => {
  it("computes the next scheduled run in the manifest timezone", () => {
    const next = nextScheduledRun({ schedule: "37 7,18 * * *", timezone: "Asia/Singapore" }, new Date("2026-01-01T00:00:00Z"));
    // 07:37 SGT == 23:37 UTC previous day; 18:37 SGT == 10:37 UTC
    expect(next?.toISOString()).toBe("2026-01-01T10:37:00.000Z");
    expect(nextScheduledRun({})).toBeNull();
  });

  it("builds stable rule keys", () => {
    expect(ruleKey({ type: "failures_in_window", threshold: 3, hours: 24, severity: "critical" })).toBe(
      "failures_in_window(threshold=3,hours=24)",
    );
  });
});

describe("loadRegistry", () => {
  it("loads valid manifests, reports errors, ignores _ files and duplicates", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-"));
    fs.writeFileSync(path.join(dir, "portfolio-research.yaml"), valid);
    fs.writeFileSync(path.join(dir, "broken.yaml"), "id: broken\n");
    fs.writeFileSync(path.join(dir, "_template.yaml"), "whatever: true");
    fs.writeFileSync(path.join(dir, "README.md"), "# hi");
    const reg = loadRegistry(dir);
    expect(reg.agents.map((a) => a.id)).toEqual(["portfolio-research"]);
    expect(reg.errors).toHaveLength(1);
    expect(reg.errors[0].file).toBe("broken.yaml");
  });

  it("returns an empty registry for a missing directory", () => {
    expect(loadRegistry("/nonexistent/dir/xyz").agents).toEqual([]);
  });
});
