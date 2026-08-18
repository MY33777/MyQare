-- 005 — remove every client-side write path
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- WHY THIS IS A SWEEP AND NOT TWO MORE DROPS
-- ============================================================================
-- Migration 003 dropped assignments_update and invoices_update because a Postgres
-- ROW policy cannot restrict columns: granting "update your own row" also grants
-- "rewrite any column in it". A second audit then found the identical mistake in
-- two more places, one of which is worse than anything found before.
--
-- Dropping those two as well would be whack-a-mole. So: every write policy in the
-- schema is removed, because a check of the application shows there is not a
-- single client-side write anywhere in it. All 21 files that write to Postgres use
-- getSupabaseAdmin() — the service role — and the service role is not governed by
-- these policies at all. Every one of the fifteen was dead weight AND an attack
-- surface.
--
-- ============================================================================
-- THE TWO THAT WERE BEING EXPLOITED
-- ============================================================================
-- timesheets_write granted `for all` on the table holding approved_at — the exact
-- column BOTH of the previous round's fixes depend on. Migration 002 made
-- settle_timesheet idempotent by returning early when approved_at is set, and
-- submitTimesheetAction was patched so it can no longer blank that column. Both
-- were inert:
--
--     PATCH /rest/v1/timesheets?assignment_id=eq.<x>  {"approved_at": null}
--
-- passes USING and WITH CHECK for both the freelancer and the facility. The row
-- returns to the approval queue, the second approval passes the now-null guard,
-- and feeAdjustmentCents recomputes against the SCHEDULED baseline with no memory
-- of what already settled — charging the same delta again, repeatably. The same
-- blanking re-opens cancelAssignmentAction, whose guard reads the same column, so
-- the whole fee can be refunded on work that was performed, approved and invoiced.
-- `for all` also grants DELETE, reaching the same end with no PATCH at all. And the
-- facility branch granted UPDATE on minutes_claimed, which is what invoices bill
-- from — a debtor could reduce the hours and click approve, issuing a smaller
-- invoice in the freelancer's name with the ledger corroborating it.
--
-- profiles_update exposed `role`. Any signed-in user could send
--
--     PATCH /rest/v1/profiles?id=eq.<self>  {"role": "staff"}
--
-- 'staff' is a legal value in the CHECK constraint, is_staff() reads that column,
-- and is_staff() appears in the USING clause of most policies in this file. One
-- request later that account can read every identity document, VOG, phone number,
-- invoice and ledger row on the platform — including the profile_contact table
-- migration 004 had just created to protect phone numbers. Writing `org_id`
-- instead joins any care facility.
--
-- The defence against this was a COMMENT on the policy saying the client is never
-- given a form that posts those columns. Migration 004 already wrote the rebuttal,
-- about a phone number: hiding a field in the template is not access control. The
-- anon key ships to the browser; PostgREST accepts whatever it is sent.
--
-- ============================================================================
-- CONSEQUENCE TO BE AWARE OF
-- ============================================================================
-- After this, `authenticated` can READ (every select policy is untouched) and
-- cannot write anything. Authorization for writes lives entirely in lib/auth.ts
-- and the server actions.
--
-- That is a deliberate trade and it has a real cost: RLS is no longer a backstop
-- for writes. If a server action forgets its ownership check, nothing else catches
-- it. Comments elsewhere in this codebase describe RLS as "the backstop that holds
-- even when app code is wrong" — for reads that is true, for writes it is not, and
-- overstating it is how the two defects above survived review.
--
-- If a client-side write is ever genuinely needed, note that supabase-js reports
-- SUCCESS with zero rows when RLS blocks an update. It will fail silently. Add an
-- explicit policy AND a BEFORE UPDATE trigger pinning the immutable columns,
-- because the policy alone cannot.

drop policy if exists organisations_update on organisations;
drop policy if exists profiles_insert on profiles;
drop policy if exists profiles_update on profiles;
drop policy if exists profile_contact_write on profile_contact;
drop policy if exists freelancers_write on freelancers;
drop policy if exists documents_write on documents;
drop policy if exists pools_write on pools;
drop policy if exists shifts_insert on shifts;
drop policy if exists shifts_update on shifts;
drop policy if exists shifts_delete on shifts;
drop policy if exists shift_offers_update on shift_offers;
drop policy if exists shift_offers_insert on shift_offers;
drop policy if exists timesheets_write on timesheets;
drop policy if exists ratings_insert on ratings;
drop policy if exists availability_write on availability_blocks;

