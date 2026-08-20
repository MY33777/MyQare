-- 014 — what an admin may actually do
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- The problem
-- ============================================================================
-- profiles.role = 'staff' is binary: you are an admin or you are not, and every
-- admin can verify organisations, approve BIG numbers, read every uploaded VOG
-- and diploma on the platform, and — once there is a screen for it — appoint
-- more admins.
--
-- That is fine for one person and wrong for two. Somebody hired to check
-- documents should not be able to mark facilities verified, and nobody should be
-- able to hand out admin rights as a side effect of being given a narrow job.
--
-- role stays as it is. It is load-bearing in seventeen RLS read policies through
-- is_staff(), and splitting that would be a much larger change for no gain. What
-- goes on top is a capability per row.

create table if not exists staff_permissions (
  profile_id uuid not null references profiles(id) on delete cascade,

  /*
   * Deliberately a small, closed set that maps one-to-one onto actions that
   * exist. A capability gating nothing is the "protection asserted in a comment"
   * pattern this codebase has been bitten by five times — it reads as a control
   * and enforces nothing.
   *
   *   verify_organisations  approve or withdraw a facility's ability to post work
   *   verify_big            record that a BIG number was checked against the register
   *   review_documents      read and approve/reject VOG, diplomas, insurance, KvK
   *   manage_admins         appoint admins and set what they may do
   */
  capability text not null check (capability in (
    'verify_organisations',
    'verify_big',
    'review_documents',
    'manage_admins'
  )),

  -- Who granted it. Kept even if that person is later removed, which is why it
  -- is `set null` rather than cascade: losing the grantee should not quietly
  -- rewrite the history of who handed out the rights.
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),

  primary key (profile_id, capability)
);

create index if not exists staff_permissions_profile_idx on staff_permissions(profile_id);

alter table staff_permissions enable row level security;

/*
 * An admin sees their own capabilities — the panel needs to know what to render —
 * and anyone holding manage_admins sees everybody's, because that is the screen
 * they work from.
 */
drop policy if exists staff_permissions_select on staff_permissions;
create policy staff_permissions_select on staff_permissions for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from staff_permissions mine
      where mine.profile_id = auth.uid() and mine.capability = 'manage_admins'
    )
  );

revoke insert, update, delete on staff_permissions from authenticated, anon;

-- ============================================================================
-- Every change to who can do what, recorded
-- ============================================================================
-- This product's whole argument is that a decision is worth more when you can
-- show what was true at the moment it was made. Admin rights are the one thing
-- that lets somebody change every other record, so a grant that leaves no trace
-- is the gap that makes the rest arguable.
--
-- Append-only in the same sense as credit_ledger: no update, no delete, and the
-- rows outlive the accounts they refer to.

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),

  -- `set null` on both: an entry saying "somebody, since deleted, granted
  -- manage_admins to somebody else, since deleted" is still worth having.
  actor_id uuid references profiles(id) on delete set null,
  subject_id uuid references profiles(id) on delete set null,

  -- Names captured at the time, so the log stays readable after an account is
  -- anonymised or removed. Same reason the compliance dossier snapshots.
  actor_name text,
  subject_name text,

  action text not null check (action in (
    'admin_appointed',
    'admin_removed',
    'capability_granted',
    'capability_revoked'
  )),
  capability text,
  note text,

  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log(created_at desc);

alter table admin_audit_log enable row level security;

-- Readable only by someone who can manage admins. It names people and what they
-- were trusted with.
drop policy if exists admin_audit_log_select on admin_audit_log;
create policy admin_audit_log_select on admin_audit_log for select
  using (
    exists (
      select 1 from staff_permissions mine
      where mine.profile_id = auth.uid() and mine.capability = 'manage_admins'
    )
  );

revoke insert, update, delete on admin_audit_log from authenticated, anon;

-- ============================================================================
-- BOOTSTRAP: the first admin cannot be created through the panel
-- ============================================================================
-- Somebody has to be able to appoint the first admin, and that somebody cannot
-- be an admin. There is no way around the circle, and a "make me an admin"
-- endpoint that is open until first use is a race waiting to be lost.
--
-- So the first one is made here, by hand, by whoever owns the database. Register
-- through the normal signup first so the auth account and profile exist, then
-- run this with your own email:
--
--   update profiles set role = 'staff'
--   where id = (select id from auth.users where lower(email) = lower('you@example.com'));
--
--   insert into staff_permissions (profile_id, capability)
--   select p.id, c.capability
--   from profiles p
--   cross join (values
--     ('verify_organisations'), ('verify_big'), ('review_documents'), ('manage_admins')
--   ) as c(capability)
--   where p.id = (select id from auth.users where lower(email) = lower('you@example.com'))
--   on conflict do nothing;
--
--   insert into admin_audit_log (subject_id, subject_name, action, note)
--   select id, full_name, 'admin_appointed', 'Eerste beheerder, aangemaakt via SQL'
--   from profiles
--   where id = (select id from auth.users where lower(email) = lower('you@example.com'));
--
-- After that, every further change goes through /beheer/beheerders and is logged.

-- ============================================================================
-- Existing staff keep everything they had
-- ============================================================================
-- Anyone already role='staff' could do all of it before this migration, so
-- granting them all four is not an escalation — it is what they already had. The
-- alternative is silently taking rights away from whoever is mid-task.
insert into staff_permissions (profile_id, capability)
select p.id, c.capability
from profiles p
cross join (values
  ('verify_organisations'), ('verify_big'), ('review_documents'), ('manage_admins')
) as c(capability)
where p.role = 'staff'
on conflict do nothing;
