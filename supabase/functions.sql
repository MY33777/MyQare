-- MyQare — stored procedures
--
-- Run AFTER schema.sql, in the same SQL editor. Safe to re-run.
--
-- ============================================================================
-- WHY THESE EXIST AT ALL
-- ============================================================================
-- The Supabase JS client sends one statement per call and has no client-side
-- transaction. Accepting a shift has to do five things that must all happen or
-- none of them:
--
--   1. claim the shift, exactly once, even if two freelancers tap at the same moment
--   2. create the assignment
--   3. charge the 5% fee against the credit ledger
--   4. write the compliance record
--   5. retire the other outstanding offers
--
-- Doing that from application code means a crash between steps 3 and 4 leaves a
-- freelancer charged for an assignment with no dossier — the one artefact this
-- product exists to produce. So the whole sequence lives in one plpgsql function
-- and runs inside a single transaction.
--
-- The race is real, not theoretical: an urgent shift is broadcast to a whole
-- region and the rule has always been "first to claim it gets it". The
-- `for update` lock on the shift row serialises those taps.

-- ============================================================================
-- accept_shift
-- ============================================================================
create or replace function accept_shift(
  p_shift_id uuid,
  p_freelancer_id uuid,
  p_fee_total_cents integer,
  p_model_agreement_version text,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_shift shifts%rowtype;
  v_offer shift_offers%rowtype;
  v_balance integer;
  v_assignment_id uuid;
  v_declined integer;
begin
  -- Lock the shift first. Everything else hangs off whether this row is still
  -- open, so taking the lock before any other read is what makes the check
  -- meaningful rather than advisory.
  select * into v_shift from shifts where id = p_shift_id for update;

  if not found then
    raise exception 'Deze dienst bestaat niet meer.' using errcode = 'P0002';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'Deze dienst is niet meer beschikbaar.' using errcode = 'P0001';
  end if;

  if v_shift.respond_by is not null and v_shift.respond_by < now() then
    raise exception 'De reactietermijn voor deze dienst is verstreken.' using errcode = 'P0001';
  end if;

  -- The offer is the freelancer's entitlement to accept. Without this check,
  -- anyone who learned a shift id could take work never offered to them.
  select * into v_offer
  from shift_offers
  where shift_id = p_shift_id and freelancer_id = p_freelancer_id;

  if not found then
    raise exception 'Deze dienst is niet aan jou aangeboden.' using errcode = 'P0001';
  end if;

  if v_offer.responded_at is not null then
    raise exception 'Je hebt al op deze dienst gereageerd.' using errcode = 'P0001';
  end if;

  -- Balance is the sum of the ledger; there is no balance column to read.
  select coalesce(sum(delta_cents), 0)::integer into v_balance
  from credit_ledger where profile_id = p_freelancer_id;

  if v_balance < p_fee_total_cents then
    raise exception 'Onvoldoende saldo voor de bemiddelingsvergoeding.' using errcode = 'P0003';
  end if;

  insert into assignments (
    shift_id, freelancer_id, org_id, agreed_rate_cents, agreed_break_minutes, status
  ) values (
    p_shift_id, p_freelancer_id, v_shift.org_id,
    v_shift.hourly_rate_cents, v_shift.break_minutes, 'confirmed'
  )
  returning id into v_assignment_id;

  -- Negative: a fee is money leaving the balance.
  insert into credit_ledger (profile_id, delta_cents, reason, assignment_id, note)
  values (p_freelancer_id, -p_fee_total_cents, 'fee', v_assignment_id,
          'Bemiddelingsvergoeding 5% plus btw');

  update shift_offers
  set responded_at = now(), response = 'accept'
  where shift_id = p_shift_id and freelancer_id = p_freelancer_id;

  update shifts set status = 'filled' where id = p_shift_id;

  /*
   * Counted BEFORE retiring anything, and WITHOUT a responded_at filter.
   *
   * The previous version counted only offers still unanswered at this moment, so
   * anyone who had already actively declined was excluded. That inverts the
   * dossier's strongest fact: the more people exercised their right to refuse, the
   * smaller "aangeboden aan N anderen" became, and an audit would have seen the
   * weakest possible version of something in the facility's favour.
   */
  select count(*)::integer into v_declined
  from shift_offers
  where shift_id = p_shift_id and freelancer_id <> p_freelancer_id;

  -- Everyone else's outstanding offer is now moot.
  update shift_offers
  set responded_at = now(), response = 'decline', decline_reason = 'shift_filled'
  where shift_id = p_shift_id
    and freelancer_id <> p_freelancer_id
    and responded_at is null;

  insert into compliance_records (
    assignment_id, model_agreement_version, offered_at, accepted_at,
    could_decline, substitution_allowed, rate_set_by, declined_other_offers, snapshot
  ) values (
    v_assignment_id, p_model_agreement_version,
    coalesce(v_offer.notified_at, v_offer.created_at), now(),
    -- Always true, and recorded rather than assumed. Auto-accept does not exist
    -- in this product precisely so this can be stated truthfully.
    true,
    false,
    'facility_offer_accepted',
    v_declined,
    p_snapshot
  );

  return v_assignment_id;
end;
$fn$;

-- ============================================================================
-- settle_timesheet
-- ============================================================================
-- The fee was charged at acceptance on the SCHEDULED duration, because that is
-- the only moment we can refuse for insufficient balance. Shifts then routinely
-- run short or long, so the difference is settled here as a second ledger entry
-- rather than by rewriting the first — see the append-only note in schema.sql.
create or replace function settle_timesheet(
  p_assignment_id uuid,
  p_approver_id uuid,
  p_fee_adjustment_cents integer
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_assignment assignments%rowtype;
  v_already_approved timestamptz;
begin
  select * into v_assignment from assignments where id = p_assignment_id for update;

  if not found then
    raise exception 'Opdracht niet gevonden.' using errcode = 'P0002';
  end if;

  /*
   * Idempotent. A double-click, a retry or a stale tab previously wrote a SECOND
   * fee adjustment for a timesheet that had already settled — the invoice side was
   * idempotent but the ledger side was not, so the freelancer paid the difference
   * twice. Checked inside the transaction holding the row lock, so two concurrent
   * approvals cannot both get past it.
   */
  select approved_at into v_already_approved
  from timesheets where assignment_id = p_assignment_id;

  if v_already_approved is not null then
    return;
  end if;

  update timesheets
  set approved_at = now(), approved_by = p_approver_id, disputed_at = null, dispute_reason = null
  where assignment_id = p_assignment_id;

  update assignments set status = 'completed' where id = p_assignment_id;

  if p_fee_adjustment_cents <> 0 then
    insert into credit_ledger (profile_id, delta_cents, reason, assignment_id, note)
    values (
      v_assignment.freelancer_id,
      -- Sign convention: a POSITIVE adjustment means the shift ran long and more
      -- fee is owed, so it leaves the balance. Negative means a refund.
      -p_fee_adjustment_cents,
      case when p_fee_adjustment_cents > 0 then 'fee_adjustment' else 'fee_refund' end,
      p_assignment_id,
      'Correctie na goedkeuring van de gewerkte uren'
    );
  end if;
end;
$fn$;

-- ============================================================================
-- cancel_assignment
-- ============================================================================
-- Cancelling refunds the whole fee. The freelancer paid for work they will not
-- do, and keeping that would be indefensible whichever side cancelled.
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

  update assignments
  set status = 'cancelled', cancelled_at = now(),
      cancelled_by = p_cancelled_by, cancel_reason = p_reason
  where id = p_assignment_id;

  -- Reopen the shift so the facility does not have to retype it.
  update shifts set status = 'open' where id = v_assignment.shift_id and status = 'filled';

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

-- ============================================================================
-- NOBODY BUT THE SERVICE ROLE MAY CALL THESE
-- ============================================================================
-- These are security definer: they run with the owner's rights and bypass RLS.
-- Their signatures also let the caller supply what should have been derived —
-- settle_timesheet takes the fee adjustment as a parameter, so a negative value
-- inserts a positive ledger row, and accept_shift takes both the freelancer id and
-- the fee. Granting execute to  therefore let any signed-in user
-- mint credit or accept work as someone else, straight through PostgREST.
--
-- They are only ever invoked from server code holding the SERVICE ROLE key
-- (lib/assignments.ts), which these grants do not constrain. Authorization lives
-- in lib/auth.ts and the server actions; the bug was leaving a second, unguarded
-- door open beside that.
--
-- An auth.uid() check inside the functions is NOT an alternative: under the service
-- role there is no JWT, so auth.uid() is null and every legitimate call would fail.
revoke all on function accept_shift(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
revoke all on function settle_timesheet(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function cancel_assignment(uuid, text, text) from public, anon, authenticated;
