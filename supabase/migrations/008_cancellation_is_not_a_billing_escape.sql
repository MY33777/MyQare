-- 008 — make cancellation mean one thing, and make reopening actually work
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into functions.sql and
-- schema.sql too.
--
-- Three defects at the same seam: what "cancelled" means once work has happened.
-- Two of them were introduced by earlier fixes in this series.

-- ============================================================================
-- HIGH: approving a cancelled assignment charged the whole fee again
-- ============================================================================
-- Migration 005 rewrote settle_timesheet to derive its delta from the ledger —
-- `owed_total - already_charged` — and deleted the `already_approved` guard on
-- the strength of that arithmetic. The reasoning was sound and the sum was not:
-- already_charged nets over ('fee', 'fee_adjustment', 'fee_refund'), and
-- cancel_assignment writes its refund into that same bucket. So after a
-- cancellation the net is exactly zero, and the next settle_timesheet computes
-- delta = the ENTIRE fee and charges it.
--
-- Nothing else caught it. settle_timesheet took the row lock, read the row into
-- v_assignment, and then never looked at its status again — it ran
-- `update assignments set status = 'completed'` unconditionally, so a cancelled
-- assignment came back as completed while still carrying cancelled_at,
-- cancelled_by and cancel_reason. createInvoiceForAssignment then allocated a
-- real gapless invoice number and emailed a PDF for work that had been
-- explicitly refunded, and there is no credit-note path to take it back.
--
-- The guard goes inside the function, where the lock is already held. Checking in
-- the server action too is worth doing for the error message, but a check that
-- lives only there is one forgotten call site away from being inert — which is
-- exactly how this defect and its two predecessors happened.

-- ============================================================================
-- HIGH: cancelling after the work was done destroyed the only path to payment
-- ============================================================================
-- The only state gate on cancelling was approval:
--
--     if (assignment.timesheets?.approved_at) redirect(...)
--
-- so a shift that had actually been worked, with hours sitting in the approval
-- queue, was cancellable by either party. From that moment it could never be
-- billed: /zorginstelling/uren filters out cancelled rows, so it left the queue
-- for good; createInvoiceForAssignment refuses without approved_at, and its only
-- caller is the approve button that no longer renders. Care was delivered and
-- became unbillable, and the party who lost the money is the one who did the work.
--
-- A submitted timesheet is the system's own record that the work happened, so
-- that is the line. After it, the question is no longer whether the assignment
-- exists — it is whether the hours are right, which is what disputing is for.

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

  -- The ledger nets to zero after a refund, so without this the delta below is
  -- the entire fee. See the header.
  if v_assignment.status = 'cancelled' then
    raise exception 'Opdracht is geannuleerd.' using errcode = 'P0001';
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

  -- Zero on a replay: no row, no double charge, nothing to reconcile afterwards.
  if v_delta <> 0 then
    insert into credit_ledger (profile_id, delta_cents, reason, assignment_id, note)
    values (
      v_assignment.freelancer_id,
      -- A positive delta means more fee is owed, so it leaves the balance.
      -v_delta,
      case when v_delta > 0 then 'fee_adjustment' else 'fee_refund' end,
      p_assignment_id,
      'Correctie na goedkeuring van de gewerkte uren'
    );
  end if;
end;
$fn$;

-- ============================================================================
-- MEDIUM: the shift was reopened into a state nothing could ever fill
-- ============================================================================
-- cancel_assignment set the shift back to 'open' so, per its own comment, "the
-- facility does not have to retype it". Re-filling was impossible by construction:
--
--   * accept_shift had already stamped responded_at on every offer for that shift
--     — accepted on one, declined with 'shift_filled' on the rest — and
--     /professional/aanbod lists only offers with responded_at is null. The shift
--     had therefore already vanished from every offeree's screen, and nothing
--     anywhere cleared that stamp.
--   * assignments.shift_id was UNIQUE and the cancelled row still held it, so a
--     second acceptance raised 23505, which mapAcceptError reported to the
--     freelancer as the generic "Er ging iets mis".
--   * respond_by had usually lapsed by then, which accept_shift refuses outright.
--
-- So the facility's dashboard showed an open shift that no freelancer could see
-- and no freelancer could take. Reopening now does all of it, or it should not
-- have been claimed at all.

