import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentAccessStatuses } from "@/lib/documents";

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

/**
 * Runs one of the SQL scripts and reads back what it wrote.
 *
 * Through a FILE, not a pipe. These used to be read with execFileSync and a 32MB
 * maxBuffer from inside a vitest worker fork, and on Windows under load that
 * combination hung until the worker was killed — the suite went red on the clock
 * three times in one session with the SQL perfectly fine. A test that fails at
 * random teaches people to re-run until it is green, which is how a real failure
 * eventually gets waved through.
 *
 * Exit 1 means the script found problems and its report is still valid — that is
 * the case these tests exist to inspect. Exit 2 from check-sql means the PARSER
 * is broken, and then nothing it says about our files means anything, so that one
 * is raised rather than reported.
 */
function runScript(script: string, label: string): string {
  const out = join(tmpdir(), `myqare-${label}-${process.pid}.json`);

  try {
    execFileSync("node", [script, `--out=${out}`], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
  } catch (error) {
    const failure = error as { status?: number };
    if (failure.status === 2) throw new Error(`${script} could not run: its own sanity probes failed`);
  }

  try {
    const body = readFileSync(out, "utf8");
    unlinkSync(out);
    return body;
  } catch {
    throw new Error(`${script} produced no report at ${out}`);
  }
}
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

describe("every SQL file parses", () => {
  /*
   * 120s, not the 5s default.
   *
   * These three spawn a node subprocess — the SQL grammar in one case, a whole
   * PostgreSQL compiled to WASM in the other two. On an unloaded machine they
   * finish in two seconds; with anything else running they do not, and the test
   * then fails on the clock rather than on the SQL. A suite that goes red at
   * random teaches people to re-run it until it is green, which is how a real
   * failure gets waved through.
   */
  it("passes PostgreSQL's own grammar", { timeout: 120_000 }, () => {
    const output = runScript("scripts/check-sql.mjs", "sql-parse");

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

describe("schema.sql is executable top to bottom", () => {
  const schema = read("schema.sql");

  /*
   * Ordering, which the parser cannot see.
   *
   * `create function ... language sql` validates its body when the function is
   * created — check_function_bodies is on by default — so a helper that reads a
   * table declared further down the file raises 42P01 and, because the SQL editor
   * runs a paste as one transaction, takes the entire schema with it.
   *
   * That happened: migration 016's three definer helpers were folded in beside
   * the existing ones near the top, where the only table they needed (profiles)
   * already existed. Two of the three read tables defined hundreds of lines
   * later. npm run check:sql passed throughout, correctly — it parses grammar.
   *
   * Third time a fresh install has been broken by something no automated check
   * was looking at, which is why this one exists.
   */
  it("declares every function after the tables its body reads", () => {
    const tableAt = new Map<string, number>();
    for (const m of schema.matchAll(/create table if not exists (\w+)/g)) {
      if (!tableAt.has(m[1])) tableAt.set(m[1], m.index ?? 0);
    }

    const problems: string[] = [];

    /*
     * Each body matched to its OWN dollar-quote tag.
     *
     * A pattern ending at the next `$$;` runs straight past a body delimited
     * `$fn$`, swallowing everything up to the following function — which made
     * this report a trigger function as reading credit_ledger. The delimiter is
     * captured and required to close.
     */
    for (const fn of schema.matchAll(
      /create or replace function (\w+)\([\s\S]*?as (\$\w*\$)([\s\S]*?)\2;/g,
    )) {
      const name = fn[1];
      const block = fn[3];
      const at = fn.index ?? 0;

      for (const ref of block.matchAll(/\bfrom (\w+)\b/g)) {
        const table = ref[1];
        const declaredAt = tableAt.get(table);
        if (declaredAt === undefined) continue; // not one of ours (auth.users etc)
        if (declaredAt > at) {
          problems.push(`${name}() reads ${table}, which is created ${declaredAt - at} chars later`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("declares every function before the policy that calls it", () => {
    // A policy referencing a function that does not exist yet fails the same way.
    const fnAt = new Map<string, number>();
    for (const m of schema.matchAll(/create or replace function (\w+)\(/g)) {
      if (!fnAt.has(m[1])) fnAt.set(m[1], m.index ?? 0);
    }

    const problems: string[] = [];

    /*
     * Each policy bounded by the next top-level statement.
     *
     * Matching the body as "everything up to `\n  );`" is greedy past any policy
     * whose USING clause fits on one line — it swallowed six policies and blamed
     * `availability_select` for calling a function it never mentions. Bounding on
     * the next create/drop/alter/revoke keeps each body to itself.
     */
    for (const policy of schema.matchAll(
      /create policy \w+ on \w+ for \w+([\s\S]*?)(?=\n(?:create|drop|alter|revoke|grant|comment)\s|\n\/\*|$)/g,
    )) {
      const at = policy.index ?? 0;
      for (const [name, declaredAt] of fnAt) {
        // Escaped for the STRING, not just the regex: in a template literal `\b`
        // is a backspace character and `\(` is a bare paren, which produced
        // /current_role_names*(/ — an unterminated group.
        if (new RegExp(`\\b${name}\\s*\\(`).test(policy[1]) && declaredAt > at) {
          problems.push(`a policy at ${at} calls ${name}(), declared at ${declaredAt}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("the schema actually installs", () => {
  /*
   * Not read — RUN. Against PostgreSQL 18 compiled to WASM, in process.
   *
   * Seven audits read this SQL and three found a defect that meant a fresh
   * install created nothing: a column that does not exist, a file corrupted into
   * an unterminated literal, and helper functions declared before the tables
   * their bodies read. Every one was committed, and every one was invisible to
   * typecheck, this suite and the production build.
   *
   * scripts/check-sql.mjs closed the syntactic subset and could not have caught
   * any of the three. This can: it is the server, so the only opinion that
   * matters is its own.
   *
   * Out of process for the same reason as the parser — the WASM module does not
   * survive vitest's transform, and a failure there is indistinguishable from a
   * real one.
   */
  it("creates every table, policy and function on an empty database", { timeout: 120_000 }, () => {
    let output: string;

    try {
      output = execFileSync("node", ["scripts/install-check.mjs", "--json"], {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (error) {
      output = (error as { stdout?: string }).stdout ?? "";
    }

    const report = JSON.parse(output) as {
      broken: number;
      drift: string[];
      inventory: { tables: string[]; withoutRls?: string[] };
      results: { file: string; problems: { line: number; message: string }[] }[];
    };

    const failures = report.results.flatMap((r) =>
      r.problems.map((p) => `${r.file}:${p.line} — ${p.message}`),
    );

    // Only unexpected ones: two historical migrations refer to state a later
    // migration removed, which is why SETUP.md says not to run that directory on
    // a fresh database. install-check.mjs names them.
    expect(report.broken, failures.join("\n")).toBe(0);

    // A schema that installed nothing would otherwise pass everything above.
    expect(report.inventory.tables.length).toBeGreaterThanOrEqual(19);
    expect(report.inventory.withoutRls ?? []).toEqual([]);
  });

  it("ends up the same whether installed fresh or migrated", { timeout: 120_000 }, () => {
    /*
     * The drift question, answered by observation instead of by comparing files.
     *
     * schema.sql claims to be the current state. Replaying all eighteen
     * migrations over a fresh install must therefore change nothing: not a
     * table, not a policy's USING clause, not a function signature, not an index.
     * If it does, which database you have depends on when you set it up.
     */
    const report = JSON.parse(runScript("scripts/install-check.mjs", "install")) as {
      drift: string[];
    };
    expect(report.drift).toEqual([]);
  });
});

/*
 * One rule split across SQL and TypeScript, checked against each other.
 *
 * documents_select decides which facility may READ a document row; the pages
 * decide who gets a signed URL to the file itself. Those must agree, and they did
 * not: the policy filtered cancelled assignments out and the page counted every
 * assignment row, so a facility that booked somebody and cancelled still got
 * links to their VOG. documentUrl uses the service role, so the policy never got
 * a chance to catch the difference on the way past.
 */
describe("document access agrees between the policy and the code", () => {
  const policyOf = (name: string) => {
    const schema = read("schema.sql");
    const start = schema.indexOf(`create policy ${name} on`);
    expect(start, `${name} is missing from schema.sql`).toBeGreaterThan(-1);
    // Bounded to its own statement so a greedy match cannot blame the next policy.
    const end = schema.indexOf(";", start);
    return schema.slice(start, end);
  };

  it("documents_select still excludes cancelled assignments", () => {
    const policy = policyOf("documents_select");
    expect(policy).toContain("from assignments a");
    expect(policy).toMatch(/a\.status\s*<>\s*'cancelled'/);
  });

  it("the TypeScript predicate excludes the same status", () => {
    expect([...documentAccessStatuses]).not.toContain("cancelled");
    // And is not empty, which would pass the line above while granting nobody
    // anything — a green test over a broken screen.
    expect(documentAccessStatuses.size).toBeGreaterThan(0);
  });

  it("names only statuses the assignments table can actually hold", () => {
    const schema = read("schema.sql");
    const check = /status text not null default 'confirmed'\s*check \(status in \(([^)]*)\)\)/.exec(
      schema,
    );
    expect(check, "the assignments status constraint moved").not.toBeNull();

    const allowed = (check?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/'/g, ""));

    for (const status of documentAccessStatuses) {
      expect(allowed, `${status} is not a real assignment status`).toContain(status);
    }
  });
});
