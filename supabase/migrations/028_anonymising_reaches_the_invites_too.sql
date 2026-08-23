-- ============================================================================
-- 028  Anonymising has to reach organisation_invites
-- ============================================================================
--
-- anonymise_account enumerates profile_contact, availability_blocks, pools,
-- documents, invoice_settings, shift_offers, freelancers and profiles. It never
-- touched organisation_invites, which holds two things about a person under a
-- plain, unhashed email address:
--
--   email             the address they were invited with
--   invited_by_name   their name, denormalised onto every colleague they invited
--
-- Neither is an invoice, an assignment or a compliance record — the three
-- exceptions the anonymisation screen and the privacy statement carve out. Both
-- pages said the name is replaced everywhere and the address decoupled, and any
-- remaining facility_admin at that organisation could still read both through
-- organisation_invites_select, which passes on `org_id = current_org_id()`.
--
-- So: an unaccepted invite is deleted outright — an invitation nobody took up is
-- a record of nothing — and an accepted one keeps its row, because "who let them
-- in, and when" is a real question about the organisation, with the address
-- replaced by the same unroutable form the auth account gets and the name
-- replaced by the same placeholder the profile gets.
--
-- The row is kept rather than deleted for the accepted case for the same reason
-- profiles is kept: removing it would erase the organisation's own record of a
-- decision it made, not just data about the person.

create or replace function anonymise_account(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
  v_open integer;
  v_email text;
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

  /*
   * Work that still has to be invoiced. Counted BEFORE anything is deleted,
   * because invoice_settings goes below and the invoice cannot be raised without
   * it — see migration 027.
   *
   * Cancelled assignments are excluded: nothing is owed on them and the fee was
   * refunded when they were cancelled. Everything else counts, whether or not the
   * hours have been approved yet, because an accepted shift is work somebody is
   * going to do and be billed for.
   */
  select count(*) into v_open
  from assignments a
  where a.freelancer_id = p_profile_id
    and a.status <> 'cancelled'
    and not exists (select 1 from invoices i where i.assignment_id = a.id);

  if v_open > 0 then
    raise exception
      'Er % nog % opdracht(en) zonder factuur. Rond die eerst af; daarna kan dit account geanonimiseerd worden.',
      case when v_open = 1 then 'is' else 'zijn' end,
      v_open
      -- Its own SQLSTATE, so the caller can tell this refusal from the staff one
      -- and show the count rather than a generic failure.
      using errcode = 'MQ001';
  end if;

  -- The address, before auth.users is scrambled by the caller. Needed to find
  -- the invites, which are keyed on the address and not on the id.
  select lower(email) into v_email from auth.users where id = p_profile_id;

  -- Everything purely personal, with no evidentiary role.
  delete from profile_contact where profile_id = p_profile_id;
  delete from availability_blocks where freelancer_id = p_profile_id;
  delete from pools where freelancer_id = p_profile_id;

  /*
   * Documents go, and the evidence stays.
   *
   * A VOG is the most sensitive thing this product holds and there is no
   * retention obligation on OUR copy. The facility's duty is to have checked, and
   * that check is recorded in the compliance snapshot taken at acceptance —
   * kinds, review dates and expiry dates, captured then, unaffected by this.
   *
   * That sentence used to be here and was not true: the snapshot held the BIG
   * number and nothing else about the papers. lib/assignments.ts writes them from
   * migration 027 onwards. Assignments accepted BEFORE it have no document block
   * in their snapshot, and for those this deletion is still a loss — which is why
   * the dossier prints "niet vastgelegd" rather than an empty list.
   */
  delete from documents where freelancer_id = p_profile_id;

  -- Bank details and address. Safe now: the count above proved every assignment
  -- has its invoice, and an issued invoice carries its own copy of what it needed.
  delete from invoice_settings where profile_id = p_profile_id;

  -- An offer that was never accepted says nothing about a working relationship.
  delete from shift_offers
  where freelancer_id = p_profile_id and response is distinct from 'accept';

  /*
   * Invitations. See the header of this migration.
   *
   * An invite nobody took up is deleted; an accepted one keeps its row with the
   * address and the name replaced, because it records a decision the ORGANISATION
   * made about who may see its pool and its freelancers' documents.
   */
  if v_email is not null then
    delete from organisation_invites
    where lower(email) = v_email and accepted_at is null;

    update organisation_invites
    set email = 'anon-' || p_profile_id || '@removed.myqare.invalid'
    where lower(email) = v_email;
  end if;

  -- And their name off every invite they sent to somebody else.
  update organisation_invites
  set invited_by_name = 'Verwijderd account'
  where invited_by = p_profile_id;

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
