-- 006 — actually remove the phone number, and stop a delete erasing evidence
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH: migration 004 did not finish the job it described
-- ============================================================================
-- 004 moved phone numbers to profile_contact so that only a facility with a real
-- assignment could read them. It copied the data across, marked profiles.phone
-- deprecated with a COMMENT, and left the values sitting there.
--
-- profiles_select still returns the whole row to any facility with the person in
-- its pool, so the exact request 004 quotes as the attack:
--
--     GET /rest/v1/profiles?id=eq.<any pool member>&select=phone
--
-- kept working, against the original data, the entire time. The migration moved
-- the write path and left the exposure untouched — and its own header claimed the
-- problem was fixed.
--
-- 004 said to drop the column "in a later one once nothing references it". Nothing
-- does: the Profile type no longer carries it, no select requests it, and both
-- writers target profile_contact. So it goes now rather than waiting for a
-- convenient moment that never arrives.

alter table profiles drop column if exists phone;

-- ============================================================================
-- HIGH: deleting a shift erased the invoice and the dossier
-- ============================================================================
-- The chain was shifts -> assignments -> {invoices, compliance_records}, every
-- link `on delete cascade`. Removing one shift therefore destroyed:
--
--   - an issued, numbered, emailed invoice in the FREELANCER's name, leaving them
--     with no record of work they are owed for while the facility keeps the
--     service;
--   - the compliance record for that assignment — the evidence this product
--     exists to produce, and the one thing that must survive precisely when
--     somebody would rather it did not.
--
-- Migration 005 removed the shifts_delete policy, so no client can trigger it any
-- more. That is not enough: a cascade this destructive should not be reachable by
-- a mistaken service-role call or a staff action either. An invoice and a dossier
-- entry are records of something that happened, and a record of something that
-- happened is not deletable by tidying up the thing it happened to.
--
-- `restrict` rather than `set null`: the columns are NOT NULL, and an orphaned
-- invoice pointing at nothing would be worse than a refused delete. Cancelling is
-- the supported way to undo an assignment, and it leaves both records intact.

alter table assignments drop constraint if exists assignments_shift_id_fkey;
alter table assignments
  add constraint assignments_shift_id_fkey
  foreign key (shift_id) references shifts(id) on delete restrict;

alter table invoices drop constraint if exists invoices_assignment_id_fkey;
alter table invoices
  add constraint invoices_assignment_id_fkey
  foreign key (assignment_id) references assignments(id) on delete restrict;

alter table compliance_records drop constraint if exists compliance_records_assignment_id_fkey;
alter table compliance_records
  add constraint compliance_records_assignment_id_fkey
  foreign key (assignment_id) references assignments(id) on delete restrict;

-- Timesheets and ratings still cascade from assignments on purpose: they are
-- working state and an opinion, not a financial record or evidence. shift_offers
-- likewise cascades from shifts — an offer nobody took leaves nothing behind worth
-- keeping, and a shift with no assignment can still be deleted freely.

-- ============================================================================
-- CONSEQUENCE: deleting a person is no longer a cascade
-- ============================================================================
-- auth.users -> profiles -> freelancers -> assignments all cascade, and assignments
-- now hit `restrict` from invoices and compliance_records. So deleting a freelancer
-- who has ever been invoiced will FAIL rather than quietly erasing their invoices.
--
-- That is the correct behaviour and not merely a side effect. A Dutch invoice must
-- be retained for seven years, which is a statutory basis that an erasure request
-- under the AVG does not override — the obligation is on the freelancer as the
-- invoicing party, and the facility needs the record for its own bookkeeping too.
--
-- It does mean account deletion needs a real process rather than a DELETE:
-- anonymise the profile (name, contact, documents) and keep the financial rows,
-- which is what the AVG actually asks for where a retention duty applies. That
-- process does not exist yet and should be built before anyone asks for it.
--
-- scripts/seed.mts --reset hits the same wall once demo data has been invoiced;
-- it now says so instead of failing obscurely.
