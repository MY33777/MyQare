/*
 * Reading a whole table's worth of rows, in pages, without lying about it.
 *
 * PostgREST returns at most `max-rows` rows for a select with no range, and that
 * setting is a normal, recommended piece of Supabase hardening — configured in
 * the dashboard, several screens away from anything that looks like application
 * logic. An unbounded `.select()` therefore does not fail when the table grows
 * past it. It succeeds, returns a prefix, and every calculation downstream is
 * quietly computed over part of the data.
 *
 * Two places in this codebase did exactly that, on the two things that must not
 * be approximate: a freelancer's balance, and who hears about a shift.
 *
 * `.range()` needs a deterministic ORDER BY or the same row can appear on two
 * pages — which for a SUM means counting a top-up twice — so every caller passes
 * one.
 */

export const DEFAULT_PAGE_SIZE = 1000;

export type Page<T> = { data: T[] | null; error: { message?: string } | null };

/**
 * Walks every page and hands each one to `onPage`.
 *
 * Returns `false` if a page errored, having called `onPage` for the pages before
 * it — the caller decides whether a partial read is usable. For a balance it is
 * not; for a fan-out it means fewer people hear about a shift, which is
 * recoverable by re-offering.
 *
 * `maxPages` is a runaway guard, not a product limit. Hitting it means either
 * the data grew past what this design assumed or the caller forgot an ORDER BY
 * and is paging forever, and both are worth a loud line in the log rather than a
 * request that never returns.
 */
export async function forEachPage<T>(
  // PromiseLike, not Promise: a PostgREST builder is a thenable that only becomes
  // a real Promise once awaited, so typing this as Promise rejects every caller.
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  onPage: (rows: T[]) => void,
  options: { pageSize?: number; maxPages?: number; label?: string } = {},
): Promise<boolean> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? 200;

  /*
   * The offset advances by what came BACK, not by what was asked for, and only an
   * EMPTY page ends the loop.
   *
   * The first version of this function inferred "that was the last page" from a
   * page shorter than pageSize — and a page shorter than pageSize is exactly what
   * PostgREST's max-rows produces. With max-rows at 500 and pageSize at 1000, page
   * zero came back with 500 rows, was read as the end, and the function returned
   * true. The module written to survive that setting was defeated by that setting,
   * and it reported success while doing it.
   *
   * Advancing by data.length is what makes a server-side cap harmless: ask for
   * 0–999, get 500, ask for 500–1499, get 500 more. The pages tile the table
   * whatever the server decides to hand over. The cost is one extra round trip at
   * the end to see the empty page, which is the only signal that cannot be
   * confused with a cap.
   */
  let from = 0;

  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error || !data) return false;

    // The only reliable end of the data. Nothing else distinguishes "there is no
    // more" from "you are not allowed any more at once".
    if (data.length === 0) return true;

    onPage(data);
    from += data.length;
  }

  console.error(
    `[pagination] ${options.label ?? "query"} hit the ${maxPages}-page ceiling ` +
      `after ${from} rows. Results are truncated.`,
  );
  return false;
}
