-- ============================================================================
-- 027  Anonymising must not strand work that still has to be invoiced
-- ============================================================================
--
-- anonymise_account deletes invoice_settings, under the comment "issued invoices
-- carry their own snapshot of what was needed at the time". True of issued
-- invoices, and the function does not check that any exist.
--
-- What it leaves behind: an assignment that is accepted, or worked, or approved,
-- and not yet invoiced. createInvoiceForAssignment loads invoice_settings and
-- refuses with `invoice_details_missing` when the address or the btw-id is blank
-- — which is correct, art. 35a Wet OB requires them — and after this function has
-- run they are blank forever. Nothing can fill them in again: the person is gone.
--
-- The result is the worst arrangement of the money in the product. The platform
-- fee is settled at ACCEPTANCE, so it has already been taken from the
-- freelancer's balance. The facility is never billed, so it never pays. The
-- freelancer is never paid for a shift they worked. And every screen involved
-- reports success, because approving hours succeeded and only the invoice — a
-- separate step, deliberately — quietly refused.
--
-- So the function refuses instead, and says what is outstanding. An erasure
-- request may lawfully wait on a legal obligation still being discharged (art.
-- 17(3)(b) AVG), and issuing an invoice for work already done is one. Staff
-- finish the money first; the request is then honoured in full.
--
-- Also corrected here: the comment claiming the dossier snapshot records the
-- document check. It did not. It recorded the BIG number and said nothing about
-- a VOG, a diploma or an insurance certificate, so deleting the documents rows
-- destroyed the only evidence those had ever been seen — for every facility that
-- had engaged that person, and under a sentence saying the opposite. The
-- snapshot now carries the kinds, review dates and expiry dates from acceptance
-- (see lib/assignments.ts); the files themselves still go, because the file is
-- the personal data and the fact of the check is the facility's own record.

create or replace function anonymise_account(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_role text;
  v_open integer;
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
   * it — see the header of this migration.
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
   * this migration onwards. Assignments accepted BEFORE it have no document block
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
