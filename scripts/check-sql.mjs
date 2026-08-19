/*
 * Parses every SQL file in supabase/ with PostgreSQL's own grammar.
 *
 *   npm run check:sql            # human output
 *   npm run check:sql -- --json  # machine output
 *
 * WHY. Nothing in supabase/ has ever been executed — there is no Supabase
 * project — and two consecutive audits found their worst defect in a file that
 * could not have run at all:
 *
 *   round 4  migration 007 selected documents.storage_path. The column is
 *            file_path. Postgres raises 42703, and because the SQL editor runs a
 *            pasted script as one transaction the ENTIRE migration rolls back.
 *            Nothing in it applied, while three public pages began stating the
 *            remediation as fact.
 *
 *   round 5  schema.sql was spliced by a script whose replacement string
 *            contained `$'` — a substitution pattern meaning "the portion after
 *            the match". JavaScript ate the delimiter, duplicated 626 lines and
 *            left an unterminated string literal. The one file the README calls
 *            the source of truth could not create a single table.
 *
 * Both were invisible to typecheck, the test suite and the production build,
 * because none of those look at SQL.
 *
 * This catches SYNTAX, not semantics: a column that does not exist still parses.
 * Running these files against a real database is still the only way to be sure,
 * and the README says so.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initPgParser from "pg-query-emscripten";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase");
const asJson = process.argv.includes("--json");

/*
 * The WASM build exhausts its heap partway through a thousand-line file and dies
 * with "Ma[...] is not a function" — which reads exactly like a parse failure and
 * would have made this check vacuously red, then deleted. So statements go in one
 * at a time and the module is replaced every so often.
 */
const STATEMENTS_PER_MODULE = 20;

/**
 * Splits SQL into statements, tracking the quoting Postgres actually uses.
 *
 * A naive split on ";" breaks on the plpgsql function bodies in functions.sql,
 * where the whole body is one dollar-quoted literal full of semicolons.
 */
function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    // -- line comment
    if (rest.startsWith("--")) {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }

    // /* block comment */ — Postgres nests these, so count depth.
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

    // 'string literal', with '' as the escape
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // "quoted identifier"
    if (sql[i] === '"') {
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      i++;
      continue;
    }

    // $tag$ dollar-quoted body $tag$
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      continue;
    }

    if (sql[i] === ";") {
      const text = sql.slice(start, i + 1);
      if (text.trim()) statements.push({ text, offset: start });
      i++;
      start = i;
      continue;
    }

    i++;
  }

  const tail = sql.slice(start);
  if (tail.trim()) statements.push({ text: tail, offset: start });

  return statements;
}

function files() {
  const out = [];
  for (const entry of readdirSync(DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sql")) out.push(entry.name);
    if (entry.isDirectory() && entry.name === "migrations") {
      for (const m of readdirSync(join(DIR, entry.name)).filter((f) => f.endsWith(".sql")).sort()) {
        out.push(`migrations/${m}`);
      }
    }
  }
  return out;
}

let pg = await initPgParser();
let sinceReload = 0;

async function parseOne(text) {
  if (sinceReload >= STATEMENTS_PER_MODULE) {
    pg = await initPgParser();
    sinceReload = 0;
  }
  sinceReload++;

  try {
    return pg.parse(text);
  } catch {
    // The module died rather than reporting. Retry once on a fresh one so a
    // heap death is never mistaken for a syntax error.
    pg = await initPgParser();
    sinceReload = 1;
    return pg.parse(text);
  }
}

// ---- guards the guard -------------------------------------------------------
// A parser that accepted everything would make every result below meaningless.
const SANITY = [
  { sql: "create table t (a int);", shouldFail: false },
  { sql: "create table t (a int;", shouldFail: true },
  // schema.sql line 441 exactly as it shipped, with the regex delimiter eaten.
  {
    sql: "create table t (\n  p text check (p ~ '^[A-Za-z0-9-]{1,8}\n  id uuid primary key\n);",
    shouldFail: true,
  },
];

for (const [index, probe] of SANITY.entries()) {
  const result = await parseOne(probe.sql);
  if (Boolean(result.error) !== probe.shouldFail) {
    console.error(`SANITY PROBE ${index} FAILED — the parser is not working; results are meaningless`);
    process.exit(2);
  }
}

// ---- the files --------------------------------------------------------------
const results = [];

for (const name of files()) {
  const sql = readFileSync(join(DIR, name), "utf8");
  const statements = splitStatements(sql);
  const problems = [];

  for (const statement of statements) {
    const { error } = await parseOne(statement.text);
    if (!error) continue;

    const absolute = statement.offset + (error.cursorpos ?? 0);
    problems.push({
      line: sql.slice(0, absolute).split("\n").length,
      message: error.message,
    });
  }

  results.push({ file: name, ok: problems.length === 0, statements: statements.length, problems });
}

const broken = results.filter((r) => !r.ok);

if (asJson) {
  console.log(JSON.stringify({ results, broken: broken.length }));
} else {
  for (const r of results) {
    if (r.ok) {
      console.log(`  ok    ${r.file}  (${r.statements} statements)`);
    } else {
      for (const p of r.problems) console.log(`  FAIL  ${r.file}:${p.line}  ${p.message}`);
    }
  }
  console.log(
    broken.length === 0
      ? `\n${results.length} files parse, ${results.reduce((n, r) => n + r.statements, 0)} statements.`
      : `\n${broken.length} of ${results.length} files DO NOT PARSE.`,
  );
}

process.exit(broken.length === 0 ? 0 : 1);
