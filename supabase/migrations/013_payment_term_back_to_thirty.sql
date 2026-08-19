-- 013 — the payment term nobody decided to halve
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- MEDIUM: moving invoicing onto invoice_settings halved every payment term
-- ============================================================================
-- Before the settings table, lib/invoices.ts computed the due date from
-- PAYMENT_TERM_DAYS in lib/invoiceNumber.ts, which is 30 and whose comment calls
-- it the Dutch commercial default and what a facility's accounts-payable process
-- expects. Migration 010 introduced payment_term_days with a default of 14, and
-- invoicing switched to reading it.
--
-- Nobody chose that. Every invoice issued afterwards is due in half the time —
-- including for every freelancer 010 backfilled, who never opened the settings
-- page — and the reminder cron starts chasing on day 15 instead of day 31. The
-- test that pins 30 stayed green throughout, because it exercises dueDate() and
-- the invoice path no longer calls it.
--
-- Two constants for one rule is how this happens. lib/invoiceSettings.ts now
-- imports PAYMENT_TERM_DAYS rather than declaring a second number.

alter table invoice_settings alter column payment_term_days set default 30;

-- Rows still carrying the value nobody selected.
--
-- This cannot distinguish a backfilled 14 from a deliberately chosen 14, and the
-- honest answer is that at the time of writing there are no rows at all: nothing
-- in this repo has ever been run against a database. If that has changed by the
-- time you read this, check whether anybody set 14 on purpose before running it.
update invoice_settings set payment_term_days = 30 where payment_term_days = 14;
