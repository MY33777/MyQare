/*
 * Actually runs the schema, against a real PostgreSQL.
 *
 *   npm run check:install
 *
 * WHY. Seven audits have now read this SQL and three of them found a defect that
 * meant a fresh install created NOTHING: a column that does not exist (007), a
 * file corrupted into an unterminated string literal (schema.sql), and three
 * helper functions declared before the tables their bodies read (016). Each was
 * found by a person reading, after being committed, and each was invisible to
 * typecheck, the test suite and the production build.
 *
 * scripts/check-sql.mjs closed the syntactic subset. It cannot see a missing
 * column, a policy that recurses, or a declaration in the wrong order — the
 * exact three things that actually happened.
 *
 * PGlite is PostgreSQL compiled to WASM. Not a simulator, not a parser: the
 * server, running in-process. If the schema installs here it installs.
 *
 * WHAT THIS IS NOT. Supabase adds an auth schema, a storage schema and its own
 * roles, which are stubbed below to the minimum the SQL touches. A statement
 * that depends on real Supabase behaviour beyond those stubs is out of scope,
 * and the stubs are deliberately tiny so it is obvious what is being assumed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPA = join(ROOT, "supabase");
const asJson = process.argv.includes("--json");

/**
 * The parts of Supabase the schema leans on.
 *
 * Kept to exactly what our SQL references, so anything that passes here is
 * passing on its own merits rather than on a generous stub.
 */
const PREAMBLE = `
create schema if not exists auth;
create schema if not exists storage;

-- The three roles every grant and revoke in the schema names.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end
$$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Returns the current user's id. Null here, which is all the schema needs at
-- creation time: policies are only EVALUATED when rows are read.
create or replace function auth.uid() returns uuid language sql stable as $$
  select null::uuid;
$$;

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);

-- Supabase grants these on every table in public; migration 012 relies on the
-- table-level grant existing so it can be revoked.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

/*
 * pgcrypto is present on Supabase and absent from PGlite. Everything the schema
 * uses it for is gen_random_uuid(), which Postgres has had in core since 13 — so
 * the create-extension statement is skipped by the runner below rather than
 * faked here. Skipped explicitly, so it cannot quietly grow into a list.
 */
create extension if not exists plpgsql;
`;

/** Splits SQL into statements, respecting dollar-quoting. Same rules as check-sql. */
function splitStatements(sql) {
  const out = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (rest.startsWith("--")) {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (sql[i] === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      continue;
    }
    if (sql[i] === ";") {
      const text = sql.slice(start, i + 1);
      if (text.trim()) out.push({ text, offset: start });
      i++;
      start = i;
      continue;
    }
    i++;
  }

  const tail = sql.slice(start);
  if (tail.trim()) out.push({ text: tail, offset: start });
  return out;
}

/**
 * Runs one file statement by statement, reporting the first failure with a line.
 *
 * Statement by statement rather than as one string, because the SQL editor runs
 * a paste in a single transaction and reports only the first error — which tells
 * you nothing about what else is wrong. This keeps going.
 */
async function run(db, name, sql) {
  const problems = [];
  const skipped = [];
  let ok = 0;

  for (const statement of splitStatements(sql)) {
    /*
     * The one statement this harness cannot run. pgcrypto ships with Supabase and
     * not with PGlite; the schema uses it only for gen_random_uuid(), which is in
     * core Postgres since 13. Skipped explicitly rather than swallowed, so it
     * cannot quietly grow into a list.
     */
    if (/create extension if not exists pgcrypto/i.test(statement.text)) {
      skipped.push("create extension pgcrypto — provided by Supabase, in core since PG13");
      continue;
    }

    try {
      await db.exec(statement.text);
      ok++;
    } catch (error) {
      const line = sql.slice(0, statement.offset).split("\n").length;
      problems.push({
        line,
        message: String(error?.message ?? error).split("\n")[0],
        statement: statement.text.trim().split("\n")[0].slice(0, 90),
      });
    }
  }

  return { file: name, statements: ok, problems, skipped };
}

const results = [];

// ---- path A: a fresh install, exactly as SETUP.md prescribes ----
const fresh = await new PGlite();
await fresh.exec(PREAMBLE);

for (const file of ["schema.sql", "functions.sql"]) {
  results.push(await run(fresh, file, readFileSync(join(SUPA, file), "utf8")));
}

/** Everything the database contains, in a form two runs can be compared by. */
async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    tables: (await q(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.tablename),
    withoutRls: (await q(`select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by tablename`)).map((r) => r.tablename),
    // Policy NAMES and their expressions, so a rewritten USING clause shows up.
    policies: (await q(`select tablename || '.' || policyname || ':' || coalesce(qual, '') as p from pg_policies where schemaname = 'public' order by 1`)).map((r) => r.p),
    functions: (await q(`select proname || '/' || pronargs as f from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' order by 1`)).map((r) => r.f),
    indexes: (await q(`select indexname from pg_indexes where schemaname = 'public' order by 1`)).map((r) => r.indexname),
    triggers: (await q(`select tgname from pg_trigger where not tgisinternal order by 1`)).map((r) => r.tgname),
  };
}

