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
  const maxPages = options.maxPages ?? 100;

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error || !data) return false;

    onPage(data);

    // A short page is the last one. A page that comes back exactly full might be
    // the last one too; asking once more costs a round trip and is the only way
    // to be sure without a count.
    if (data.length < pageSize) return true;
  }

  console.error(
    `[pagination] ${options.label ?? "query"} hit the ${maxPages}-page ceiling ` +
      `(${maxPages * pageSize} rows). Results are truncated.`,
  );
  return false;
}