-- Belt and braces. With RLS on and no permissive policy for a command, Postgres
-- already denies it — but revoking the table grants means a policy added later by
-- mistake still cannot hand out write access on its own.
revoke insert, update, delete on organisations from authenticated, anon;
revoke insert, update, delete on profiles from authenticated, anon;
revoke insert, update, delete on profile_contact from authenticated, anon;
revoke insert, update, delete on freelancers from authenticated, anon;
revoke insert, update, delete on documents from authenticated, anon;
revoke insert, update, delete on pools from authenticated, anon;
revoke insert, update, delete on shifts from authenticated, anon;
revoke insert, update, delete on shift_offers from authenticated, anon;
revoke insert, update, delete on assignments from authenticated, anon;
revoke insert, update, delete on timesheets from authenticated, anon;
revoke insert, update, delete on invoices from authenticated, anon;
revoke insert, update, delete on credit_ledger from authenticated, anon;
revoke insert, update, delete on ratings from authenticated, anon;
revoke insert, update, delete on compliance_records from authenticated, anon;
revoke insert, update, delete on availability_blocks from authenticated, anon;
revoke insert, update, delete on rate_limit_hits from authenticated, anon;

-- SELECT is deliberately untouched everywhere: reads still go through the user's
-- own client and are still governed by the select policies.

-- ============================================================================
-- DEFENCE IN DEPTH: make settlement idempotent by construction
-- ============================================================================
-- The exploit above worked because settle_timesheet took the fee ADJUSTMENT as a
-- parameter, computed in TypeScript as (owed for actual hours - owed for scheduled
-- hours). That delta is measured against the schedule and carries no memory of
-- what has already been charged, so replaying an approval charged the same amount
-- again.
--
-- It now takes the TOTAL fee owed for the hours actually worked, and derives the
-- movement from the ledger itself:
--
--     delta = owed_total - already_charged
--
-- A replay computes already_charged == owed_total, so delta is zero and no row is
-- written. Idempotent without needing a guard to hold — which matters, because the
-- guard is exactly what an attacker cleared.
--
-- The fee arithmetic still lives in lib/fees.ts and is still passed in; only the
-- reconciliation moved to where the ledger is.

drop function if exists settle_timesheet(uuid, uuid, integer);

create or replace function settle_timesheet(
  p_assignment_id uuid,
  p_approver_id uuid,
  p_fee_total_owed_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_assignment assignments%rowtype;
  v_already_charged integer;
  v_delta integer;
begin
  select * into v_assignment from assignments where id = p_assignment_id for update;

  if not found then
    raise exception 'Opdracht niet gevonden.' using errcode = 'P0002';
  end if;

  update timesheets
  set approved_at = now(), approved_by = p_approver_id, disputed_at = null, dispute_reason = null
  where assignment_id = p_assignment_id;

  update assignments set status = 'completed' where id = p_assignment_id;

  -- Fee rows are negative (money leaving the balance), so negating the sum gives
  -- the positive total charged so far across the original fee and any corrections.
  select coalesce(-sum(delta_cents), 0)::integer into v_already_charged
  from credit_ledger
  where assignment_id = p_assignment_id
    and reason in ('fee', 'fee_adjustment', 'fee_refund');

  v_delta := p_fee_total_owed_cents - v_already_charged;

  -- Zero on a replay. No row, no double charge, nothing to clean up.
  if v_delta <> 0 then
    insert into credit_ledger (profile_id, delta_cents, reason, assignment_id, note)
    values (
      v_assignment.freelancer_id,
      -v_delta,
      case when v_delta > 0 then 'fee_adjustment' else 'fee_refund' end,
      p_assignment_id,
      'Correctie na goedkeuring van de gewerkte uren'
    );
  end if;
end;
$fn$;

revoke all on function settle_timesheet(uuid, uuid, integer) from public, anon, authenticated;
