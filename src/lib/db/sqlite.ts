/**
 * Thin adapter over Node's built-in SQLite (`node:sqlite`, Node 22.13+), exposing the small
 * better-sqlite3-style API this app uses (prepare/run/get/all, exec, pragma, transaction).
 * Using the built-in engine means nothing native has to be compiled on install, which is
 * what made `npm install` fail on Windows machines without Visual Studio.
 */
type SqlValue = null | number | bigint | string | Uint8Array;
type Row = Record<string, unknown>;

type NodeStatement = {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
};
type NodeDatabase = { prepare(sql: string): NodeStatement; exec(sql: string): void; close(): void };
type NodeSqliteModule = { DatabaseSync: new (path: string) => NodeDatabase };

let mod: NodeSqliteModule | null = null;

/** Loads node:sqlite once, hiding its one-off "experimental feature" warning on Node 22. */
export function loadNodeSqlite(): NodeSqliteModule {
  if (mod) return mod;
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (!getBuiltin) throw new Error(`Agent Ops needs Node.js 22.13 or newer (this is ${process.version}). Install the LTS version from nodejs.org.`);
  const orig = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String((warning as Error)?.message ?? warning).includes("SQLite")) return;
    return (orig as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const m = getBuiltin("node:sqlite") as NodeSqliteModule | undefined;
    if (!m?.DatabaseSync) throw new Error("missing");
    mod = m;
    return m;
  } catch {
    throw new Error(`Agent Ops needs Node.js 22.13 or newer for its built-in database (this is ${process.version}). Install the LTS version from nodejs.org.`);
  } finally {
    process.emitWarning = orig;
  }
}

const NAMED = /[@:$]([A-Za-z_][A-Za-z0-9_]*)/g;

function toValue(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string" || v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.getTime();
  return JSON.stringify(v);
}

const plain = (r: Row | undefined) => (r ? { ...r } : undefined);

export class Statement {
  private readonly names: string[];
  constructor(private readonly stmt: NodeStatement, sql: string) {
    this.names = [...new Set([...sql.matchAll(NAMED)].map((m) => m[1]))];
  }
  /** Accepts positional values, or one object of named values (extra keys are ignored). */
  private args(params: unknown[]): unknown[] {
    if (params.length === 1 && params[0] && typeof params[0] === "object" && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
      const o = params[0] as Record<string, unknown>;
      const named: Record<string, SqlValue> = {};
      for (const n of this.names) named[n] = toValue(o[n]);
      return [named];
    }
    return params.map(toValue);
  }
  run(...params: unknown[]) {
    const r = this.stmt.run(...this.args(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  get(...params: unknown[]): Row | undefined {
    return plain(this.stmt.get(...this.args(params)));
  }
  all(...params: unknown[]): Row[] {
    return this.stmt.all(...this.args(params)).map((r) => ({ ...r }));
  }
}

export class Database {
  private readonly db: NodeDatabase;
  private depth = 0;
  private cache = new Map<string, Statement>();
  constructor(file: string) {
    const { DatabaseSync } = loadNodeSqlite();
    this.db = new DatabaseSync(file);
  }
  prepare(sql: string): Statement {
    let s = this.cache.get(sql);
    if (!s) {
      s = new Statement(this.db.prepare(sql), sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(sql, s);
    }
    return s;
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
  pragma(p: string) {
    this.db.exec(`PRAGMA ${p}`);
  }
  /** Like better-sqlite3: returns a function that runs `fn` in a transaction (nested calls use savepoints). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      const sp = `sp${this.depth}`;
      this.db.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn(...args);
        this.depth--;
        this.db.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.depth--;
        this.db.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }
  close() {
    this.cache.clear();
    this.db.close();
  }
}
