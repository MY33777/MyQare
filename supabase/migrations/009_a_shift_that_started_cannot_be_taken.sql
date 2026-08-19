-- 009 — a shift that has already started cannot be accepted, and reopening one is not a reopen
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into functions.sql too.
--
-- Both of these are consequences of migration 008, found by the fourth audit.

-- ============================================================================
-- HIGH: accept_shift never checked that the shift was still in the future
-- ============================================================================
-- The comment in cancel_assignment claimed "accept_shift still refuses once the
-- shift itself has started". It does not. accept_shift checks status = 'open',
-- the offer, respond_by and the balance — and never once looks at starts_at.
--
-- respond_by carried that duty implicitly, since a facility normally sets one.
-- It is nullable, so the protection was never real; and migration 008 then made
-- it worse by CLEARING respond_by whenever it had lapsed, which is exactly the
-- case where the shift is about to start or already has.
--
-- The concrete failure: a freelancer no-shows a night shift. The next morning the
-- coordinator cancels the assignment. 008 sets the shift back to 'open', nulls the
-- lapsed respond_by, and un-declines everyone. The shift ended eight hours ago.
-- Another freelancer sees it in their offers, accepts, and is charged the platform
-- fee for work that cannot be performed. Their money, our bug.
--
-- Guarding on starts_at rather than ends_at: turning up halfway through a shift is
-- not a thing anyone wants to sell, and a facility that genuinely wants late cover
-- can post a new shift for the remaining hours at the rate it is willing to pay.

-- ============================================================================
-- HIGH: the balance check was not serialised per freelancer
-- ============================================================================
-- The `for update` on the shift row makes two people racing for ONE shift into a
-- queue. It does nothing about one person accepting two DIFFERENT shifts at the
-- same moment — different shift rows, so both transactions proceed, both read the
-- same balance, both pass, and both insert a fee. €25 of credit buys two €20
-- shifts and ends at −€15.
--
-- The ledger is append-only with no balance column, so no check constraint could
-- catch it. Locking the freelancer row is what makes "read the balance, then
-- spend it" a single decision.

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

revoke all on function accept_shift(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- HIGH: reopening a shift that has already started is not reopening it
-- ============================================================================
-- Migration 008 made cancel_assignment reopen the shift properly so a drop-out
-- could be replaced. That is right for a shift next Tuesday and wrong for one that
-- ended last night — which is the more common case, because most cancellations
-- after the fact are no-shows recorded once somebody notices.
--
-- accept_shift now refuses a started shift outright, so no money can move. But
-- leaving it 'open' still showed the facility a live shift and put a dead offer in
-- every freelancer's list, so the reopen now happens only while there is still
-- time to fill it.

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

revoke all on function cancel_assignment(uuid, text, text) from public, anon, authenticated;

-- ============================================================================
-- HIGH: dropping the UNIQUE constraint changed the shape of a PostgREST embed
-- ============================================================================
-- 008 replaced `assignments.shift_id uuid not null unique` with a partial unique
-- index, so a cancelled assignment would stop reserving its shift. Correct, and it
-- had a consequence nobody looked for: PostgREST decides one-to-one versus
-- one-to-many from the presence of a UNIQUE CONSTRAINT, and does not consider
-- partial indexes. So `shifts?select=...,assignments(...)` began returning an
-- ARRAY where the app expects an object.
--
-- app/zorginstelling/diensten/[id] types it as a nullable object and renders
-- `{assignment && assignment.status !== "cancelled" ? ...}`. An empty array is
-- truthy and its .status is undefined, so every shift — including one nobody has
-- accepted — started rendering a "Wie komt er" card reading "—".
--
-- Fixed in the page rather than by restoring the constraint: the constraint had to
-- go, and a caller that assumes a cardinality PostgREST infers from schema shape is
-- the thing that should be robust. Noted here because the next person to add an
-- embed of assignments will hit the same shape.
--
-- No DDL in this section. See app/zorginstelling/diensten/[id]/page.tsx.
