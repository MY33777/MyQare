-- 031 — a rating belongs to the facility, not to the coordinator who typed it
--
-- /zorginstelling/uren asks "which of these completed assignments has this
-- facility already rated?" by selecting from `ratings` with the caller's own
-- client. Migration 019 narrowed ratings_select to `author_id = auth.uid() or
-- is_staff()`, which was right — a rating is anonymous and nobody should read
-- somebody else's — and it means this query answers a different question than the
-- one being asked: "which have *I* rated?"
--
-- With one coordinator those are the same question. With two they are not. The
-- night coordinator rates twelve assignments; the day coordinator opens the same
-- page and is shown all twelve again, rates them a second time, and the freelancer
-- gets two ratings for one shift from one facility — or the insert collides and
-- she is shown a queue that will not clear.
--
-- The answer is not to widen the policy. Whether a rating EXISTS is a fact about
-- the facility's own assignment; what it SAYS is not. So this returns ids and
-- nothing else.

create or replace function facility_rated_assignments(p_assignment_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select r.assignment_id
  from ratings r
  join assignments a on a.id = r.assignment_id
  where r.assignment_id = any(p_assignment_ids)
    and r.direction = 'facility_to_freelancer'
    -- The caller's own organisation, and only that. current_org_id() reads the
    -- signed-in profile, so a crafted array of somebody else's assignment ids
    -- returns nothing rather than confirming they exist.
    and a.org_id = current_org_id();
$fn$;

comment on function facility_rated_assignments(uuid[]) is
  'Which of these assignments this facility has already rated. Ids only — the score and the note stay behind ratings_select. See migration 031.';

revoke all on function facility_rated_assignments(uuid[]) from public, anon;
grant execute on function facility_rated_assignments(uuid[]) to authenticated;
