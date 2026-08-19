-- 012 — the rating privacy fix, this time in a form Postgres actually enforces
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.

-- ============================================================================
-- HIGH: migration 010's column revoke was a no-op
-- ============================================================================
-- 010 tried to hide the comment and the author of a rating from the person it is
-- about:
--
--     revoke select (comment, author_id) on ratings from authenticated, anon;
--
-- Postgres does not narrow a table-level privilege that way. GRANT SELECT ON
-- ratings — which Supabase issues to anon and authenticated for every table in
-- the public schema as part of its standard setup — confers select on ALL
-- columns, including ones added later. A column-level REVOKE removes only a
-- column-level GRANT. The table-level one is still there and still wins, so the
-- statement ran without error and changed nothing.
--
-- A REVOKE that succeeds and does nothing is the worst possible shape for this:
-- it produced a clean migration, a confident comment, and a promise on the
-- rating form that was still false.
--
-- The correct sequence is to drop the table-wide privilege and grant back only
-- the columns that may be read.

revoke select on ratings from authenticated, anon;

-- Everything except `comment` and `author_id`. Scores stay readable because both
-- dashboards average them, and an average over a run of assignments identifies
-- no one; direction and created_at are needed to group and order them.
grant select (id, assignment_id, direction, score, dimensions, created_at)
  on ratings to authenticated, anon;

-- ============================================================================
-- Consequence worth stating plainly
-- ============================================================================
-- `select=*` on ratings now FAILS for a signed-in user rather than returning a
-- partial row. Nothing in the app does that — every query names its columns — and
-- a loud failure is the right outcome for a request that was asking for more than
-- it was entitled to.
--
-- ratings_select still governs WHICH ROWS come back. This governs which columns.
-- Both are needed: the first without the second is what 010 shipped.
