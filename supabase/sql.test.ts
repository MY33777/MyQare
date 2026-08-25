import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { documentAccessStatuses } from "@/lib/documents";

/*
 * Rules about the SQL that can be checked by reading it.
 *
 * Nothing in supabase/ has ever been run against a real database — there is no
 * Supabase project yet — and two consecutive audits found their worst defect in a
 * file that could not have executed. Migration 007 selected a column that does
 * not exist, so the whole migration would have rolled back with nothing applied.
 * schema.sql itself was later spliced by a script whose replacement string
 * contained `$'`, which JavaScript treats as "the portion after the match": it
 * ate the delimiter, duplicated 626 lines, and left an unterminated string
 * literal in the one file the README calls the source of truth.
 *
 * Typecheck, the rest of this suite and the production build all passed
 * throughout. None of them look at SQL.
 *
 * WHAT RUNS WHERE
 * ---------------
 * Two checks actually EXECUTE the SQL — parsing it with PostgreSQL's own grammar
 * and installing the whole schema into a PostgreSQL compiled to WASM. Both live
 * in scripts/, run as their own processes, and are chained ahead of vitest in
 * `npm test`:
 *
 *     npm run check:sql && npm run check:install && vitest run
 *
 * They used to run from inside this file via execFileSync. On Windows that killed
 * the vitest worker about two runs in five, taking all thirteen tests here with
 * it and reporting "1 failed | 372 passed" for a codebase where nothing was
 * wrong. Raising the timeout did not help — the worker dies, it does not time out
 * — and neither did writing the report to a file instead of a pipe. Spawning a
 * subprocess from a test worker is the wrong shape, not a thing to tune.
 *
 * Nothing was lost by moving them: both scripts exit non-zero on failure and
 * print a better report than an assertion could, and a red suite now means a real
 * defect rather than a coin flip.
 *
 * Everything below is pure string work over the SQL, and stays here so it can be
 * read next to the rules it checks.
 */

