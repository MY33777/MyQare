-- 002 — close a complete authorization bypass, and fix the dossier's headline number
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into functions.sql too.
--
-- ============================================================================
-- 1. CRITICAL: the RPCs were callable by any logged-in user
-- ============================================================================
-- accept_shift, settle_timesheet and cancel_assignment are `security definer`,
-- which means they run with the owner's rights and bypass RLS entirely. They were
-- also `grant execute ... to authenticated`, so any signed-in user could call them
-- directly through PostgREST with the public anon key.
--
-- Their signatures make that fatal rather than merely untidy, because the caller
-- supplies the things that should have been derived:
--
--   settle_timesheet(assignment_id, approver_id, fee_adjustment_cents)
--       A negative adjustment inserts a POSITIVE ledger row. Any user could mint
--       themselves unlimited credit, in one call, with no assignment of their own.
--
--   accept_shift(shift_id, freelancer_id, fee_total_cents, ...)
--       Both whose acceptance it is and what it costs are parameters. A user could
--       accept as somebody else, or accept for a fee of zero.
--
--   cancel_assignment(assignment_id, cancelled_by, reason)
--       No caller check at all; the "not after approval" guard lives only in
--       TypeScript, which a direct RPC call never touches.
--
-- THE FIX is to revoke execute from `authenticated`. These are only ever invoked
-- from server code with the SERVICE ROLE key (lib/assignments.ts uses
-- getSupabaseAdmin().rpc(...)), which is not subject to these grants, so nothing
-- legitimate breaks.
--
-- Note this is the *only* correct fix available without duplicating the fee
-- arithmetic into plpgsql. Adding an auth.uid() check inside the functions would
-- not work: called through the service role there is no JWT, so auth.uid() is
-- null and every legitimate call would fail. Authorization therefore stays in
-- lib/auth.ts and the server actions, which is where it already is — the bug was
-- leaving a second, unguarded door open beside it.

revoke execute on function accept_shift(uuid, uuid, integer, text, jsonb) from authenticated;
revoke execute on function settle_timesheet(uuid, uuid, integer) from authenticated;
revoke execute on function cancel_assignment(uuid, text, text) from authenticated;

revoke execute on function accept_shift(uuid, uuid, integer, text, jsonb) from anon;
revoke execute on function settle_timesheet(uuid, uuid, integer) from anon;
revoke execute on function cancel_assignment(uuid, text, text) from anon;

-- ============================================================================
-- 2. CRITICAL: the dossier's headline evidence counted the wrong thing
-- ============================================================================
-- compliance_records.declined_other_offers was filled from a CTE that only touched
-- offers still unanswered at the moment of acceptance:
--
--     update shift_offers set response = 'decline'
--     where shift_id = ... and freelancer_id <> ... and responded_at is null
--     returning 1
--
-- So somebody who had already actively declined was not counted. The number is
-- displayed as "gelijktijdig aangeboden aan N anderen" and is the single strongest
-- piece of evidence in the dossier — a shift offered to twelve people is a market,
-- one offered to one person looks like an instruction.
--
-- Counting only the silent ones inverts it: the MORE people exercised their right
-- to refuse, the SMALLER the number became. An audit would have been shown the
-- weakest possible version of a fact that was actually in the facility's favour.
--
-- Now counts every other offer on the shift, regardless of how or whether they
-- responded, which is what both the field's use and its label always meant.

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
  v_others integer;
begin
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

  select * into v_offer
  from shift_offers
  where shift_id = p_shift_id and freelancer_id = p_freelancer_id;

  if not found then
    raise exception 'Deze dienst is niet aan jou aangeboden.' using errcode = 'P0001';
  end if;

  if v_offer.responded_at is not null then
    raise exception 'Je hebt al op deze dienst gereageerd.' using errcode = 'P0001';
  end if;

  select coalesce(sum(delta_cents), 0)::integer into v_balance
  from credit_ledger where profile_id = p_freelancer_id;

  if v_balance < p_fee_total_cents then
    raise exception 'Onvoldoende saldo voor de bemiddelingsvergoeding.' using errcode = 'P0003';
  end if;

  -- Counted BEFORE the retiring update below, and without a responded_at filter:
  -- everyone else this shift was offered to, however they answered.
  select count(*)::integer into v_others
  from shift_offers
  where shift_id = p_shift_id and freelancer_id <> p_freelancer_id;

  insert into assignments (
    shift_id, freelancer_id, org_id, agreed_rate_cents, agreed_break_minutes, status
  ) values (
    p_shift_id, p_freelancer_id, v_shift.org_id,
    v_shift.hourly_rate_cents, v_shift.break_minutes, 'confirmed'
  )
  returning id into v_assignment_id;

  insert into credit_ledger (profile_id, delta_cents, reason, assignment_id, note)
  values (p_freelancer_id, -p_fee_total_cents, 'fee', v_assignment_id,
          'Bemiddelingsvergoeding 5% plus btw');

  update shift_offers
  set responded_at = now(), response = 'accept'
  where shift_id = p_shift_id and freelancer_id = p_freelancer_id;

  update shifts set status = 'filled' where id = p_shift_id;

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
    true,
    false,
    'facility_offer_accepted',
    v_others,
    p_snapshot
  );

  return v_assignment_id;
end;
$fn$;

-- ============================================================================
-- 3. HIGH: settle_timesheet could settle the same timesheet twice
-- ============================================================================
-- Approving twice — a double-click, a retry, a stale tab — wrote a second fee
-- adjustment for a timesheet that had already settled. The invoice side is
-- idempotent (createInvoiceForAssignment returns the existing row), but the ledger
-- side was not, so the freelancer was charged the difference again.
--
-- Now a no-op once approved_at is set. Checked inside the same transaction that
-- holds the row lock, so two concurrent approvals cannot both pass it.

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

  select approved_at into v_already_approved
  from timesheets where assignment_id = p_assignment_id;

  -- Already settled: return quietly. The caller treats this as success, which it
  -- is — the hours are approved and the fee has been charged exactly once.
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
      -p_fee_adjustment_cents,
      case when p_fee_adjustment_cents > 0 then 'fee_adjustment' else 'fee_refund' end,
      p_assignment_id,
      'Correctie na goedkeuring van de gewerkte uren'
    );
  end if;
end;
$fn$;

revoke execute on function accept_shift(uuid, uuid, integer, text, jsonb) from authenticated, anon;
revoke execute on function settle_timesheet(uuid, uuid, integer) from authenticated, anon;
