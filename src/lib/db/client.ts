import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

import { Database } from "./sqlite";

/** The app's database handle. `$client` is the SQLite connection (Node's built-in engine). */
export type DB = { $client: Database };

export function createDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  if (file !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(schema.DDL);
  for (const m of schema.COLUMN_MIGRATIONS) {
    const cols = sqlite.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === m.column)) sqlite.exec(m.ddl);
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS runs_parent_idx ON runs(parent_run_id)");
  return { $client: sqlite };
}

export function dbPath(): string {
  return process.env.AGENT_OPS_DB ?? path.join(process.cwd(), "data", "agent-ops.db");
}

const g = globalThis as unknown as { __agentOpsDb?: DB };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): DB {
  if (!g.__agentOpsDb) g.__agentOpsDb = createDb(dbPath());
  return g.__agentOpsDb;
}
