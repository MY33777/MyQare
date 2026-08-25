/**
 * Checks every PostgREST embed in the codebase against the real foreign keys.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase.from("invoices").select("profiles!invoices_freelancer_id_fkey(full_name)")`
 * compiles, typechecks, and passes every test in this repo. It also cannot work:
 * `invoices.freelancer_id` references `freelancers(profile_id)`, not `profiles`,
 * so there is no invoices→profiles relationship for PostgREST to resolve and the
 * request comes back PGRST200.
 *
 * That defect was found once, in the document-expiry cron, and fixed once — while
 * twelve identical embeds sat untouched across the facility side of the product,
 * including the two that send the invoice and render its PDF. Nothing could catch
 * them: `.returns<T>()` is an assertion, not a check, and the error only appears
 * against a live database with real rows.
 *
 * So the FK graph is read out of schema.sql, every `.select()` string in the repo
 * is parsed as PostgREST parses it, and every embed is resolved against that
 * graph. An embed that names a table its parent has no relationship to is an
 * error. A hint that names a constraint pointing somewhere else is an error.
 *
 * Runs as part of `npm test`, offline, in under a second.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "supabase", "schema.sql");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SCAN_DIRS = ["app", "lib", "components", "scripts"];

/* ------------------------------------------------------------------ schema */

/**
 * Every foreign key, as {table, column, target, constraint}.
 *
 * Two syntaxes carry one: the inline `col type references t(c)` used throughout
 * schema.sql, and the explicit `alter table ... add constraint N foreign key ...`
 * the migrations use when they need to change one. Both are read, because 025
 * recreated five constraints by name and those names are what a hint must match.
 */
