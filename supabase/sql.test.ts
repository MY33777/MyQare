import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Two things nothing else in this project checks: that the SQL is executable at
 * all, and that a fresh install and an incremental one end up the same.
 *
 * Nothing in supabase/ has ever been run — there is no Supabase project — and two
 * consecutive audits found their worst defect in a file that could not have
 * executed. Migration 007 selected a column that does not exist, so the whole
 * migration would have rolled back with nothing applied. schema.sql itself was
 * later spliced by a script whose replacement string contained `$'`, which
 * JavaScript treats as "the portion after the match": it ate the delimiter,
 * duplicated 626 lines, and left an unterminated string literal in the one file
 * the README calls the source of truth.
 *
 * Typecheck, the rest of this suite and the production build all passed
 * throughout. None of them look at SQL.
 *
 * The parse itself runs in scripts/check-sql.mjs, out of process: it uses
 * PostgreSQL's own grammar compiled to WASM, and that module does not survive
 * vitest's module transform — it fails in a way indistinguishable from a syntax
 * error, which would have made this vacuously red and then deleted.
 */

const DIR = join(process.cwd(), "supabase");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

describe("every SQL file parses", () => {
  it("passes PostgreSQL's own grammar", () => {
    let output: string;

    try {
      output = execFileSync("node", ["scripts/check-sql.mjs", "--json"], {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      // Exit 1 means files failed to parse; the JSON is still on stdout. Exit 2
      // means the parser's own sanity probes failed, and then nothing it says
      // about our files means anything.
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      if (failure.status === 2) throw new Error(`SQL parser is not working: ${failure.stderr}`);
      output = failure.stdout ?? "";
    }

    const report = JSON.parse(output) as {
      broken: number;
      results: { file: string; ok: boolean; problems: { line: number; message: string }[] }[];
    };

    // A glob that matched nothing would make this pass silently.
    expect(report.results.length).toBeGreaterThanOrEqual(13);

    const failures = report.results
      .filter((r) => !r.ok)
      .flatMap((r) => r.problems.map((p) => `${r.file}:${p.line} — ${p.message}`));

    expect(failures).toEqual([]);
  });
});

describe("schema.sql is internally coherent", () => {
  const schema = read("schema.sql");
  const created = [...schema.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);

  it("declares each table exactly once", () => {
    // The corruption duplicated the whole tail of the file, so every table in it
    // existed twice with different bodies. Parsing alone would not catch that:
    // `create table if not exists` is valid however many times it appears.
    const duplicated = created.filter((name, i) => created.indexOf(name) !== i);
    expect(duplicated).toEqual([]);
  });

  it("enables row level security on every table it creates", () => {
    const secured = new Set(
      [...schema.matchAll(/alter table (\w+) enable row level security/g)].map((m) => m[1]),
    );
    // A policy on a table whose RLS is off is silently inert — Postgres accepts
    // it, lists it in pg_policies, and never enforces it.
    expect(created.filter((t) => !secured.has(t))).toEqual([]);
  });

  it("revokes client writes on every table it creates", () => {
    const revoked = new Set(
      [...schema.matchAll(/revoke insert, update, delete on (\w+) from/g)].map((m) => m[1]),
    );
    // Migration 005 removed every write policy: writes go through the service
    // role. A table missing this grant is writable by any signed-in user.
    expect(created.filter((t) => !revoked.has(t))).toEqual([]);
  });
});

describe("functions.sql", () => {
  const functions = read("functions.sql");

  it("revokes execute on every function it defines", () => {
    const defined = [...functions.matchAll(/create or replace function (\w+)\(/g)].map((m) => m[1]);

    // These are security definer and take the caller's identity as a parameter,
    // so a grant to `authenticated` lets any signed-in user accept work as
    // somebody else or move credit. See the header in functions.sql.
    const missing = defined.filter(
      (name) => !new RegExp(`revoke all on function ${name}\\(`).test(functions),
    );
    expect(missing).toEqual([]);
  });

  it("matches the latest migration that redefines each function", () => {
    /*
     * schema.sql and functions.sql are the CURRENT state, so a fresh install and
     * an incremental one must agree. settle_timesheet and cancel_assignment have
     * each been rewritten three times and accept_shift twice; a drifted copy
     * would make the two paths diverge silently.
     *
     * Comments are stripped before comparing. The two copies are allowed to
     * explain themselves differently — a migration argues for the change it
     * makes, functions.sql describes the resulting state — and holding them to
     * identical prose would make this fire on every edit until somebody deleted
     * it. What must not differ is a statement.
     */
    const body = (sql: string, name: string): string | null => {
      const start = sql.indexOf(`create or replace function ${name}(`);
      if (start === -1) return null;
      const end = sql.indexOf("\n$fn$;", start);
      if (end === -1) return null;

      return sql
        .slice(start, end)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/--.*$/, "").trim())
        .filter(Boolean)
        .join("\n");
    };

    const migrations = readdirSync(join(DIR, "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ name: f, sql: readFileSync(join(DIR, "migrations", f), "utf8") }));

    for (const name of ["accept_shift", "settle_timesheet", "cancel_assignment"]) {
      const canonical = body(functions, name);
      expect(canonical, `${name} is missing from functions.sql`).toBeTruthy();

      const latest = [...migrations].reverse().find((m) => body(m.sql, name));
      if (!latest) continue;

      expect(
        body(latest.sql, name),
        `${name} differs between functions.sql and migrations/${latest.name}`,
      ).toBe(canonical);
    }
  });
});
