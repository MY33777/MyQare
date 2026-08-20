import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { summariseRatings } from "@/lib/ratings";

/*
 * One rule, two implementations, checked against each other by running both.
 *
 * The shrinkage lives in lib/ratings.ts and — since migration 019, which stopped
 * handing a freelancer the individual score a named coordinator gave them — also
 * in the rating_summary() SQL function, because the raw rows can no longer leave
 * the database.
 *
 * Two implementations of one rule is the shape that silently halved the payment
 * term, printed a decimal point in a Dutch price on six pages at once, and made
 * the dossier screen contradict the document beside it. The first draft of
 * rating_summary already had the prior weight at 10 against TypeScript's 5, and
 * no window at all against a window of 20 — written and reviewed in the same
 * hour, still wrong.
 *
 * So it is not asserted, it is executed. PGlite is PostgreSQL in-process, which
 * makes running the real function as cheap as calling the TypeScript one.
 */

const SUPA = join(process.cwd(), "supabase");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let freelancerId: string;

beforeAll(async () => {
  db = await new PGlite();

  /*
   * The smallest world rating_summary needs: the three tables it joins, and
   * nothing else. Built by hand rather than by running schema.sql, so this test
   * fails when the FUNCTION changes and not when an unrelated table does.
   */
  await db.exec(`
    create table profiles (id uuid primary key default gen_random_uuid());
    create table assignments (
      id uuid primary key default gen_random_uuid(),
      freelancer_id uuid not null
    );
    create table ratings (
      id uuid primary key default gen_random_uuid(),
      assignment_id uuid not null references assignments(id),
      direction text not null,
      score integer not null,
      created_at timestamptz not null default now()
    );
  `);

  // The function itself, lifted verbatim from the schema so this cannot pass
  // against a copy that has drifted from what ships.
  const schema = readFileSync(join(SUPA, "schema.sql"), "utf8");
  const start = schema.indexOf("create or replace function rating_summary(");
  const end = schema.indexOf("\n$$;", start);
  expect(start, "rating_summary is missing from schema.sql").toBeGreaterThan(-1);

  const body = schema
    .slice(start, end + "\n$$;".length)
    // security definer needs an owner PGlite does not model; the behaviour under
    // test is the arithmetic, not the privilege.
    .replace("security definer", "")
    .replace("set search_path = public", "");

  await db.exec(body);

  const inserted = await db.query(
    `insert into profiles default values returning id`,
  );
  freelancerId = inserted.rows[0].id;
});

afterAll(async () => {
  await db?.close();
});

/** Inserts scores oldest-first and returns what the SQL function reports. */
async function summariseInSql(scores: number[]) {
  await db.exec(`delete from ratings; delete from assignments;`);

  for (const [index, score] of scores.entries()) {
    const assignment = await db.query(
      `insert into assignments (freelancer_id) values ($1) returning id`,
      [freelancerId],
    );
    await db.query(
      `insert into ratings (assignment_id, direction, score, created_at)
       values ($1, 'facility_to_freelancer', $2, now() + ($3 || ' seconds')::interval)`,
      [assignment.rows[0].id, score, index],
    );
  }

  const result = await db.query(`select * from rating_summary($1)`, [freelancerId]);
  const row = result.rows[0];
  return {
    count: row.rating_count as number,
    score: row.shrunk_score === null ? null : Number(row.shrunk_score),
  };
}

const CASES: { label: string; scores: number[] }[] = [
  { label: "nobody has rated them", scores: [] },
  { label: "one rating", scores: [10] },
  { label: "four ratings, still provisional", scores: [8, 9, 7, 10] },
  { label: "exactly five, the threshold", scores: [8, 8, 8, 8, 8] },
  { label: "a run of tens", scores: Array(8).fill(10) },
  { label: "a single zero among good work", scores: [9, 9, 9, 9, 9, 0] },
  { label: "all zeroes", scores: Array(6).fill(0) },
  { label: "more than the window", scores: Array(30).fill(0).map((_, i) => (i < 10 ? 3 : 9)) },
];

describe("rating_summary() agrees with summariseRatings()", () => {
  for (const testCase of CASES) {
    it(testCase.label, async () => {
      const sql = await summariseInSql(testCase.scores);

      // summariseRatings takes them NEWEST first; the SQL orders by created_at
      // desc, so the TypeScript side gets the same list reversed.
      const ts = summariseRatings([...testCase.scores].reverse());

      expect(sql.count).toBe(ts.count);

      if (ts.provisional) {
        // Below the threshold the database returns null rather than a figure the
        // freelancer could invert to recover one coordinator's mark.
        expect(sql.score).toBeNull();
      } else {
        expect(sql.score).toBeCloseTo(ts.score, 5);
      }
    });
  }

  it("only counts the direction asked for", async () => {
    await summariseInSql([9, 9, 9, 9, 9]);
    const other = await db.query(
      `select * from rating_summary($1, 'freelancer_to_facility')`,
      [freelancerId],
    );
    expect(other.rows[0].rating_count).toBe(0);
  });

  it("returns no identifying detail at all", async () => {
    await summariseInSql([9, 9, 9, 9, 9]);
    const result = await db.query(`select * from rating_summary($1)`, [freelancerId]);
    // The whole point: two numbers, no author, no assignment, no individual score.
    expect(Object.keys(result.rows[0]).sort()).toEqual(["rating_count", "shrunk_score"]);
  });
});