const DIR = join(process.cwd(), "supabase");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

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
    /*
     * The dollar-quote tag is READ, not assumed.
     *
     * This looked for "\n$fn$;". functions.sql uses $fn$ throughout, so it worked
     * there and found nothing at all in schema.sql, where eighteen of the twenty
     * delimiters are a bare $ — which is why widening the guard to schema.sql
     * silently found ten functions instead of twenty until this was fixed. A
     * guard that reads no bodies passes.
     */
    const body = (sql: string, name: string): string | null => {
      const start = sql.indexOf(`create or replace function ${name}(`);
      if (start === -1) return null;

      const tag = sql.slice(start).match(/\$[a-z_]*\$/);
      if (!tag) return null;

      const open = sql.indexOf(tag[0], start);
      const end = sql.indexOf(`\n${tag[0]};`, open + tag[0].length);
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

    /*
     * EVERY function in BOTH canonical files, not a hand-kept list of three.
     *
     * The list used to name accept_shift, settle_timesheet and cancel_assignment
     * — the three that existed when this was written — so anonymise_account, the
     * most destructive function in the product, was added later and checked by
     * nothing. A drift guard that covers the functions somebody remembered to add
     * is a drift guard for the functions least likely to drift.
     *
     * Deriving the list fixed that and left half the surface uncovered: it read
     * functions.sql only, and the ten functions that live in schema.sql —
     * is_staff, current_org_id, can_manage_admins and the rest, which every RLS
     * policy in the product depends on — were still checked by nothing. A
     * migration that redefines one of those drifts from the fresh install in
     * silence, and the thing that drifts is who can read what.
     *
     * Each function is compared against whichever canonical file declares it.
     */
    const canonicalSources = [
      { file: "functions.sql", sql: functions },
      { file: "schema.sql", sql: read("schema.sql") },
    ];

    const declared = canonicalSources.flatMap(({ file, sql }) =>
      [
        ...new Set(
          [...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*)\s*\(/gi)].map(
            (m) => m[1],
          ),
        ),
      ]
        .filter((name) => body(sql, name))
        .map((name) => ({ name, file, sql })),
    );

    expect(
      declared.length,
      "no function bodies found in schema.sql or functions.sql",
    ).toBeGreaterThan(10);

    // A function declared in both files would make "canonical" ambiguous, and the
    // migrations could only ever match one of them.
    const seen = new Map<string, string>();
    for (const { name, file } of declared) {
      expect(
        seen.get(name) ?? file,
        `${name} is declared in both schema.sql and functions.sql`,
      ).toBe(file);
      seen.set(name, file);
    }

    for (const { name, file, sql } of declared) {
      const canonical = body(sql, name);

      const latest = [...migrations].reverse().find((m) => body(m.sql, name));
      if (!latest) continue;

      expect(
        body(latest.sql, name),
        `${name} differs between ${file} and migrations/${latest.name}`,
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

/*
 * THE TWO EXECUTION CHECKS DO NOT LIVE HERE ANY MORE.
 *
 * "the schema actually installs" and "ends up the same whether installed fresh or
 * migrated" both ran a node subprocess from inside a vitest worker fork — one to
 * parse with PostgreSQL's grammar, one to boot a whole PostgreSQL compiled to
 * WASM. On Windows that killed the worker about two runs in five, taking all
 * thirteen tests in this file with it and reporting "1 failed | 372 passed" for a
 * codebase where nothing was wrong.
 *
 * Raising the timeout did not help (the worker dies, it does not time out) and
 * neither did writing the report to a file instead of a pipe. The honest
 * conclusion is that spawning a subprocess from a test worker is the wrong shape,
 * not that it needed tuning.
 *
 * So they run as their own processes, before vitest, chained into `npm test`:
 *
 *     npm run check:sql && npm run check:install && vitest run
 *
 * Nothing is lost. Both scripts exit non-zero on failure and print a far better
 * report than an assertion could, `npm test` still covers everything, and a red
 * suite now means a real defect rather than a coin flip. Everything left in this
 * file is pure string work over the SQL and stays where it can be read next to
 * the rules it checks.
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

/*
 * SETUP.md tells the operator what a correct install looks like, and those
 * numbers are the only way to tell a clean run from a half-applied one — the SQL
 * editor runs a pasted file as one transaction, so a failure means nothing
 * landed, and the way you find out is by counting.
 *
 * Both numbers were wrong: "19 tables" against 20, and "four functions, plus the
 * helpers" against 17. A correct install and a partial one produced answers that
 * looked equally plausible, which is worse than no verification step at all —
 * it converts a check into a rubber stamp.
 */
describe("SETUP.md describes the schema it ships with", () => {
  const setup = readFileSync(join(DIR, "..", "SETUP.md"), "utf8");
  const schema = read("schema.sql");
  const functions = read("functions.sql");

  it("states the right number of tables", () => {
    const actual = [...schema.matchAll(/^create table /gim)].length;
    const claimed = setup.match(/`supabase\/schema\.sql` — (\d+) tables/);

    expect(claimed, "SETUP.md no longer states a table count").toBeTruthy();
    expect(Number(claimed![1]), "SETUP.md's table count").toBe(actual);
  });

  it("states the right number of functions, and names every one", () => {
    const names = [
      ...new Set(
        [...(schema + functions).matchAll(
          /create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*)\s*\(/gi,
        )].map((m) => m[1]),
      ),
    ].sort();

    const claimed = setup.match(/\*\*(\d+)\.\*\* If it is fewer/);
    expect(claimed, "SETUP.md no longer states a function count").toBeTruthy();
    expect(Number(claimed![1]), "SETUP.md's function count").toBe(names.length);

    // And the list beside it, so a renamed function is caught too.
    for (const name of names) {
      expect(setup, `SETUP.md does not name ${name}`).toContain(name);
    }
  });
});

/*
 * The claim that justifies the most destructive statement in the product.
 *
 * anonymise_account deletes every documents row, and the comment above it — in
 * functions.sql and in migrations 029, 030 and 032 — argues that is safe because
 * the Wkkgz evidence is rendered from the acceptance snapshot instead. It names
 * two surfaces and asserts "lib/dossierPdf.test.ts fails if either stops".
 *
 * Only one of those was true. dossierPdf.test.ts renders the PDF and reads its
 * text; nothing anywhere read the dossier PAGE, so somebody could drop the
 * column from the screen and npm test would stay green while half the evidence
 * quietly disappeared for every facility that engaged the erased person.
 *
 * A source-level check rather than a render, because the page is a Server
 * Component that needs a database. It is coarse and it is enough: it fails the
 * moment the column or its reader is removed, which is the regression the
 * comment claims is impossible.
 */
describe("the dossier screen still renders the document evidence", () => {
  const page = readFileSync(
    join(DIR, "..", "app", "zorginstelling", "dossier", "page.tsx"),
    "utf8",
  );

  it("has the column anonymise_account's comment says it has", () => {
    expect(page).toContain("Documenten bij aanvang");
  });

  it("reads the documents block out of the snapshot", () => {
    expect(page).toContain("snap?.freelancer?.documents");
  });

  it("tells an absent capture apart from an empty one", () => {
    expect(page).toContain("Niet vastgelegd");
    expect(page).toContain("Geen goedgekeurde documenten");
  });
});
