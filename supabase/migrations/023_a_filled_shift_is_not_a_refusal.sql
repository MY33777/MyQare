-- 023 — an offer closed because somebody else was faster is not a refusal
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- accept_shift recorded a decline nobody made
-- ============================================================================
-- When one freelancer accepts, every other outstanding offer for that shift is
-- moot. accept_shift closed them with:
--
--     set responded_at = now(), response = 'decline', decline_reason = 'shift_filled'
--
-- So the platform wrote "geweigerd" against people who had not answered at all —
-- most of whom had not even opened the offer, because it was taken within
-- minutes. Both facility screens then rendered them under "Geweigerd", and the
-- freelancer's own offer page told her "Je hebt deze dienst geweigerd".
--
-- That is wrong as a fact, and it is wrong in a way this product cannot afford.
-- The whole legal position under the Wet DBA rests on refusal being real, free
-- and visible; a refusal RECORD that the person did not create is the exact
-- opposite of the evidence the dossier exists to provide. A coordinator scanning
-- "acht keer geweigerd" is also reading a pattern about somebody that never
-- happened.
--
-- 'expired' is a third state: offered, never answered, no longer available.

alter table shift_offers drop constraint if exists shift_offers_response_check;
alter table shift_offers add constraint shift_offers_response_check
  check (response in ('accept', 'decline', 'expired'));

comment on column shift_offers.response is
  'accept and decline are the freelancer''s own answers. expired is written by '
  'accept_shift when somebody else took the shift first — it is not a refusal '
  'and must never be shown as one.';

-- ============================================================================
-- Existing rows
-- ============================================================================
-- Every row already carrying decline_reason = 'shift_filled' is one of these:
-- the reason column has recorded the true cause since the beginning, while the
-- response column contradicted it. Nothing is lost by correcting them, and
-- leaving them would mean the screens keep reporting refusals that did not
-- happen for every shift filled so far.
update shift_offers
set response = 'expired'
where response = 'decline' and decline_reason = 'shift_filled';


-- ============================================================================
-- accept_shift, with the one line changed
-- ============================================================================
-- Generated from supabase/functions.sql rather than retyped. A previous
-- migration retyped this function from memory and silently flipped
-- substitution_allowed from false to true — a factual claim in the compliance
-- dossier — which is why supabase/sql.test.ts now compares the two byte for byte.

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

  /*
   * Everyone else's outstanding offer is now moot — but that is not a refusal.
   *
   * This wrote response = 'decline', so the platform recorded "geweigerd" against
   * people who had not answered and mostly had not even opened the offer. Both
   * facility screens showed them under Geweigerd and their own offer page said
   * "Je hebt deze dienst geweigerd". The Wet DBA position rests on refusal being
   * real and freely made; a refusal record the person did not create is the
   * opposite of what the dossier is for. See migration 023.
   *
   * decline_reason stays 'shift_filled' because cancel_assignment reopens exactly
   * these rows by matching on it.
   */
  update shift_offers
  set responded_at = now(), response = 'expired', decline_reason = 'shift_filled'
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
