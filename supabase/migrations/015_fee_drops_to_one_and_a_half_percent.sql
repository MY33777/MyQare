-- 015 — the platform fee drops to 1,5%
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into functions.sql too.
--
-- ============================================================================
-- The price changed
-- ============================================================================
-- PLATFORM_FEE_BP goes from 500 to 150: 1,5% of the assignment value excluding
-- VAT, so 1,815% once the 21% on the fee is added. A €400 day went from €24,20
-- to €7,26.
--
-- The amount itself is computed in lib/fees.ts and passed into accept_shift as a
-- parameter, so no arithmetic here changes. What does change is the note written
-- into credit_ledger, which said 'Bemiddelingsvergoeding 5% plus btw' — a literal
-- that would have been false on every row from now on, sitting in an append-only
-- table nobody can correct afterwards.
--
-- It no longer names a percentage at all. A ledger row records what was charged;
-- the rate that produced it belongs in the compliance snapshot, which already
-- carries fee_ex_vat_cents and fee_total_cents for that assignment.
--
-- Generated from functions.sql rather than retyped. An earlier migration in this
-- series was written from memory and silently flipped substitution_allowed from
-- false to true — a factual claim in the compliance dossier.

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

revoke all on function accept_shift(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
