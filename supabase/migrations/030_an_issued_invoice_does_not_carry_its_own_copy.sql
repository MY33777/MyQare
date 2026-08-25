-- 030 — an issued invoice does not carry its own copy
--
-- Migration 028 deleted invoice_settings under this line:
--
--   "Safe now: the count above proved every assignment has its invoice, and an
--    issued invoice carries its own copy of what it needed."
--
-- The second half is false. supabase/schema.sql gives invoices a number, the
-- amounts, the dates and the VAT treatment. It has no business_name, no
-- address_line, no postcode, no city, no vat_number, no iban and no
-- account_holder. Those exist in exactly two places: the invoice_settings row
-- this deletes, and the rendered PDF blob.
--
-- So the guard 027 added covers less than it claims. Two states pass it and
-- strand the money it exists to protect:
--
--   1. auto_send = false. createInvoiceForAssignment returns held:true without
--      delivering, and the only release path is a button behind
--      requireFreelancer — on an account this process bans for a century. The
--      reminder cron filters on sent_at is not null, so it never chases it
--      either. The facility never receives an invoice it was never told about,
--      while the 1,5% fee was taken at acceptance.
--
--   2. pdf_path is null because the bucket write failed. createInvoiceForAssignment
--      discards that boolean and logs. regenerateInvoicePdfAction is also
--      requireFreelancer-gated, so after anonymisation nobody can re-render it —
--      and if anybody could, getInvoiceSettings would now return nothing and the
--      PDF would carry no supplier address, no btw-id and no IBAN. Both parties
--      are left holding a seven-year retention duty (art. 52 AWR) on an invoice
--      with no document.
--
-- Both are unfinished business, and both are things the person can finish while
-- they still have an account. anonymise_blockers counts them, so the refusal
-- says so and the erasure waits — the same mechanism, widened to what it always
-- claimed to cover.

create or replace function anonymise_blockers(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $fn$
  select
    (
      -- Work with no invoice at all. See migration 027.
      select count(*)
      from assignments a
      where a.freelancer_id = p_profile_id
        and a.status <> 'cancelled'
        and not exists (select 1 from invoices i where i.assignment_id = a.id)
    )
    +
    (
      /*
       * Invoices that exist but are not finished. See migration 030.
       *
       * An invoice with no sent_at was never delivered — auto_send off leaves it
       * held, and the ONLY release path is a button behind requireFreelancer, on
       * an account this process bans. An invoice with no pdf_path has no document
       * either party can obtain, and re-rendering reads the supplier details live
       * from invoice_settings, which this process deletes.
       *
       * Counting them here is what makes 028's claim true. It deleted
       * invoice_settings under the line "an issued invoice carries its own copy of
       * what it needed" — and the invoices row has no business_name, address_line,
       * postcode, city, vat_number, iban or account_holder column. There is no
       * copy. The details live in invoice_settings and in the rendered blob, and
       * for these two states the blob does not exist or has not been sent.
       */
      select count(*)
      from invoices i
      where i.freelancer_id = p_profile_id
        and (i.sent_at is null or i.pdf_path is null)
    )
$fn$;

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
