import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEDGER_PAGE_SIZE, clampTopupCents, creditBalanceCents } from "@/lib/credits";

/*
 * The balance is the sum of an append-only ledger, so the only way it can be
 * wrong is by not reading all of it. That is exactly what happened: the select
 * had no bound, and PostgREST returns whatever `max-rows` the project is
 * configured with — a setting a project owner is encouraged to set, several
 * screens away from anything to do with money.
 *
 * These fake the client rather than the database because what is under test is
 * the paging arithmetic, not the query.
 */

type Row = { delta_cents: number };

/** A client that serves `rows` in pages, and records what was asked for. */
function fakeClient(rows: Row[], options: { failOnPage?: number } = {}) {
  const ranges: [number, number][] = [];

  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return {
                    range(from: number, to: number) {
                      ranges.push([from, to]);
                      const page = ranges.length - 1;

                      if (options.failOnPage === page) {
                        return Promise.resolve({ data: null, error: { message: "boom" } });
                      }
                      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, ranges };
}

const ledger = (count: number, each = 100): Row[] =>
  Array.from({ length: count }, () => ({ delta_cents: each }));

describe("creditBalanceCents", () => {
  it("sums a ledger that fits in one page, in one round trip", async () => {
    const { client, ranges } = fakeClient([
      { delta_cents: 5000 },
      { delta_cents: -1815 },
      { delta_cents: 1815 },
    ]);

    expect(await creditBalanceCents("p1", client)).toBe(5000);
    expect(ranges).toEqual([[0, LEDGER_PAGE_SIZE - 1]]);
  });

  it("returns zero for an empty ledger without asking twice", async () => {
    const { client, ranges } = fakeClient([]);
    expect(await creditBalanceCents("p1", client)).toBe(0);
    expect(ranges).toHaveLength(1);
  });

  it("keeps paging past the page size — this is the whole bug", async () => {
    // One row over two full pages: the old code returned the first page's sum and
    // called it the balance.
    const rows = ledger(LEDGER_PAGE_SIZE * 2 + 1, 100);
    const { client, ranges } = fakeClient(rows);

    expect(await creditBalanceCents("p1", client)).toBe(rows.length * 100);
    expect(ranges).toHaveLength(3);
  });

  it("stops after a page that comes back exactly full but is the last one", async () => {
    const rows = ledger(LEDGER_PAGE_SIZE, 100);
    const { client, ranges } = fakeClient(rows);

    expect(await creditBalanceCents("p1", client)).toBe(LEDGER_PAGE_SIZE * 100);
    // A full page means "there may be more", so a second request is correct here —
    // it comes back empty and ends the loop. Better one wasted round trip than a
    // balance that is short by everything after row 1000.
    expect(ranges).toHaveLength(2);
  });

  it("discards a partial sum when a later page fails", async () => {
    const rows = ledger(LEDGER_PAGE_SIZE * 2, 100);
    const { client } = fakeClient(rows, { failOnPage: 1 });

    /*
     * Zero, not the first page's total. Zero refuses — it blocks accepting a
     * shift and offers a top-up — while a partial sum looks like a real balance
     * and is quietly short by half the ledger.
     */
    expect(await creditBalanceCents("p1", client)).toBe(0);
  });

  it("asks for non-overlapping ranges", async () => {
    const { client, ranges } = fakeClient(ledger(LEDGER_PAGE_SIZE * 2 + 5));
    await creditBalanceCents("p1", client);

    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
    }
  });
});

describe("clampTopupCents", () => {
  it.each([
    ["below the minimum", 1, 500],
    ["the minimum itself", 500, 500],
    ["a normal amount", 2500, 2500],
    ["above the maximum", 900_000, 500_000],
    ["a fractional cent", 1234.6, 1235],
    ["not a number at all", Number.NaN, 500],
  ])("%s", (_label, input, expected) => {
    expect(clampTopupCents(input as number)).toBe(expected);
  });
});
