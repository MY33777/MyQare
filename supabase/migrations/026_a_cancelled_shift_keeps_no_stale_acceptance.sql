-- 026 — reopening a cancelled shift must clear the acceptance that filled it
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- A reopened shift carried a stale "accept"
-- ============================================================================
-- cancel_assignment sets the shift back to open and reopens the offers it closed
-- when the shift was filled. It matched those on decline_reason = 'shift_filled'
-- only — and the accepting freelancer's own row is not one of those: it has
-- response = 'accept' and a null decline_reason.
--
-- So the shift went back to open carrying an acceptance that no longer meant
-- anything. The same freelancer accepting again produced a SECOND row with
-- response = 'accept' for one shift, and the facility's offer table counts those
-- — it read as two people having taken the same night.
--
-- The reopen now also clears the offer belonging to the freelancer whose
-- assignment was cancelled. A genuine decline still stays declined: somebody who
-- said no is not asked again because the person who said yes dropped out.
--
-- Generated from supabase/functions.sql rather than retyped. A previous migration
-- retyped a function from memory and silently flipped substitution_allowed from
-- false to true — a factual claim in the compliance dossier — which is why
-- supabase/sql.test.ts compares the two byte for byte.

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
  v_shift shifts%rowtype;
  v_charged integer;
begin
  select * into v_assignment from assignments where id = p_assignment_id for update;

  if not found then
    raise exception 'Opdracht niet gevonden.' using errcode = 'P0002';
  end if;

  if v_assignment.status = 'cancelled' then
    return; -- Idempotent: a double-tap must not refund twice.
  end if;

  /*
   * Hours submitted means the work happened, and cancelling it away left the
   * freelancer unpaid with no route back: the row leaves the approval queue for
   * good, and invoicing refuses without an approval that can no longer be given.
   * After this line the question is not whether the assignment exists but whether
   * the hours are right — which is what disputing is for. See migration 008.
   */
  if exists (select 1 from timesheets where assignment_id = p_assignment_id) then
    raise exception 'Uren zijn al ingediend.' using errcode = 'P0001';
  end if;

  update assignments
  set status = 'cancelled', cancelled_at = now(),
      cancelled_by = p_cancelled_by, cancel_reason = p_reason
  where id = p_assignment_id;

  select * into v_shift from shifts where id = v_assignment.shift_id for update;

  if v_shift.starts_at > now() then
    /*
     * Still in the future, so reopening is real: the facility does not have to
     * retype it, and somebody can actually take it.
     *
     * A lapsed respond_by is cleared rather than replaced with a guess — a
     * re-offer after a drop-out is urgent by definition — and accept_shift refuses
     * a started shift regardless, so nothing rides on that alone any more.
     */
    update shifts
    set status = 'open',
        respond_by = case when respond_by < now() then null else respond_by end
    where id = v_shift.id and status = 'filled';

    /*
     * The offers closed by the fill, AND the acceptance that caused the fill.
     *
     * This matched only decline_reason = 'shift_filled'. The accepting
     * freelancer's own row has response = 'accept' with a null decline_reason, so
     * it was left standing on a shift that had just gone back to 'open' — a stale
     * acceptance nobody could act on, and a second acceptance by the same person
     * then produced two 'accept' rows for one shift. The facility's offer table
     * counts those, so it read as two people having taken the same night.
     *
     * A genuine decline still stays declined: somebody who said no is not asked
     * again because the person who said yes dropped out.
     */
    update shift_offers
    set responded_at = null, response = null, decline_reason = null
    where shift_id = v_shift.id
      and (
        decline_reason = 'shift_filled'
        or (freelancer_id = v_assignment.freelancer_id and response = 'accept')
      );
  else
    /*
     * Already started or over. This is the common case: most cancellations after
     * the fact are no-shows, written up once somebody notices.
     *
     * Migration 008 reopened these too, which showed the facility a live shift on
     * its dashboard that nobody could fill and put a dead offer in every
     * freelancer's list. 'expired' is the honest state and the UI already labels it.
     */
    update shifts set status = 'expired' where id = v_shift.id and status = 'filled';
  end if;

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

revoke all on function cancel_assignment(uuid, text, text) from public, anon, authenticated;
