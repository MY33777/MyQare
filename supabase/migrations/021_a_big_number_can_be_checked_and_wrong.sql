-- 021 — a BIG number can be looked up and NOT found, and that has to be recordable
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- The queue had no exit for the answer it exists to produce
-- ============================================================================
-- /beheer lists freelancers where big_number is not null and big_verified_at is
-- null, and offers two buttons. "Verifiëren" sets big_verified_at. The other one
-- sets it to NULL — which is the value it already had, so the row does not move.
--
-- So a reviewer who looks a number up in bigregister.nl and does NOT find it has
-- nowhere to put that. The row stays in the queue, comes back tomorrow, and gets
-- looked up again by the next person. The one outcome the check exists to detect
-- is the one the product cannot record.
--
-- Worse, it is silent in both directions: the freelancer is never told their
-- number could not be found, so they cannot correct a typo — and a typo is by far
-- the likeliest cause. A BIG number is eleven digits typed from memory.

alter table freelancers add column if not exists big_checked_at timestamptz;
alter table freelancers add column if not exists big_check_note text;

comment on column freelancers.big_checked_at is
  'When a human last looked this number up in the BIG-register, whatever the '
  'outcome. big_verified_at records only a SUCCESSFUL check; this records that '
  'the work was done, so a number that was checked and not found leaves the '
  'review queue instead of being looked up again every day.';

comment on column freelancers.big_check_note is
  'Why a check failed, shown to the freelancer so they can correct it. Almost '
  'always a typo — eleven digits from memory — which nobody could tell them '
  'before this existed.';

-- ============================================================================
-- The queue, and how a row returns to it
-- ============================================================================
-- The application now filters on `big_verified_at is null and big_checked_at is
-- null`, so a checked-and-rejected number is out of the queue.
--
-- It comes back when the freelancer edits their BIG number: the profile action
-- clears big_checked_at along with the note, because a new number is a new claim
-- and has not been checked. That is application code rather than a trigger on
-- purpose — a trigger firing on any update to the row would also clear the check
-- when somebody edits their bio.

-- Nothing to backfill. Every existing row has big_checked_at null, which is
-- exactly "not yet looked at" — the state the queue is built on.
