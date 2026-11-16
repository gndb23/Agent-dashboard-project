import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "@/lib/db/sqlite";
import { createDb } from "@/lib/db/client";

describe("built-in SQLite adapter", () => {
  it("binds positional and named values (extra keys ignored) and returns plain rows", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b INTEGER)");
    const r = db.prepare("INSERT INTO t (a, b) VALUES (?, ?)").run("x", 1);
    expect(r).toEqual({ changes: 1, lastInsertRowid: 1 });
    db.prepare("INSERT INTO t (a, b) VALUES (@a, @b)").run({ a: "y", b: true, unused: "ignored" });
    expect(db.prepare("SELECT a, b FROM t ORDER BY id").all()).toEqual([{ a: "x", b: 1 }, { a: "y", b: 1 }]);
    expect(db.prepare("SELECT a FROM t WHERE id = ?").get(99)).toBeUndefined();
    expect(Object.getPrototypeOf(db.prepare("SELECT a FROM t").get())).toBe(Object.prototype);
  });

  it("commits, rolls back on error, and supports nested transactions", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    const add = db.prepare("INSERT INTO t (v) VALUES (?)");
    const count = () => (db.prepare("SELECT COUNT(*) c FROM t").get() as { c: number }).c;
    db.transaction(() => add.run(1))();
    expect(count()).toBe(1);
    expect(() =>
      db.transaction(() => {
        add.run(2);
        throw new Error("boom");
      })(),
    ).toThrow("boom");
    expect(count()).toBe(1);
    db.transaction(() => {
      add.run(3);
      try {
        db.transaction(() => {
          add.run(4);
          throw new Error("inner");
        })();
      } catch {
        /* inner rolled back only */
      }
    })();
    expect(db.prepare("SELECT v FROM t ORDER BY v").all().map((r) => r.v)).toEqual([1, 3]);
  });

  it("opens a file database in WAL mode and reopens existing data", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sq-")), "x.db");
    const a = createDb(file);
    a.$client.prepare("INSERT INTO runs (id, agent_id, status, started_at, last_event_at) VALUES ('r','a','success',1,1)").run();
    a.$client.close();
    const b = createDb(file);
    expect(b.$client.prepare("SELECT id FROM runs").all()).toEqual([{ id: "r" }]);
  });
});
