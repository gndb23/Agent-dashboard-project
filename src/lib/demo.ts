import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db/client";

/** Agent ids created by `npm run seed` (demo data). */
export const DEMO_AGENT_IDS = ["portfolio-research", "pr-reviewer", "inbox-triage", "scratch-experiments"];

export function hasDemoData(db: DB): boolean {
  const q = DEMO_AGENT_IDS.map(() => "?").join(",");
  return Boolean(db.$client.prepare(`SELECT 1 FROM events WHERE json_extract(payload,'$._source') = 'seed' AND agent_id IN (${q}) LIMIT 1`).get(...DEMO_AGENT_IDS));
}

/** Removes demo runs/events/alerts and the demo manifests (only files marked as DEMO). */
export function removeDemoData(db: DB, agentsDir: string): { removedFiles: string[] } {
  const q = DEMO_AGENT_IDS.map(() => "?").join(",");
  const tx = db.$client.transaction(() => {
    db.$client.prepare(`DELETE FROM events WHERE agent_id IN (${q})`).run(...DEMO_AGENT_IDS);
    db.$client.prepare(`DELETE FROM runs WHERE agent_id IN (${q})`).run(...DEMO_AGENT_IDS);
    db.$client.prepare(`DELETE FROM alerts WHERE agent_id IN (${q})`).run(...DEMO_AGENT_IDS);
    db.$client.prepare(`DELETE FROM events WHERE json_extract(payload,'$._source') IN ('seed','sample-script')`).run();
    db.$client.prepare(`DELETE FROM runs WHERE id NOT IN (SELECT DISTINCT run_id FROM events)`).run();
  });
  tx();
  const removedFiles: string[] = [];
  for (const id of DEMO_AGENT_IDS) {
    const f = path.join(agentsDir, `${id}.yaml`);
    try {
      if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes("DEMO agent")) {
        fs.rmSync(f);
        removedFiles.push(f);
      }
    } catch {
      /* ignore */
    }
  }
  return { removedFiles };
}