function readForeignKeys() {
  const keys = [];
  const tables = new Set();

  const files = [SCHEMA, ...listSql(MIGRATIONS)];

  for (const file of files) {
    const sql = stripComments(readFileSync(file, "utf8"));

    // create table x ( ... );
    const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let m;
    while ((m = tableRe.exec(sql))) {
      const table = m[1].toLowerCase();
      tables.add(table);
      const body = balanced(sql, m.index + m[0].length - 1);
      if (body === null) continue;

      for (const line of splitTopLevel(body)) {
        const inline = line.match(
          /^\s*([a-z_][a-z0-9_]*)\s+[a-z0-9_ [\]()]*?references\s+([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)/i,
        );
        if (inline && inline[1].toLowerCase() !== "foreign") {
          keys.push({
            table,
            column: inline[1].toLowerCase(),
            target: inline[2].toLowerCase(),
            targetColumn: inline[3].toLowerCase(),
            // Postgres's default name, which is what a PostgREST hint sees.
            constraint: `${table}_${inline[1].toLowerCase()}_fkey`,
          });
          continue;
        }

        const tableLevel = line.match(
          /foreign\s+key\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*references\s+([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)/i,
        );
        if (tableLevel) {
          const named = line.match(/constraint\s+([a-z_][a-z0-9_]*)/i);
          keys.push({
            table,
            column: tableLevel[1].toLowerCase(),
            target: tableLevel[2].toLowerCase(),
            targetColumn: tableLevel[3].toLowerCase(),
            constraint: (named?.[1] ?? `${table}_${tableLevel[1].toLowerCase()}_fkey`).toLowerCase(),
          });
        }
      }
    }

    // alter table x add constraint n foreign key (c) references t(c)
    const alterRe =
      /alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+add\s+constraint\s+([a-z_][a-z0-9_]*)\s+foreign\s+key\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*references\s+([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)/gi;
    while ((m = alterRe.exec(sql))) {
      const table = m[1].toLowerCase();
      const constraint = m[2].toLowerCase();
      // A migration replacing a constraint wins over the inline declaration.
      const i = keys.findIndex((k) => k.table === table && k.constraint === constraint);
      const entry = {
        table,
        column: m[3].toLowerCase(),
        target: m[4].toLowerCase(),
        targetColumn: m[5].toLowerCase(),
        constraint,
      };
      if (i >= 0) keys[i] = entry;
      else keys.push(entry);
    }

    for (const v of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+([a-z_][a-z0-9_]*)/gi)) {
      tables.add(v[1].toLowerCase());
    }
  }

  /*
   * schema.sql and the migrations both declare the same tables — `create table
   * if not exists` is how a migration stays re-runnable — so every foreign key
   * declared before a migration touched it is read twice. Left in, two identical
   * entries look like two different relationships and the checker demands a hint
   * for an embed that needs none.
   */
  const unique = [];
  const seen = new Set();
  for (const k of keys) {
    const id = `${k.table}.${k.column}->${k.target}.${k.targetColumn}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(k);
  }

  return { keys: unique, tables };
}

/**
 * Every column, per table, so a select can be checked against what exists.
 *
 * The FK graph alone would have passed `profiles:freelancer_id(full_name)`: read
 * as PostgREST reads it that is an embed of whatever `freelancer_id` points at,
 * aliased to "profiles" — which resolves, to `freelancers`, a table with no
 * `full_name`. Relationship right, column wrong, same runtime error.
 */
function readColumns() {
  const columns = new Map();
  const add = (table, column) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(column);
  };

  const CONSTRAINT_WORDS = /^(primary|foreign|unique|check|constraint|exclude|like)\b/i;

  for (const file of [SCHEMA, ...listSql(MIGRATIONS)]) {
    const sql = stripComments(readFileSync(file, "utf8"));

    const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
    let m;
    while ((m = tableRe.exec(sql))) {
      const table = m[1].toLowerCase();
      const body = balanced(sql, m.index + m[0].length - 1);
      if (body === null) continue;

      for (const raw of splitTopLevel(body)) {
        const line = raw.trim();
        if (!line || CONSTRAINT_WORDS.test(line)) continue;
        const name = line.match(/^([a-z_][a-z0-9_]*)\s+\S/i);
        if (name) add(table, name[1].toLowerCase());
      }
    }

    for (const a of sql.matchAll(
      /alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      add(a[1].toLowerCase(), a[2].toLowerCase());
    }

    for (const d of sql.matchAll(
      /alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      columns.get(d[1].toLowerCase())?.delete(d[2].toLowerCase());
    }
  }

  return columns;
}

function listSql(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The contents of a parenthesised group starting at `open`, ignoring anything
 * inside a string literal.
 *
 * This was a bare paren counter, and the one shape in the repo it could not read
 * is the one that matters most:
 *
 *   .select(COLUMNS.replace("timesheets(", "timesheets!inner("))
 *
 * Two opening parens inside string literals, neither of them closed. The counter
 * ran past the real close looking for two more, returned null, and findSelects
 * did `continue` — so the query behind the facility's hours-approval queue was
 * neither checked NOR listed as unchecked, while the summary line said every
 * embed resolves. I proved it by putting a nonexistent table in that select and
 * watching the checker report 135 clean selects, the same count as before.
 *
 * A guard with a silent false negative is worse than no guard, because the
 * codebase then trusts it. Strings are skipped whole, escapes included.
 */
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];

    if (c === '"' || c === "'" || c === "\`") {
      i = skipString(text, i);
      continue;
    }

    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * The index of the closing quote of the string starting at `i`.
 *
 * Returns the last index of the literal, so a `for` loop's own `i++` lands
 * after it. A trailing backslash at end-of-input returns the end, which
 * terminates the caller rather than looping.
 */
function skipString(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === quote) return j;
  }
  return text.length;
}

/**
 * Splits on commas that are not inside parentheses or a string literal.
 *
 * Same blindness as balanced() had, and the same fix. A field list is not
 * normally a JavaScript expression, but this also runs over the argument of a
 * `.replace()` chain, where a comma between two quoted arguments would otherwise
 * split one literal in half.
 */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "\`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/* ------------------------------------------------------------- select scan */

function listSource(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/**
 * Comments out, before anything is scanned.
 *
 * Without this the checker fails on its own docblock, which quotes the broken
 * embed it exists to describe — and a select commented out during debugging would
 * be reported as live code. Quotes are tracked so a `//` inside a URL, or a slash
 * star inside a select string, survives.
 */
function stripJs(source) {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      /*
       * The newlines are kept. Dropping them shifted every reported line number
       * by the length of the docblock above it — this file's own report pointed
       * at lib/invoices.ts:230 for a select on line 342 — and a checker that
       * names the wrong line sends somebody to read the wrong code.
       */
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/**
 * The string literals making up a select's FIRST argument, concatenated.
 *
 * Must be string-aware, and the first attempt was not: it split the argument on
 * top-level commas to drop the options object, using a paren-counting splitter
 * that knows nothing about quotes. Every real select contains commas inside its
 * string — that is what separates the columns — so each one was cut after "id,
 * number, and the remaining fragment held no closing quote, so it parsed as no
 * literals at all and the select was skipped. The checker reported that all 42
 * selects it could see were fine while silently seeing none of the interesting
 * ones, which is the same shape of failure it was written to catch.
 *
 * So: walk the argument, consume whole string literals, and stop at the first
 * comma reached OUTSIDE one. Concatenation ("a" + "b") is handled for free.
 */
function firstArgLiterals(arg) {
  const literals = [];
  let i = 0;
  let depth = 0;

  while (i < arg.length) {
    const c = arg[i];

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let buf = "";
      i++;
      while (i < arg.length) {
        if (arg[i] === "\\") {
          buf += arg[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (arg[i] === quote) {
          i++;
          break;
        }
        buf += arg[i];
        i++;
      }
      literals.push(buf);
      continue;
    }

    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) break; // the options argument starts here

    i++;
  }

  return literals;
}

/**
 * Every `.from("t")....select("...")` pair in a file.
 *
 * The chain is followed rather than the file scanned for selects, because an
 * embed can only be judged against the table it hangs off. A `.select()` with no
 * literal argument (a variable, or nothing at all) is skipped: there is nothing
 * to parse, and guessing would produce noise.
 */
/**
 * File-level `const NAME = "…" + "…";` bindings, so a select can name one.
 *
 * Without this the checker is blind to exactly the refactor that a long select
 * invites — pulling the column list into a constant and reusing it — and goes
 * quiet instead of complaining. It went quiet on the first one written after it
 * existed. Only string literals and their concatenation are resolved; anything
 * computed is left unresolved and COUNTED, so the coverage is reported rather
 * than assumed.
 */
function stringConstants(source) {
  const bindings = new Map();

  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g)) {
    const value = m[2];
    // A literal, or literals joined by +, and nothing else.
    if (!/^\s*["'`]/.test(value)) continue;
    if (/[^\s"'`+\w\-,.:!()[\]{}@*=>|$#/\\]/.test(value.replace(/["'`][^"'`]*["'`]/g, ""))) continue;
    const literals = firstArgLiterals(value);
    if (literals.length > 0) bindings.set(m[1], literals.join(""));
  }

  return bindings;
}

function findSelects(source) {
  const found = [];
  const bindings = stringConstants(source);
  const fromRe = /\.from\(\s*"([a-z_][a-z0-9_]*)"\s*\)/g;
  let m;

  while ((m = fromRe.exec(source))) {
    const table = m[1];
    const after = source.slice(m.index + m[0].length);

    // The select belonging to THIS chain: before any other .from(.
    const nextFrom = after.search(/\.from\(\s*"/);
    const scope = nextFrom === -1 ? after : after.slice(0, nextFrom);

    const sel = scope.match(/\.select\(/);
    if (!sel) continue;

    const open = scope.indexOf("(", sel.index);
    const line = source.slice(0, m.index).split("\n").length;
    const arg = balanced(scope, open);

    /*
     * A select whose argument cannot be read is REPORTED, never dropped.
     *
     * This was `continue`, which is how the approval-queue query disappeared:
     * not checked, not counted, not listed, while the summary said every embed
     * resolves. Anything this parser cannot read has to show up in the "not
     * checked" list, so the number at the bottom is a claim about coverage
     * rather than about the parser's appetite.
     */
    if (arg === null) {
      found.push({ table, select: null, line });
      continue;
    }
    const literals = firstArgLiterals(arg);

    /*
     * A named constant, possibly with a modifier applied to it.
     *
     * Keyed on the argument STARTING with an identifier rather than on there
     * being no literals in it. `COLUMNS.replace("a", "b")` has two literals — the
     * replace arguments — so the old `literals.length === 0` guard sent it down
     * the branch that treats the whole thing as a field list, and the branch
     * written for this exact idiom, quoting this exact line in its comment, could
     * never run. Class (e) sitting inside class (g).
     */
    const named = arg.match(/^\s*([A-Za-z_$][\w$]*)\b/);

    if (named && !/^\s*["'`]/.test(arg)) {
      const bound = named ? bindings.get(named[1]) : undefined;
      if (bound === undefined) {
        found.push({ table, select: null, line });
        continue;
      }
      /*
       * `.select(COLUMNS.replace("timesheets(", "timesheets!inner("))` is a real
       * idiom in this codebase — one column list, filtered two ways. Applied
       * literally so the checked string is the string that will be sent.
       */
      let select = bound;
      for (const r of arg.matchAll(/\.replace\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
        select = select.split(r[1]).join(r[2]);
      }
      found.push({ table, select, line });
      continue;
    }

    /*
     * Anything left: a template literal with interpolation, a ternary, a call.
     * An empty join is NOT an empty field list — it means nothing was resolved —
     * so it goes on the unchecked list rather than passing as a select with no
     * columns, which resolves trivially and would read as covered.
     */
    const joined = literals.join("");
    found.push({ table, select: joined === "" ? null : joined, line });
  }

  return found;
}

/**
 * PostgREST's select grammar, as far as embeds are concerned.
 *
 *   field := [alias:]name[!hint][!inner|!left][(nested)]
 *
 * A field with parentheses is an embed; one without is a column and is ignored.
 * `!inner` and `!left` are join modifiers, not relationship hints, so they are
 * stripped before the hint is read.
 */
function parseFields(select) {
  const embeds = [];
  const columns = [];

  for (const raw of splitTopLevel(select)) {
    const field = raw.trim();
    if (!field) continue;

    if (!field.includes("(")) {
      /*
       * A plain column. Everything after the name is a cast, a JSON path or an
       * ordering modifier, and none of those change which column is being asked
       * for — so the name is taken and the rest dropped. `*` names all of them.
       */
      let name = field;
      if (name.includes(":")) name = name.slice(name.indexOf(":") + 1).trim();
      name = name.split("::")[0].split("->")[0].split("!")[0].trim();
      if (name && name !== "*" && /^[a-z_][a-z0-9_]*$/i.test(name)) columns.push(name.toLowerCase());
      continue;
    }

    const open = field.indexOf("(");
    const head = field.slice(0, open).trim();
    const nested = balanced(field, open);

    // json->>'x' and similar are columns, not embeds.
    if (/[>\-]/.test(head)) continue;

    const parts = head.split("!").map((p) => p.trim());
    let name = parts[0];
    const hints = parts.slice(1).filter((h) => h !== "inner" && h !== "left");

    let alias = null;
    if (name.includes(":")) {
      const [a, n] = name.split(":");
      alias = a.trim();
      name = n.trim();
    }

    if (!/^[a-z_][a-z0-9_]*$/.test(name)) continue;

    embeds.push({ target: name, hint: hints[0] ?? null, alias, nested: nested ?? "" });
  }

  return { embeds, columns };
}

/* --------------------------------------------------------------- resolving */

function resolve(parent, embed, keys, tables) {
  const { target, hint } = embed;

  if (!tables.has(target)) {
    /*
     * PostgREST also lets a relationship be named by the foreign key COLUMN, so
     * `freelancer_id(full_name)` is a legal embed of whatever that column points
     * at. Combined with an alias — `profiles:freelancer_id(full_name)` — it reads
     * as an embed of `profiles` and is not one: it resolves through the column,
     * to `freelancers`, and the alias only renames the result. That is the shape
     * of the defect in lib/invoices.ts, and it has to be resolved rather than
     * rejected so the columns underneath get checked against the RIGHT table.
     */
    const byColumn = keys.find((k) => k.table === parent && k.column === target);
    if (byColumn) return { ok: true, target: byColumn.target };

    return { ok: false, why: `no table, view or foreign key column named "${target}" exists` };
  }

  // Many-to-one: the parent holds the foreign key.
  const forward = keys.filter((k) => k.table === parent && k.target === target);
  // One-to-many: the target holds it.
  const reverse = keys.filter((k) => k.table === target && k.target === parent);
  const all = [
    ...forward.map((k) => ({ ...k, direction: "forward" })),
    ...reverse.map((k) => ({ ...k, direction: "reverse" })),
  ];

  if (all.length === 0) {
    /*
     * The failure this whole script exists for. Named specifically when the
     * parent reaches the target through exactly one other table, because that is
     * always the shape here — freelancers sits between everything and profiles —
     * and the fix is to nest rather than to change the hint.
     */
    const via = keys
      .filter((k) => k.table === parent)
      .find((k) => keys.some((j) => j.table === k.target && j.target === target));

    return {
      ok: false,
      why:
        `no foreign key connects "${parent}" and "${target}"` +
        (via
          ? `; ${parent}.${via.column} references ${via.target}, so nest it: ${via.target}(${target}(…))`
          : ""),
    };
  }

  if (hint) {
    const matched = all.find((k) => k.constraint === hint || k.column === hint);
    if (!matched) {
      const wrong = keys.find((k) => k.constraint === hint);
      return {
        ok: false,
        why:
          `hint "${hint}" does not describe any ${parent}→${target} relationship` +
          (wrong ? `; that constraint points at "${wrong.target}", not "${target}"` : ""),
      };
    }
  }

  if (!hint && all.length > 1) {
    return {
      ok: false,
      why: `${all.length} relationships connect "${parent}" and "${target}"; PostgREST needs a hint`,
    };
  }

  return { ok: true, target };
}

function walk(parent, select, graph, problems, where) {
  const { keys, tables, columns } = graph;
  const { embeds, columns: asked } = parseFields(select);

  const known = columns.get(parent);
  if (known) {
    for (const column of asked) {
      if (known.has(column)) continue;
      // A relationship can be selected by name without parentheses too; that is
      // an embed, not a missing column.
      if (tables.has(column)) continue;
      problems.push({
        ...where,
        path: `${parent}.${column}`,
        why: `"${parent}" has no column "${column}"`,
      });
    }
  }

  for (const embed of embeds) {
    const result = resolve(parent, embed, keys, tables);
    if (!result.ok) {
      problems.push({ ...where, path: `${parent} → ${embed.target}`, why: result.why });
      continue;
    }
    walk(result.target, embed.nested, graph, problems, where);
  }
}

/* -------------------------------------------------------------------- main */

const { keys, tables } = readForeignKeys();
const columns = readColumns();
const graph = { keys, tables, columns };

if (keys.length === 0 || columns.size === 0) {
  console.error("check-embeds: no schema found in supabase/schema.sql — refusing to pass.");
  process.exit(1);
}

const problems = [];
const unresolved = [];
let checked = 0;

for (const dir of SCAN_DIRS) {
  for (const file of listSource(dir)) {
    const source = stripJs(readFileSync(file, "utf8"));
    for (const { table, select, line } of findSelects(source)) {
      const where = { file: relative(ROOT, file).replace(/\\/g, "/"), line };
      if (select === null) {
        unresolved.push(where);
        continue;
      }
      checked++;
      walk(table, select, graph, problems, where);
    }
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-embeds: ${problems.length} embed(s) PostgREST cannot resolve.\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`);
    console.error(`    ${p.path}`);
    console.error(`    ${p.why}\n`);
  }
  process.exit(1);
}

console.log(
  `check-embeds: ${checked} selects, ${keys.length} foreign keys, ${columns.size} tables — every embed and column resolves.`,
);

/*
 * Named, not hidden. A select whose argument is computed cannot be checked, and a
 * checker that reports only what it looked at reads as though it looked at
 * everything — which is the shape of defect it exists to catch.
 */
if (unresolved.length > 0) {
  console.log(`  ${unresolved.length} select(s) not checked (the argument is not a literal):`);
  for (const u of unresolved) console.log(`    ${u.file}:${u.line}`);
}
