-- 003 — stop either party rewriting the amounts after the work
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH: assignments_update granted row-wide UPDATE
-- ============================================================================
-- agreed_rate_cents is documented as an immutable snapshot — "if the facility
-- later edits the shift, what was agreed does not move" — and it is the column
-- lib/invoices.ts bills from. But the policy granted UPDATE on the whole ROW to
-- both parties, and Postgres row policies cannot pin columns. schema.sql already
-- notes that limitation for profiles_update; nothing pinned it here.
--
-- What that allowed, from an ordinary signed-in session:
--
--   PATCH /rest/v1/assignments?id=eq.<their own assignment>
--   {"agreed_rate_cents": 3300}
--
-- USING and WITH CHECK both pass, because freelancer_id still equals auth.uid().
-- The facility then approves, createInvoiceForAssignment re-reads the row, and
-- bills 8h at EUR 33,00 instead of the EUR 30,00 that was accepted — under a real
-- sequential invoice number, rendered into the PDF, emailed to the crediteuren
-- mailbox. Repeatable, and the inflated figure becomes the system of record.
--
-- It cuts the other way too: `org_id = current_org_id()` let the FACILITY deflate
-- the rate after the work was done, and the freelancer has no approval step in
-- that direction to catch it.
--
-- The same policy also allowed setting status directly, so a PATCH to
-- status='cancelled' bypassed cancel_assignment entirely — the shift was never
-- reopened and the fee was never refunded.
--
-- Dropped rather than narrowed. Every write to assignments in the tree already
-- goes through the service role or a definer function (accept_shift,
-- settle_timesheet, cancel_assignment, and the dispute update in
-- app/zorginstelling/uren/actions.ts), so there is no user-scoped update to
-- support. That matches the deliberate absence of an insert policy on the same
-- table.

drop policy if exists assignments_update on assignments;

-- ============================================================================
-- MEDIUM: invoices_update let the debtor rewrite the creditor's invoice
-- ============================================================================
-- The policy existed so a facility could mark an invoice paid. Being row-wide, it
-- also let the facility rewrite total_cents, vat_amount_cents and the invoice
-- number on a document issued in the FREELANCER's name — the one party with no
-- way to see it had been altered.
--
-- markInvoicePaidAction already uses the service role and checks org ownership
-- itself, so nothing legitimate depends on this policy either.

drop policy if exists invoices_update on invoices;

-- Reading stays exactly as it was: both parties still see their own invoices.
-- Only the client-side write path is gone.