// ---- what actually exists afterwards ----
let inventory = { tables: [], policies: 0, functions: [], indexes: 0, triggers: 0 };
try {
  const tables = await fresh.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const rls = await fresh.query(
    `select tablename from pg_tables where schemaname = 'public' and rowsecurity = false`,
  );
  const policies = await fresh.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`);
  const functions = await fresh.query(
    `select proname from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' order by proname`,
  );
  const indexes = await fresh.query(`select count(*)::int as n from pg_indexes where schemaname = 'public'`);
  const triggers = await fresh.query(
    `select count(*)::int as n from pg_trigger where not tgisinternal`,
  );

  inventory = {
    tables: tables.rows.map((r) => r.tablename),
    withoutRls: rls.rows.map((r) => r.tablename),
    policies: policies.rows[0].n,
    functions: functions.rows.map((r) => r.proname),
    indexes: indexes.rows[0].n,
    triggers: triggers.rows[0].n,
  };
} catch (error) {
  inventory.error = String(error?.message ?? error);
}

/*
 * ---- the migrations, run on top of the fresh install ----
 *
 * Every migration is written to be re-runnable — `if not exists`,
 * `create or replace`, `drop policy if exists` — so running the whole set
 * against a database that already has the final schema proves two things at once:
 *
 *   1. each migration is EXECUTABLE. Migration 007 selected a column that does
 *      not exist and nobody noticed for two rounds; this is what would have
 *      caught it in the second it took to run.
 *
 *   2. schema.sql already contains everything they do. If the object inventory
 *      changes, the two paths have diverged and a database built one way is not
 *      the database built the other.
 */
/*
 * Migrations whose subject a LATER migration removed.
 *
 * Replaying these over the final schema fails, and correctly so — they refer to
 * state that no longer exists. That is not a defect in them; it is why SETUP.md
 * says not to run the migrations directory on a fresh database.
 *
 * Listed with the reason so the list cannot grow quietly into a way of hiding
 * genuine failures. Everything not named here MUST run clean.
 */
const SUPERSEDED = {
  "002_lock_down_rpcs.sql":
    "defines settle_timesheet with p_fee_adjustment_cents; migration 005 renamed the parameter, and create-or-replace cannot rename one",
  "004_move_phone_out_of_profiles.sql":
    "reads and writes profiles.phone; migration 006 dropped the column and the current schema never creates it",
};

const migrationFiles = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const before = await snapshot(fresh);

for (const file of migrationFiles) {
  results.push(
    await run(fresh, `migrations/${file}`, readFileSync(join(SUPA, "migrations", file), "utf8")),
  );
}

const after = await snapshot(fresh);

const drift = [];
for (const key of ["tables", "functions", "policies", "indexes", "triggers"]) {
  const a = JSON.stringify(before[key]);
  const b = JSON.stringify(after[key]);
  if (a !== b) drift.push(`${key}: ${a} -> ${b}`);
}

const broken = results.filter(
  (r) => r.problems.length > 0 && !SUPERSEDED[r.file.replace("migrations/", "")],
);

const supersededSeen = results.filter(
  (r) => r.problems.length > 0 && SUPERSEDED[r.file.replace("migrations/", "")],
);

if (asJson) {
  console.log(JSON.stringify({ results, inventory, drift, broken: broken.length }));
} else {
  console.log("Fresh install (schema.sql then functions.sql), on PostgreSQL:\n");
  for (const r of results) {
    const expected = Boolean(SUPERSEDED[r.file.replace("migrations/", "")]);
    const mark = r.problems.length === 0 ? "ok  " : expected ? "old " : "FAIL";
    console.log(
      `  ${mark}  ${r.file} — ${r.statements} statements ran` +
        (r.skipped.length ? `, ${r.skipped.length} skipped` : ""),
    );
    for (const note of r.skipped) console.log(`         skipped: ${note}`);
    if (expected && r.problems.length > 0) {
      console.log(`         superseded: ${SUPERSEDED[r.file.replace("migrations/", "")]}`);
      continue;
    }
    for (const p of r.problems) {
      console.log(`         ${r.file}:${p.line}  ${p.message}`);
      console.log(`             ${p.statement}`);
    }
  }
  console.log(`\n  tables:    ${inventory.tables.length}`);
  console.log(`  policies:  ${inventory.policies}`);
  console.log(`  functions: ${inventory.functions.length}`);
  console.log(`  indexes:   ${inventory.indexes}`);
  console.log(`  triggers:  ${inventory.triggers}`);
  if (inventory.withoutRls?.length) {
    console.log(`  WITHOUT RLS: ${inventory.withoutRls.join(", ")}`);
  }
  console.log(`\n  migrations: ${migrationFiles.length} replayed over the fresh schema`);
  for (const r of supersededSeen) {
    console.log(`              ${r.file} superseded, as expected`);
  }

  /*
   * The drift check, done by observation rather than by reading.
   *
   * schema.sql claims to be the current state — everything the migrations do,
   * already folded in. If replaying all eighteen over a fresh install changes a
   * single table, policy expression, function signature, index or trigger, then
   * a database built one way is not the database built the other, and which one
   * you have depends on when you set it up.
   */
  if (drift.length === 0) {
    console.log("  drift:      none — schema.sql already contains everything they do");
  } else {
    console.log("  DRIFT — a fresh install and an incremental one differ:");
    for (const d of drift) console.log(`    ${d}`);
  }

  console.log(
    broken.length === 0 && drift.length === 0
      ? "\nThe schema installs, and the migrations agree with it."
      : `\n${broken.length} unexpected failure(s), ${drift.length} divergence(s).`,
  );
}

// Closed explicitly: leaving it open makes PGlite's libuv handle assert on exit
// under Windows, which looks exactly like a crash in the thing being tested.
await fresh.close();

process.exit(broken.length === 0 && drift.length === 0 && !inventory.withoutRls?.length ? 0 : 1);
