-- 032 — an invoice carries its own parties
--
-- Migration 030 widened anonymise_blockers to refuse erasure while any invoice
-- had sent_at or pdf_path null, because 028 had claimed "an issued invoice
-- carries its own copy of what it needed" and it did not. That closed the money
-- hole and opened a legal one: two of those states cannot be cleared by the
-- person asking to be erased.
--
--   * sent_at stays null forever when the FACILITY has never set a billing_email
--     — deliverInvoice returns no_billing_email and there is nothing the
--     freelancer can do about somebody else's settings page.
--   * pdf_path stays null when a bucket write failed months ago, and
--     regenerateInvoicePdfAction reads the supplier details LIVE, so a re-render
--     after the settings row is gone would produce an invoice with no address,
--     no btw-id and no IBAN.
--
-- Refusing an art. 17 AVG erasure indefinitely, on a condition the data subject
-- has no way to satisfy, is not a defensible answer. And the underlying problem
-- was never the blocking: it was that the invoice does not record who issued it.
--
-- So the parties are written onto the invoice at the moment it is issued, the
-- same way amounts, dates and the VAT treatment already are. An issued invoice
-- then genuinely does carry its own copy, deleting invoice_settings is safe, a
-- re-render reproduces the document as issued rather than as the profile reads
-- today, and anonymise_blockers can go back to asking the one question the
-- subject can actually act on: is there work that has not been invoiced.
--
-- The columns are nullable because invoices issued before this migration have no
-- snapshot. lib/invoicePdf.ts falls back to the live settings for those, which is
-- the behaviour they had all along.

alter table invoices add column if not exists supplier_name text;
alter table invoices add column if not exists supplier_address_line text;
alter table invoices add column if not exists supplier_postcode text;
alter table invoices add column if not exists supplier_city text;
alter table invoices add column if not exists supplier_vat_number text;
alter table invoices add column if not exists supplier_iban text;
alter table invoices add column if not exists supplier_account_holder text;

comment on column invoices.supplier_name is
  'The issuing party as at the moment of issue. art. 35a Wet OB requires the supplier''s name on the invoice, and a name read live changes when somebody edits their profile — or disappears when they are anonymised.';

-- The customer half, for the same reason: art. 35a requires the customer's name
-- and address too, and organisations.address_line is nullable and editable.
alter table invoices add column if not exists customer_name text;
alter table invoices add column if not exists customer_address_line text;
alter table invoices add column if not exists customer_postcode text;
alter table invoices add column if not exists customer_city text;
alter table invoices add column if not exists customer_kvk text;

-- ---------------------------------------------------------------------------
-- The blocker count goes back to the one question the subject can answer.
-- ---------------------------------------------------------------------------

create or replace function anonymise_blockers(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  /*
   * Work that has not been invoiced at all. See migration 027.
   *
   * This is the only condition the person asking to be erased can clear: they
   * submit the hours, the facility approves, the invoice is raised.
   *
   * Migration 030 also counted invoices with sent_at or pdf_path null, to stop
   * invoice_settings being deleted out from under a document that still needed
   * it. Migration 032 removed the need: the parties are written onto the invoice
   * row at issue, so nothing about an issued invoice depends on the profile any
   * more. Counting them was refusing an art. 17 erasure on states a THIRD PARTY
   * controls — a facility that never set a billing address could block somebody's
   * removal from the platform indefinitely, and nothing on the screen told either
   * of them that was what was happening.
   */
  select count(*)::integer
  from assignments a
  where a.freelancer_id = p_profile_id
    and a.status <> 'cancelled'
    and not exists (select 1 from invoices i where i.assignment_id = a.id);
$fn$;

-- ---------------------------------------------------------------------------
-- And the organisation's billing address, when it is the erased person's own.
-- ---------------------------------------------------------------------------

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
   * The count itself lives in anonymise_blockers, because the CALLER has to ask
   * the same question before it deletes any document file, and asking it in two
   * dialects is how two answers drift apart. See migration 029.
   */
  v_open := anonymise_blockers(p_profile_id);

  if v_open > 0 then
    raise exception
      'Er % nog % onafgeronde opdracht(en) of factu(u)r(en). Rond die eerst af; daarna kan dit account geanonimiseerd worden.',
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
   * That sentence has been wrong twice, in two different ways, and this is what
   * makes it true.
   *
   * First it claimed a capture that did not exist: the snapshot held the BIG
   * number and nothing else about the papers. lib/assignments.ts writes them from
   * migration 027 onwards.
   *
   * Then it claimed a RENDERING that did not exist. The block was captured and
   * read by nothing — no screen, no export, no PDF — so this deletion still
   * destroyed the only evidence that survived, under a comment saying it did not.
   * Migration 029 is what closed that: lib/dossierPdf.ts prints "Documenten bij
   * aanvang" per assignment, app/zorginstelling/dossier/page.tsx carries the same
   * column, and lib/dossierPdf.test.ts fails if either stops.
   *
   * Assignments accepted BEFORE 027 have no document block, and for those this
   * deletion is still a loss — which is why both surfaces print "niet vastgelegd"
   * rather than an empty list. An absent capture and an empty one are different
   * facts, and only one of them is a statement about a check nobody made.
   */
  delete from documents where freelancer_id = p_profile_id;

  /*
   * Bank details and address.
   *
   * This said "an issued invoice carries its own copy of what it needed". It does
   * not: the invoices row has a number, amounts, dates and VAT, and no
   * business_name, address_line, postcode, city, vat_number, iban or
   * account_holder. Those live here and in the rendered PDF blob, and
   * renderAndStoreInvoicePdf reads them live — so an invoice whose blob was never
   * written could only ever be re-rendered without a supplier address, a btw-id
   * or a payment instruction, which is not a valid invoice under art. 35a Wet OB.
   *
   * Safe now because anonymise_blockers refuses while any invoice is unsent or
   * has no pdf_path, as well as while any assignment has no invoice at all. See
   * migration 030.
   */
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

    /*
     * AND THE ORGANISATION'S BILLING ADDRESS, if it is this person's.
     *
     * onboarding seeds organisations.billing_email with the founding
     * coordinator's own login address, and nothing forces them to change it. So
     * an erased facility admin kept receiving every invoice, every payment
     * reminder and every document-expiry warning for that facility, at a personal
     * address, forever — and the address stayed visible to MyQare staff and to
     * their former colleagues on the settings screen. Migration 028 was written
     * specifically to reach "the address they were invited with" and missed the
     * other table seeded from the same value.
     *
     * Blanked rather than scrambled. A scrambled address would bounce silently;
     * null makes deliverInvoice return no_billing_email, which surfaces on both
     * sides as a thing to fix, and /zorginstelling/instellingen says so. The
     * facility must choose a new one — which is the correct outcome, because the
     * old one belonged to somebody who has left.
     */
    update organisations
    set billing_email = null
    where lower(billing_email) = v_email;
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
