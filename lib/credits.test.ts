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

/**
 * A client that serves `rows` in pages, and records what was asked for.
 *
 * `serverCap` is the important one. PostgREST refuses to return more than the
 * project's `max-rows` however wide a range you ask for, and that is precisely
 * what broke the first version of forEachPage: it read a page shorter than the
 * one it requested as "that was the last of the data".
 */
function fakeClient(
  rows: Row[],
  options: { failOnPage?: number; serverCap?: number } = {},
) {
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

                      const width = Math.min(to - from + 1, options.serverCap ?? Infinity);
                      return Promise.resolve({ data: rows.slice(from, from + width), error: null });
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
  it("sums a ledger that fits in one page", async () => {
    const { client } = fakeClient([
      { delta_cents: 5000 },
      { delta_cents: -1815 },
      { delta_cents: 1815 },
    ]);

    expect(await creditBalanceCents("p1", client)).toBe(5000);
  });

  it("returns zero for an empty ledger, and asks exactly once", async () => {
    const { client, ranges } = fakeClient([]);
    expect(await creditBalanceCents("p1", client)).toBe(0);
    // An empty first page IS the end signal, so there is nothing to confirm.
    expect(ranges).toHaveLength(1);
  });

  it("keeps paging past the page size", async () => {
    const rows = ledger(LEDGER_PAGE_SIZE * 2 + 1, 100);
    const { client } = fakeClient(rows);
    expect(await creditBalanceCents("p1", client)).toBe(rows.length * 100);
  });

  /*
   * The regression this file exists for.
   *
   * max-rows is a dashboard setting several screens away from anything that looks
   * like application logic, and turning it on is ordinary Supabase hardening. The
   * first version of forEachPage stopped at the first page shorter than the one it
   * asked for — so switching that setting on silently made every balance in the
   * product the sum of its first page. The module written to survive the setting
   * was defeated by the setting, and returned "complete" while doing it.
   */
  it.each([100, 250, 500, 999])(
    "sums the whole ledger even when the server caps every page at %i rows",
    async (serverCap) => {
      const rows = ledger(2500, 100);
      const { client } = fakeClient(rows, { serverCap });

      expect(await creditBalanceCents("p1", client)).toBe(250_000);
    },
  );

  it("refuses rather than under-reports if the cap is so small it exhausts the ceiling", async () => {
    /*
     * A cap of one row per request would need 2500 round trips for this ledger and
     * the runaway guard stops at 200. That is the right end of the trade: a
     * pathological setting produces a refusal, which blocks accepting a shift and
     * offers a top-up, rather than a balance that is 8% of the real one and looks
     * completely ordinary.
     */
    const { client } = fakeClient(ledger(2500), { serverCap: 1 });
    expect(await creditBalanceCents("p1", client)).toBe(0);
  });

  it("advances by what came back, so a capped page is not skipped over", async () => {
    const { client, ranges } = fakeClient(ledger(1200), { serverCap: 300 });
    await creditBalanceCents("p1", client);

    // Every request must start exactly where the previous one's ROWS ended — not
    // where its requested range ended, which is what a server cap makes different.
    let served = 0;
    for (const [from] of ranges) {
      expect(from).toBe(served);
      served = Math.min(served + 300, 1200);
    }
  });

  it("stops on the empty page after one that came back exactly full", async () => {
    const rows = ledger(LEDGER_PAGE_SIZE, 100);
    const { client, ranges } = fakeClient(rows);

    expect(await creditBalanceCents("p1", client)).toBe(LEDGER_PAGE_SIZE * 100);
    // A full page might be the last one; only an empty one proves it.
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

  it("gives up rather than looping forever if the server never returns nothing", async () => {
    // A server that always answers with rows would page until the ceiling. It must
    // stop, and it must not report the truncated sum as a balance.
    const { client } = fakeClient(ledger(10_000_000), { serverCap: 1 });
    expect(await creditBalanceCents("p1", client)).toBe(0);
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
