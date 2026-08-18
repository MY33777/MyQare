/*
 * One-off: remove every client write policy from supabase/schema.sql.
 *
 * See supabase/migrations/005_remove_all_client_write_access.sql for why. In
 * short: a Postgres row policy cannot restrict columns, the application contains
 * no client-side writes at all, and every one of these policies was therefore dead
 * weight and an attack surface.
 *
 * Each policy in the file is a `drop policy if exists X;` followed by a
 * `create policy X ... ;` block. The drop lines stay — they make schema.sql
 * idempotent against a database that still has them — and the create blocks go.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PATH = "supabase/schema.sql";

const POLICIES = [
  "organisations_update",
  "profiles_insert",
  "profiles_update",
  "profile_contact_write",
  "freelancers_write",
  "documents_write",
  "pools_write",
  "shifts_insert",
  "shifts_update",
  "shifts_delete",
  "shift_offers_update",
  "shift_offers_insert",
  "timesheets_write",
  "ratings_insert",
  "availability_write",
];

let sql = readFileSync(PATH, "utf8");
const lines = sql.split("\n");
const out = [];
let removed = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const match = /^create policy (\w+) on /.exec(line);
  if (!match || !POLICIES.includes(match[1])) {
    out.push(line);
    continue;
  }

  // Consume through the statement terminator. Policy bodies contain nested
  // parentheses and semicolons inside string literals never occur here, so the
  // first line ending in ';' is a safe terminator.
  let j = i;
  while (j < lines.length && !lines[j].trimEnd().endsWith(";")) j++;
  i = j;
  removed++;
}

sql = out.join("\n");

// Collapse the blank-line runs the removals leave behind.
sql = sql.replace(/\n{4,}/g, "\n\n\n");

writeFileSync(PATH, sql);
console.log(`removed ${removed} create-policy blocks from ${PATH}`);
