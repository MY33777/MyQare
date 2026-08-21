-- 025 — the retention claim was false, and account deletion becomes anonymisation
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- CRITICAL: seven years of fiscal records were one DELETE away
-- ============================================================================
-- Migration 006 protected the ASSIGNMENT chain: shifts -> assignments,
-- assignments -> invoices and assignments -> compliance_records are all
-- restrict, so a shift that has been worked cannot be deleted out from under its
-- invoice.
--
-- The PERSON chain was never protected. Every one of these was cascade:
--
--     auth.users -> profiles -> freelancers -> invoices
--                                           -> assignments
--                            -> credit_ledger
--
-- So `delete from auth.users where id = ...` — one statement, and the obvious
-- thing anybody would run to honour a deletion request — removed that
-- freelancer's invoices, their assignments and their entire credit ledger. A
-- Dutch invoice must be retained seven years (art. 52 AWR), and the compliance
-- records are the evidence a facility relies on under the Wkkgz and the Wet DBA.
-- Both would have gone silently: the restrict on assignments -> invoices does
-- not save them, because the cascade reaches invoices directly through
-- freelancer_id.
--
-- Three places in this codebase assert the opposite in a comment — the terms
-- page, app/onboarding/actions.ts and app/zorginstelling/instellingen/actions.ts
-- all say "invoices carry ON DELETE RESTRICT on purpose". They did not. Defect
-- class (c), which has now appeared in every single audit round.

alter table invoices drop constraint if exists invoices_freelancer_id_fkey;
alter table invoices add constraint invoices_freelancer_id_fkey
  foreign key (freelancer_id) references freelancers(profile_id) on delete restrict;

alter table invoices drop constraint if exists invoices_org_id_fkey;
alter table invoices add constraint invoices_org_id_fkey
  foreign key (org_id) references organisations(id) on delete restrict;

-- An assignment is what an invoice and a compliance record hang off, so it is
-- evidence in its own right.
alter table assignments drop constraint if exists assignments_freelancer_id_fkey;
alter table assignments add constraint assignments_freelancer_id_fkey
  foreign key (freelancer_id) references freelancers(profile_id) on delete restrict;

alter table assignments drop constraint if exists assignments_org_id_fkey;
alter table assignments add constraint assignments_org_id_fkey
  foreign key (org_id) references organisations(id) on delete restrict;

-- The ledger is append-only precisely so the money trail cannot be rewritten.
-- Deleting it along with the profile is rewriting it.
alter table credit_ledger drop constraint if exists credit_ledger_profile_id_fkey;
alter table credit_ledger add constraint credit_ledger_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete restrict;

-- ============================================================================
-- A rating outlives its author
-- ============================================================================
-- ratings.author_id was `not null ... on delete cascade`, so a freelancer
-- leaving silently deleted every rating they had ever written — changing the
-- score shown for facilities they worked with, months later, for a reason
-- nobody could see. The rating is about the OTHER party; the author is
-- metadata.
--
-- Nullable and set null: the rating survives, the link to a departed person does
-- not. rating_summary() is security definer and reads scores, so the published
-- figure is unaffected, and ratings_select is keyed on author_id = auth.uid(),
-- which a null simply never matches.
alter table ratings alter column author_id drop not null;

alter table ratings drop constraint if exists ratings_author_id_fkey;
alter table ratings add constraint ratings_author_id_fkey
  foreign key (author_id) references profiles(id) on delete set null;

-- ============================================================================
-- What deletion actually means here
-- ============================================================================
-- With the above in place, deleting an account that has ever been invoiced now
-- FAILS — loudly, which is the correct answer and what the terms page describes.
-- The AVG answer for that case is anonymise-and-retain: the fiscal and
-- evidentiary records stay, and everything identifying the person goes.
--
-- Written as one function rather than a runbook of eleven statements because it
-- has to be all-or-nothing. A half-anonymised account is worse than either end
-- state: the person believes they are gone, and their phone number is still in
-- profile_contact.

alter table profiles add column if not exists anonymised_at timestamptz;

comment on column profiles.anonymised_at is
  'Set by anonymise_account. The row is kept because invoices, assignments and '
  'the compliance dossier reference it and must be retained; everything that '
  'identifies the person has been removed.';

create or replace function anonymise_account(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
begin
  select role into v_role from profiles where id = p_profile_id;

  if v_role is null then
    raise exception 'Geen account gevonden.' using errcode = 'P0002';
  end if;

  /*
   * Staff are refused. A platform administrator is named in admin_audit_log
   * against every permission they ever granted, and anonymising them turns that
   * log into a record of decisions nobody made. Remove them as an admin first;
   * the account then anonymises like any other.
   */
  if v_role = 'staff' then
    raise exception 'Verwijder deze persoon eerst als beheerder.' using errcode = 'P0001';
  end if;

  -- Everything purely personal, with no evidentiary role.
  delete from profile_contact where profile_id = p_profile_id;
  delete from availability_blocks where freelancer_id = p_profile_id;
  delete from pools where freelancer_id = p_profile_id;

  /*
   * Documents go. Their storage objects are removed by the caller before this
   * runs — see lib/anonymise.ts. A VOG is the most sensitive thing this product
   * holds and there is no retention obligation on OUR copy: the facility's duty
   * is to have checked, which the dossier snapshot already records.
   */
  delete from documents where freelancer_id = p_profile_id;

  -- Bank details and address. Issued invoices carry their own snapshot of what
  -- was needed at the time.
  delete from invoice_settings where profile_id = p_profile_id;

  -- An offer that was never accepted says nothing about a working relationship.
  delete from shift_offers
  where freelancer_id = p_profile_id and response is distinct from 'accept';

  /*
   * The freelancers row is kept, because invoices and assignments reference it,
   * but emptied of everything that describes a person.
   */
  update freelancers
  set profession = '',
      specialisations = '{}',
      region = null,
      region_codes = '{}',
      bio = null,
      kvk = null,
      big_number = null,
      big_verified_at = null,
      big_checked_at = null,
      big_check_note = null,
      hourly_rate_min_cents = null
  where profile_id = p_profile_id;

  /*
   * The name is replaced rather than blanked, so a retained invoice still reads
   * as a document about somebody rather than about nothing. Not reversible, and
   * not a pseudonym anybody can resolve.
   */
  update profiles
  set full_name = 'Verwijderd account',
      anonymised_at = now()
  where id = p_profile_id;
end;
$fn$;

-- Service role only. Irreversible, and it crosses every tenant boundary.
revoke all on function anonymise_account(uuid) from public, anon, authenticated;

-- ============================================================================
-- Who may run it
-- ============================================================================
-- Its own capability. Anonymising is irreversible and it removes somebody's
-- certificate of conduct from storage; nothing about approving a diploma or
-- verifying a KvK number implies the authority to do that.
--
-- Nobody holds it after this migration, including the first admin. A capability
-- that grants itself on migration is not a capability — grant it from
-- /beheer/beheerders.

alter table staff_permissions drop constraint if exists staff_permissions_capability_check;
alter table staff_permissions add constraint staff_permissions_capability_check
  check (capability in (
    'verify_organisations',
    'verify_big',
    'review_documents',
    'cancel_assignments',
    'anonymise_accounts',
    'manage_admins'
  ));

-- The audit log gains the action. It is the second entry that records an admin
-- doing something irreversible to somebody else's account.
alter table admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table admin_audit_log add constraint admin_audit_log_action_check
  check (action in (
    'admin_appointed',
    'admin_removed',
    'capability_granted',
    'capability_revoked',
    'assignment_cancelled',
    'account_anonymised'
  ));
