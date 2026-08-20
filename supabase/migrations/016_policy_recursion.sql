-- 016 — three RLS policies that recurse into themselves
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- The problem schema.sql's own header describes, three times over
-- ============================================================================
-- The header of schema.sql explains why current_org_id(), current_role_name()
-- and is_staff() are security definer: a policy on profiles that reads profiles
-- makes Postgres raise
--
--     42P17  infinite recursion detected in policy for relation "profiles"
--
-- and wrapping the lookup in a definer function breaks the cycle because the
-- function body runs with RLS bypassed.
--
-- Three policies do exactly what that paragraph warns against.
--
--   1. shifts_select reads shift_offers, and shift_offers_select reads shifts.
--      Mutual rather than self, and Postgres treats it the same way: evaluating
--      one expands the other, which expands the first. This is PRE-EXISTING and
--      it is not a corner case — it is every authenticated read of shifts and of
--      shift_offers, which is most of what a freelancer and a coordinator do.
--
--   2. staff_permissions_select reads staff_permissions. Added yesterday, in
--      migration 014, in a file whose header explains this. Every read of the
--      table raises 42P17, so capabilitiesFor() returns [] on error and — by its
--      own fail-closed design — nobody can do anything in /beheer at all.
--
--   3. admin_audit_log_select reads staff_permissions, so it inherits (2).
--
-- None of this has ever run, which is the only reason it is not an outage.

-- ============================================================================
-- The helpers
-- ============================================================================
-- Kept tiny and single-purpose, like the existing three, so they cannot be used
-- as a general read primitive. Each answers one question and returns one value.

/*
 * Does the current user hold an offer for this shift?
 *
 * Replaces the subquery inside shifts_select. Runs as owner, so reading
 * shift_offers here does not re-enter shift_offers_select.
 */
create or replace function has_offer_for_shift(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from shift_offers
    where shift_id = p_shift_id and freelancer_id = auth.uid()
  );
$$;

/*
 * Which organisation owns this shift?
 *
 * Replaces the subquery inside shift_offers_select. Returns an organisation id
 * for a shift id and nothing else — the caller already has to know the shift id,
 * and shift ids are uuids.
 */
create or replace function shift_org(p_shift_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from shifts where id = p_shift_id;
$$;

/*
 * Can the current user appoint admins?
 *
 * Parameterless, like is_staff(), and for the same reason: it answers a question
 * about the caller and cannot be pointed at anybody else.
 */
create or replace function can_manage_admins()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_permissions
    where profile_id = auth.uid() and capability = 'manage_admins'
  );
$$;

-- ============================================================================
-- The policies, rewritten
-- ============================================================================

drop policy if exists shifts_select on shifts;
create policy shifts_select on shifts for select
  using (
    org_id = current_org_id()
    or is_staff()
    -- Was: exists (select 1 from shift_offers o where ...). See the header.
    or has_offer_for_shift(shifts.id)
  );

drop policy if exists shift_offers_select on shift_offers;
create policy shift_offers_select on shift_offers for select
  using (
    freelancer_id = auth.uid()
    or is_staff()
    -- Was: exists (select 1 from shifts s where ...). See the header.
    or shift_org(shift_offers.shift_id) = current_org_id()
  );

drop policy if exists staff_permissions_select on staff_permissions;
create policy staff_permissions_select on staff_permissions for select
  using (profile_id = auth.uid() or can_manage_admins());

drop policy if exists admin_audit_log_select on admin_audit_log;
create policy admin_audit_log_select on admin_audit_log for select
  using (can_manage_admins());

-- These are definer functions and every caller is a policy, so `authenticated`
-- has to keep execute. They are safe to call: each takes at most an id the caller
-- already holds and returns a single value about the caller's own relationship
-- to it. Unlike the RPCs in functions.sql, none of them writes or takes an amount.
