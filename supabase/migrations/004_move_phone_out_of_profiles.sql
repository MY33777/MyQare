-- 004 — a phone number should not travel with a name
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- MEDIUM: profiles_select handed the phone number to any facility with the
-- person in its pool
-- ============================================================================
-- The pool detail page deliberately shows a phone number only once someone has
-- actually worked at that facility — a facility adds people to its pool
-- unilaterally, by typing an email address, and that is not consent to hand over
-- a mobile number.
--
-- But that rule lived in JSX. profiles_select grants the WHOLE ROW to any facility
-- with a pool entry, and a row policy cannot pin columns. So the number was one
-- PostgREST call away:
--
--   GET /rest/v1/profiles?id=eq.<any pool member>&select=phone
--
-- Hiding a field in the template is not access control. It is worth being blunt
-- about that, because the comment in the page claimed the protection existed.
--
-- ============================================================================
-- THE FIX
-- ============================================================================
-- Phone moves to its own table with its own, stricter policy: the owner, staff, or
-- a facility that has an actual assignment with them. Pool membership is not
-- enough — which is what the UI always said, now enforced where it counts.
--
-- Column-level GRANTs were the alternative and do not work here: they apply to a
-- role globally, not per policy, so `authenticated` would lose or keep access for
-- everyone at once. Splitting the table is the only way to make the condition
-- differ per row.

create table if not exists profile_contact (
  profile_id uuid primary key references profiles(id) on delete cascade,
  phone text,
  updated_at timestamptz not null default now()
);

-- Carry across anything already stored, then stop using the old column.
insert into profile_contact (profile_id, phone)
select id, phone from profiles where phone is not null
on conflict (profile_id) do nothing;

alter table profile_contact enable row level security;

drop policy if exists profile_contact_select on profile_contact;
create policy profile_contact_select on profile_contact for select
  using (
    profile_id = auth.uid()
    or is_staff()
    -- An actual working relationship, not merely a pool entry. A coordinator
    -- needs to reach the person turning up on their ward tonight; a facility that
    -- typed an email address into a form does not.
    or exists (
      select 1 from assignments a
      where a.freelancer_id = profile_contact.profile_id
        and a.org_id = current_org_id()
        and a.status <> 'cancelled'
    )
    -- Colleagues within the same organisation.
    or exists (
      select 1 from profiles p
      where p.id = profile_contact.profile_id
        and p.org_id is not null
        and p.org_id = current_org_id()
    )
  );

drop policy if exists profile_contact_write on profile_contact;
create policy profile_contact_write on profile_contact for all
  using (profile_id = auth.uid() or is_staff())
  with check (profile_id = auth.uid() or is_staff());

-- The old column is left in place but must no longer be read or written. Dropping
-- it in the same migration would break any deployment still running the previous
-- build; drop it in a later one once nothing references it.
comment on column profiles.phone is
  'DEPRECATED — moved to profile_contact in migration 004. Do not read or write. '
  'profiles_select exposes the whole row to pool facilities, which is why a phone '
  'number cannot live here.';
