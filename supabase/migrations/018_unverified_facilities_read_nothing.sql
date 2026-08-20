-- 018 — an unverified facility is not a facility yet
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH: anyone with an email address could read any freelancer's VOG
-- ============================================================================
-- Verification exists so a human checks a KvK extract before an organisation can
-- post work. It gates posting a shift, and nothing else.
--
-- Adding somebody to your pool is not gated. requireFacilityAdmin returns the
-- organisation without looking at verified_at, and addToPoolAction only needs a
-- session. So the whole sequence is:
--
--   1. register as a zorginstelling, with any name and any KvK number
--   2. confirm the email
--   3. type a freelancer's address into "Beheerder toevoegen"
--   4. read their full profile — kvk, BIG number, minimum rate, bio, region —
--      and every approved document they hold: VOG, diploma, insurance
--
-- Both freelancers_select and documents_select grant on pool membership, and the
-- pool row is the thing an unverified account can create at will. No approval
-- from the freelancer is required or requested; they are not told.
--
-- The pool clause is right — the Wkkgz check has to be possible before engaging
-- somebody. What is wrong is that an organisation nobody has verified counts as
-- an organisation. Verification is checked in the server action too, but the
-- policy is what makes it true regardless of which action forgets.

/*
 * Is the caller's organisation verified?
 *
 * Definer, parameterless and about the caller only, like is_staff(). Declared
 * here, after organisations exists — a `language sql` body is validated at
 * creation time, which is how a fresh install broke twice.
 */
create or replace function current_org_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.verified_at is not null
     from organisations o
     where o.id = (select p.org_id from profiles p where p.id = auth.uid())),
    false
  );
$$;

drop policy if exists freelancers_select on freelancers;
create policy freelancers_select on freelancers for select
  using (
    profile_id = auth.uid()
    or is_staff()
    or (
      current_org_verified()
      and exists (
        select 1 from pools p
        where p.freelancer_id = freelancers.profile_id and p.org_id = current_org_id()
      )
    )
    -- An assignment can only exist if the organisation was verified when the
    -- shift was posted, so this needs no extra gate — and withdrawing a
    -- verification afterwards must not erase the record of who worked there.
    or exists (
      select 1 from assignments a
      where a.freelancer_id = freelancers.profile_id and a.org_id = current_org_id()
    )
  );

drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using (
    freelancer_id = auth.uid()
    or is_staff()
    or (
      status = 'approved'
      and (
        exists (
          select 1 from assignments a
          where a.freelancer_id = documents.freelancer_id
            and a.org_id = current_org_id()
            -- Cancelled work creates no duty to have checked anything.
            and a.status <> 'cancelled'
        )
        or (
          current_org_verified()
          and exists (
            select 1 from pools p
            where p.freelancer_id = documents.freelancer_id
              and p.org_id = current_org_id()
              and p.status <> 'hidden'
          )
        )
      )
    )
  );