create or replace function cancel_assignment(
  p_assignment_id uuid,
  p_cancelled_by text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_assignment assignments%rowtype;
  v_charged integer;
begin
  select * into v_assignment from assignments where id = p_assignment_id for update;

  if not found then
    raise exception 'Opdracht niet gevonden.' using errcode = 'P0002';
  end if;

  if v_assignment.status = 'cancelled' then
    return; -- Idempotent: a double-tap must not refund twice.
  end if;

  -- Hours submitted means the work happened. Cancelling it away would leave the
  -- freelancer unpaid with no route back; the facility disputes the hours instead.
  if exists (select 1 from timesheets where assignment_id = p_assignment_id) then
    raise exception 'Uren zijn al ingediend.' using errcode = 'P0001';
  end if;

  update assignments
  set status = 'cancelled', cancelled_at = now(),
      cancelled_by = p_cancelled_by, cancel_reason = p_reason
  where id = p_assignment_id;

  /*
   * Reopen the shift properly. respond_by is cleared rather than extended when it
   * has already lapsed: any new deadline would be an arbitrary guess, and a shift
   * being re-offered after a drop-out is urgent by definition. accept_shift still
   * refuses once the shift itself has started.
   */
  update shifts
  set status = 'open',
      respond_by = case when respond_by < now() then null else respond_by end
  where id = v_assignment.shift_id and status = 'filled';

  -- Only the offers that were closed BY the fill. A genuine decline stays
  -- declined — somebody who said no is not asked again because the person who
  -- said yes dropped out.
  update shift_offers
  set responded_at = null, response = null, decline_reason = null
  where shift_id = v_assignment.shift_id and decline_reason = 'shift_filled';

  -- Refund exactly what was charged, read back from the ledger rather than
  -- recalculated. Recalculating would refund a different amount if the fee rate
  -- ever changed between the charge and the cancellation.
  select coalesce(-sum(delta_cents), 0)::integer into v_charged
  from credit_ledger
  where assignment_id = p_assignment_id and reason in ('fee', 'fee_adjustment', 'fee_refund');

  if v_charged > 0 then
    insert into credit_ledger (profile_id, delta_cents, reason, assignment_id, note)
    values (v_assignment.freelancer_id, v_charged, 'fee_refund', p_assignment_id,
            'Terugbetaling na annulering');
  end if;
end;
$fn$;

revoke all on function settle_timesheet(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function cancel_assignment(uuid, text, text) from public, anon, authenticated;

-- A cancelled assignment must stop reserving the shift, or the replacement
-- freelancer's accept raises a unique violation the UI can only call "Er ging
-- iets mis". Partial, so exactly one LIVE assignment per shift still holds.
alter table assignments drop constraint if exists assignments_shift_id_key;
drop index if exists assignments_shift_id_active_idx;
create unique index assignments_shift_id_active_idx
  on assignments (shift_id)
  where status <> 'cancelled';

-- ============================================================================
-- HIGH: changing a BIG number kept the 'Geverifieerd' badge
-- ============================================================================
-- The comment above the write said the stamp is "cleared whenever the BIG number
-- changes", but the conditional spread only cleared it when the field was
-- EMPTIED. Editing it to a different number wrote the new number and the old
-- verification timestamp in one UPDATE.
--
-- /beheer's queue lists freelancers with a BIG number and no verification stamp,
-- so a changed-but-still-stamped number was filtered out of the only screen that
-- would ever have caught it — and unlike organisations, freelancers have no
-- revoke control. Meanwhile every facility in that person's pool kept rendering a
-- green "Geverifieerd" badge beside a number nobody had checked, and leaned on it
-- for its own Wkkgz duty.
--
-- Fixed in app/professional/profiel/actions.ts too, but it belongs here as well:
-- a verification refers to one specific number, and that invariant should not
-- depend on every future writer remembering it.

create or replace function clear_big_verification_on_change()
returns trigger
language plpgsql
as $fn$
begin
  if new.big_number is distinct from old.big_number then
    new.big_verified_at := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists freelancers_clear_big_verification on freelancers;
create trigger freelancers_clear_big_verification
  before update on freelancers
  for each row
  execute function clear_big_verification_on_change();

-- ============================================================================
-- MEDIUM: adding someone to a pool searched one page of accounts
-- ============================================================================
-- addToPoolAction resolved the typed address by pulling a single page of users
-- from the auth admin API and scanning it in memory. Only the first 1000 accounts
-- could ever match, and GoTrue orders that endpoint created_at DESC — so the ones
-- that fell off the end were the LONGEST-TENURED. Precisely the people a facility
-- already works with, which is who the form exists to onboard.
--
-- They were told "Geen MyQare-account gevonden met dit e-mailadres", an assertion
-- the code never established. Adding by email is the only route into a pool.
--
-- A targeted lookup instead. Returns an id and nothing else — no email, no
-- metadata, no way to enumerate — and only the service role may call it, like
-- every other function here.

create or replace function lookup_account_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public
stable
as $fn$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$fn$;

revoke all on function lookup_account_by_email(text) from public, anon, authenticated;
