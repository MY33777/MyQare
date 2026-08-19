-- 011 — money that comes back out
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.

-- ============================================================================
-- HIGH: a refund or chargeback left the credit on the balance
-- ============================================================================
-- The webhook handled exactly one event, checkout.session.completed. There was no
-- handler for charge.refunded, charge.dispute.created or
-- payment_intent.payment_failed anywhere in the codebase.
--
-- So: somebody tops up €500, spends it accepting shifts, then disputes the charge
-- with their bank. Stripe pulls the money back. MyQare never hears about it, the
-- €500 stays on their balance, and they keep accepting work with it. The ledger is
-- append-only and had no reversal reason, so even a manual fix had to be
-- misfiled as 'manual'.
--
-- 'chargeback' is its own reason rather than a negative 'topup'. A reversal is not
-- an anti-top-up: it needs to be visible as what it is on the freelancer's balance
-- page and countable separately when somebody asks how much of this has happened.

alter table credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table credit_ledger
  add constraint credit_ledger_reason_check
  check (reason in ('topup', 'fee', 'fee_refund', 'fee_adjustment', 'manual', 'chargeback'));

-- ============================================================================
-- The reversal must be idempotent too
-- ============================================================================
-- A top-up is deduplicated by the unique index on stripe_payment_intent. A
-- reversal of that same payment cannot reuse the value — it would collide with the
-- top-up itself — so it is stored prefixed, and gets its own uniqueness from the
-- same index. Stripe redelivers dispute events as readily as payment ones.
--
-- No new column: 'reversal:pi_xxx' is a distinct string, and the existing unique
-- index already covers it. A second column would be a second thing to keep in
-- step for no gain.

comment on column credit_ledger.stripe_payment_intent is
  'Stripe payment intent id for a top-up, or ''reversal:<id>'' for the entry that '
  'takes it back after a refund or chargeback. Unique either way, which is what '
  'makes both directions safe against Stripe redelivering an event.';

-- ============================================================================
-- MEDIUM: the balance could go negative on a reversal
-- ============================================================================
-- Deliberately allowed. The alternative is refusing to record that the money was
-- taken back, which does not make it come back — it just moves the loss somewhere
-- nobody can see it. A negative balance is accurate, blocks further acceptances
-- through accept_shift's existing check, and is a number somebody can act on.
