-- 019 — the rating written about you is not yours to read, including its score
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH: hiding the comment was not enough
-- ============================================================================
-- Migration 012 revoked column access to `comment` and `author_id`, which closed
-- the obvious half. It left `score`, `direction` and `assignment_id` readable to
-- both parties, and there is exactly ONE rating per (assignment, direction) —
-- enforced by a unique constraint.
--
-- So a freelancer can ask for:
--
--     GET /rest/v1/ratings?assignment_id=eq.<their own shift>
--                          &direction=eq.facility_to_freelancer&select=score
--
-- and read the exact mark one named coordinator gave them for one specific
-- night. Hiding who wrote it is meaningless when the row is already keyed to a
-- single shift at a single facility. The rating form promises the other side
-- does not see it.
--
-- The fix is the shape the promise implies: you may read the ratings you WROTE,
-- and nothing else. What both dashboards actually need is an average, and an
-- average over a run of assignments identifies nobody — so that comes from a
-- definer function instead of from the rows.

drop policy if exists ratings_select on ratings;
create policy ratings_select on ratings for select
  using (author_id = auth.uid() or is_staff());

/*
 * The score shown on a profile, already shrunk toward the mean.
 *
 * Definer, so it can read rows the caller may not. It returns two numbers and no
 * identity: never a row, never an author, never which assignment produced which
 * mark. Below the threshold it returns the count and a null average rather than
 * a figure computed from two opinions.
 *
 * The shrinkage matches lib/ratings.ts — window 20, baseline 6.0, prior weight 5,
 * provisional below 5. Two implementations of one rule is what this codebase
 * keeps getting wrong, and the first draft of this function already had the
 * weight at 10 and no window. lib/ratings.test.ts now RUNS this function against
 * a real Postgres and compares it to summariseRatings, so they cannot drift.
 */
create or replace function rating_summary(
  p_freelancer_id uuid,
  p_direction text default 'facility_to_freelancer'
)
returns table (rating_count integer, shrunk_score numeric)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    -- Newest RATING_WINDOW only, matching lib/ratings.ts. An average over
    -- everything somebody ever did buries a change in how they work.
    select r.score
    from ratings r
    join assignments a on a.id = r.assignment_id
    where a.freelancer_id = p_freelancer_id
      and r.direction = p_direction
    order by r.created_at desc
    limit 20
  ),
  agg as (select count(*)::integer as n, coalesce(sum(score), 0)::numeric as total from recent)
  select
    n,
    case
      -- PROVISIONAL_BELOW. Fewer than five opinions is noise, and one irritated
      -- coordinator must not brand a newcomer. Null rather than a number nobody
      -- should act on — and, here, than a number the freelancer could invert.
      when n < 5 then null
      -- BASELINE_SCORE 6.0, PRIOR_WEIGHT 5. Mirrors summariseRatings exactly;
      -- lib/ratings.test.ts runs this function and compares the two.
      else round((total + (6.0 * 5)) / (n + 5), 1)
    end
  from agg;
$$;

-- Callable by any signed-in user: it answers a question about somebody's public
-- standing and returns no identifying detail. Not granted to anon — an unsigned
-- visitor has no business enumerating scores.
revoke all on function rating_summary(uuid, text) from public, anon;
grant execute on function rating_summary(uuid, text) to authenticated;

-- ============================================================================
-- Consequence
-- ============================================================================
-- Two screens read individual scores today: /professional (own average) and
-- /zorginstelling/pool/[id] (a pool member's average). Both now call
-- rating_summary. Two others read only `id` or `assignment_id` to ask "have I
-- rated this yet" — those still work, because the row they look for is one the
-- caller wrote.
--
-- A facility's own view also changes for the better. It used to average only the
-- ratings from ITS OWN assignments, because that is all RLS let it see, while
-- presenting the number as the freelancer's standing. It is now the same figure
-- everyone else sees.
