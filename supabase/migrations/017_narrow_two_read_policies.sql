-- 017 — two read policies that grant more, and for longer, than anything needs
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.

-- ============================================================================
-- HIGH: an offer nobody accepted granted a permanent read of the full profile
-- ============================================================================
-- freelancers_select ended with:
--
--     or exists (
--       select 1 from shifts s
--       join shift_offers o on o.shift_id = s.id
--       where o.freelancer_id = freelancers.profile_id and s.org_id = current_org_id()
--     )
--
-- commented "a facility that has offered a shift to the region needs to see who
-- responded". So posting one region-wide shift to two hundred people granted
-- that facility a standing read of two hundred full freelancer rows — kvk,
-- big_number, hourly_rate_min_cents, region, specialisations, bio, vat_exempt —
-- including everyone who declined and everyone who never answered. It never
-- expired.
--
-- And nothing used it. The facility's three reads of `freelancers` are the pool
-- list, a pool member's detail page, and a service-role lookup when adding
-- somebody by email — all covered by the pools clause above. The shift detail
-- page renders responders from `profiles(full_name)` and never touches this
-- table.
--
-- So the clause was pure exposure: access granted, nothing reading it, no way for
-- the person exposed to know or undo it. Removed rather than narrowed — the
-- legitimate cases are already covered by the pool and assignment clauses.

drop policy if exists freelancers_select on freelancers;
create policy freelancers_select on freelancers for select
  using (
    profile_id = auth.uid()
    or is_staff()
    or exists (
      select 1 from pools p
      where p.freelancer_id = freelancers.profile_id and p.org_id = current_org_id()
    )
    or exists (
      select 1 from assignments a
      where a.freelancer_id = freelancers.profile_id and a.org_id = current_org_id()
    )
  );

-- ============================================================================
-- MEDIUM: a cancelled assignment kept the facility's access to VOG and diploma
-- ============================================================================
-- documents_select granted approved documents to any facility with an assignment
-- for that freelancer, with no filter on status. A cancelled assignment is work
-- that never happened, so no Wkkgz duty to check anything arises from it — and
-- the row stays forever, so cancelling one shift bought permanent read access to
-- somebody's certificate of conduct.
--
-- Pool membership still qualifies, and deliberately so: the Wkkgz check has to be
-- possible BEFORE engaging somebody, and a facility can remove them from its pool
-- when the relationship ends. An assignment cannot be undone; that is why it
-- needs the status filter and pool membership does not.

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
        -- Pool membership counts too. Wkkgz obliges a facility to check
        -- qualifications BEFORE engaging someone, and requiring an assignment
        -- first made that check possible only once it was already too late.
        -- Reading the row is not reading the file: the bucket is private, so
        -- file_path is inert without a signed URL, and server code only mints
        -- those where a real working relationship exists.
        or exists (
          select 1 from pools p
          where p.freelancer_id = documents.freelancer_id
            and p.org_id = current_org_id()
            and p.status <> 'hidden'
        )
      )
    )
  );
