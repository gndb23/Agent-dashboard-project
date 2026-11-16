import { z } from "zod";
import YAML from "yaml";
import { CronExpressionParser } from "cron-parser";

const severity = z.enum(["warning", "critical"]).default("warning");

export const alertRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("consecutive_failures"),
    threshold: z.number().int().min(1),
    severity,
  }),
  z.object({
    type: z.literal("failures_in_window"),
    threshold: z.number().int().min(1),
    hours: z.number().positive(),
    severity,
  }),
  z.object({
    type: z.literal("runtime_exceeds"),
    minutes: z.number().positive(),
    severity,
  }),
  z.object({
    type: z.literal("no_run_within"),
    hours: z.number().positive(),
    severity,
  }),
  z.object({
    type: z.literal("cost_per_run_exceeds"),
    usd: z.number().positive(),
    severity,
  }),
]);
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const AGENT_TYPES = ["claude-code", "api-script", "other"] as const;

export const manifestSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/, "id must be lowercase letters, digits, '.', '_' or '-'"),
    name: z.string().min(1),
    description: z.string().default(""),
    owner: z.string().default(""),
    type: z.enum(AGENT_TYPES).default("claude-code"),
    schedule: z
      .string()
      .optional()
      .refine((s) => s === undefined || isValidCron(s), "schedule must be a valid 5-field cron expression"),
    timezone: z.string().optional(),
    tags: z.array(z.string()).default([]),
    expected_runtime_minutes: z.number().positive().optional(),
    alert_rules: z.array(alertRuleSchema).default([]),
    /** Agents this agent hands work to (drawn as declared links on /workflow). */
    triggers: z.array(z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "triggers must be agent ids")).default([]),
    /** Absolute path to the agent's project. Enables "Chat" for claude-code agents. */
    project_dir: z
      .string()
      .refine((p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p), "project_dir must be an absolute path")
      .optional(),
    chat: z
      .object({ permission_mode: z.enum(["default", "acceptEdits", "plan"]).default("default") })
      .strict()
      .optional(),
    /** More folders the agent may read in chat and runs (absolute paths). */
    extra_dirs: z
      .array(z.string().refine((p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p), "extra_dirs entries must be absolute paths"))
      .default([]),
    /** Name of the Claude Desktop scheduled task this agent is (folder name under ~/.claude/scheduled-tasks). */
    scheduled_task: z.string().optional(),
    /** How "Run now" (and the optional built-in scheduler) runs this agent. */
    run: z
      .object({
        prompt: z.string().optional(),
        on_schedule: z.boolean().default(false),
        permission_mode: z.enum(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]).optional(),
        max_minutes: z.number().positive().max(24 * 60).default(30),
        model: z.string().optional(),
      })
      .strict()
      .optional(),
    icon: z.string().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex value like #6E56CF")
      .optional(),
  })
  .strict();

export type AgentManifest = z.infer<typeof manifestSchema> & {
  /** Set for agents that come from (or are linked to) a Claude Desktop scheduled task. Not written to YAML. */
  origin?: AgentOrigin;
};

export type AgentOrigin = {
  kind: "claude-task";
  taskName: string;
  taskDir: string;
  skillFile: string;
  instructions: string;
  /** From the Claude app's settings file, when found. */
  enabled?: boolean;
  model?: string;
  permissionMode?: string;
  cronSource?: "app" | "manifest" | "none";
  /** True when no manifest file exists: the agent exists only because the task does. */
  virtual: boolean;
};

function isValidCron(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

export type ParseResult = { ok: true; manifest: AgentManifest } | { ok: false; error: string };

export function parseManifest(source: string, fileName?: string): ParseResult {
  let raw: unknown;
  try {
    raw = YAML.parse(source);
  } catch (e) {
    return { ok: false, error: `Invalid YAML: ${(e as Error).message}` };
  }
  if (raw === null || typeof raw !== "object") return { ok: false, error: "Manifest must be a YAML mapping" };
  const result = manifestSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  if (fileName) {
    const base = fileName.replace(/\.(ya?ml)$/i, "");
    if (base !== result.data.id) {
      return { ok: false, error: `File name "${fileName}" must match id "${result.data.id}" (expected ${result.data.id}.yaml)` };
    }
  }
  return { ok: true, manifest: result.data };
}

/** Next scheduled fire time for a manifest, or null when unscheduled. */
export function nextScheduledRun(m: Pick<AgentManifest, "schedule" | "timezone">, from = new Date()): Date | null {
  if (!m.schedule) return null;
  try {
    return CronExpressionParser.parse(m.schedule, { currentDate: from, tz: m.timezone }).next().toDate();
  } catch {
    return null;
  }
}

export function ruleKey(rule: AlertRule): string {
  const { type, severity: _s, ...rest } = rule;
  const params = Object.entries(rest)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${type}(${params})`;
}

export function defaultManifestYaml(id: string, type: (typeof AGENT_TYPES)[number] = "claude-code"): string {
  const name = id
    .split(/[-_.]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return `# Agent manifest — see docs/ONBOARDING.md
id: ${id}
name: ${name}
description: ""
owner: ""
type: ${type}
# schedule: "0 9 * * 1-5"      # optional cron, used for "next run" and missed-run alerts
# timezone: Asia/Singapore
tags: []
# expected_runtime_minutes: 10
alert_rules:
  - type: consecutive_failures
    threshold: 2
`;
}
