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
--   3. charge the platform fee against the credit ledger
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

  /*
   * The check that was documented in cancel_assignment and never written here.
   *
   * accept_shift verified status, the offer, respond_by and the balance, and never
   * looked at starts_at. respond_by carried the duty implicitly, but it is
   * nullable — and migration 008 then began CLEARING it whenever it had lapsed,
   * which is exactly when a shift is about to start or already has.
   *
   * starts_at rather than ends_at: turning up halfway through a shift is not
   * something to sell, and a facility wanting late cover can post the remaining
   * hours as a new shift at a rate it chooses.
   */
  if v_shift.starts_at <= now() then
    raise exception 'Deze dienst is al begonnen.' using errcode = 'P0001';
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

  /*
   * Serialise on the FREELANCER, not just the shift.
   *
   * The `for update` above locks the shift row, which correctly makes two people
   * racing for one shift into a queue. It does nothing about one person accepting
   * two DIFFERENT shifts at the same moment: those are different shift rows, so
   * both transactions proceed, both read the same balance, both pass the check
   * below and both insert a fee. A freelancer with €25 of credit can accept two
   * €20 shifts and land at −€15.
   *
   * The ledger is append-only and has no balance column to constrain, so there is
   * no check constraint that could catch it. Locking the freelancer row is what
   * turns "read the balance, then spend it" into one atomic decision.
   */
  perform 1 from freelancers where profile_id = p_freelancer_id for update;

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
          'Bemiddelingsvergoeding plus btw');

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
-- Takes the TOTAL fee owed for the hours actually worked, not a delta.
--
-- The earlier version took the adjustment, computed in TypeScript as
-- (owed for actual - owed for scheduled). That measures against the schedule and
-- carries no memory of what has already been charged, so replaying an approval
-- charged the same amount a second time. A guard on approved_at was added to stop
-- the replay — and clearing that column turned out to be exactly what an attacker
-- could do (see migration 005).
--
-- Deriving the movement from the ledger removes the need for the guard to hold:
--
--     delta = owed_total - already_charged
--
-- A replay computes already_charged == owed_total, so nothing is written. The fee
-- arithmetic still lives in lib/fees.ts; only the reconciliation moved to where
-- the ledger is.
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

  /*
   * A cancelled assignment must not settle. The delta below is derived from the
   * ledger, and cancel_assignment's refund lands in the very bucket that sum
   * nets over — so after a cancellation already_charged is exactly zero and the
   * delta becomes the ENTIRE fee, charged a second time for work that was
   * explicitly refunded. It also flipped the row back to 'completed', which then
   * allocated a gapless invoice number and emailed a PDF. See migration 008.
   */
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

    -- Only the offers closed BY the fill. A genuine decline stays declined —
    -- somebody who said no is not asked again because the person who said yes
    -- dropped out.
    update shift_offers
    set responded_at = null, response = null, decline_reason = null
    where shift_id = v_shift.id and decline_reason = 'shift_filled';
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

-- ============================================================================
-- NOBODY BUT THE SERVICE ROLE MAY CALL THESE
-- ============================================================================
-- These are security definer: they run with the owner's rights and bypass RLS.
-- Their signatures also let the caller supply what should have been derived —
-- accept_shift takes both the freelancer id and the fee as parameters, and
-- settle_timesheet takes an amount. Granting execute to `authenticated` therefore
-- let any signed-in user accept work as someone else, or move credit, straight
-- through PostgREST with the public anon key.
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

-- ============================================================================
-- Resolving one email address to one account id
-- ============================================================================
-- Adding somebody to a pool is the one place a facility legitimately needs to
-- know whether an address has an account, before any relationship exists that
-- would let it read the profile.
--
-- This replaced a listUsers({ page: 1, perPage: 1000 }) scan, which could only
-- ever find the first 1000 accounts — and since that endpoint orders created_at
-- DESC, the ones it could not find were the longest-tenured, exactly the people a
-- facility already works with. They were told the account did not exist.
--
-- Returns an id and nothing else: no email, no metadata, nothing that would let a
-- caller enumerate the user table. Service role only, like the rest.
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
