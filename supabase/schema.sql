-- MyQare — v1 schema
--
-- How to run: Supabase dashboard > SQL Editor > New query > paste this whole
-- file > Run. Safe to re-run (uses "if not exists" / "drop policy if exists").
--
-- ============================================================================
-- MONEY
-- ============================================================================
-- Every monetary amount in this schema is an integer number of **eurocents**.
-- No numeric, no float. Rates, fees, VAT and invoice totals all get summed and
-- compared, and binary floating point cannot represent 0.05 exactly — a 5% fee
-- on a few thousand assignments would silently drift away from the invoices we
-- already emailed. Cents as integers cannot drift.
--
-- ============================================================================
-- SECURITY
-- ============================================================================
-- Row Level Security is enabled on every table here and must stay that way. A
-- policy on a table whose RLS is *off* is silently inert: Postgres accepts it,
-- lists it in pg_policies, and never enforces it. So the table looks protected
-- while being fully readable by the anon role, whose key ships to the browser.
-- Enabling RLS and writing the policy are two separate steps and only the pair
-- does anything.
--
-- To audit which tables are actually locked rather than merely decorated:
--
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
--
-- ============================================================================
-- WHY THE HELPER FUNCTIONS ARE security definer
-- ============================================================================
-- Almost every policy needs to know "which organisation does the current user
-- belong to?", which means reading public.profiles. If that lookup runs as the
-- caller, then the policy on profiles has to query profiles, and Postgres
-- raises `infinite recursion detected in policy for relation "profiles"`.
-- Wrapping the lookup in a security definer function makes it run as the
-- function owner with RLS bypassed, which breaks the cycle. These functions are
-- deliberately tiny and parameterless so they cannot be abused as a general
-- read primitive.

create extension if not exists pgcrypto;

-- ============================================================================
-- ORGANISATIONS (care facilities)
-- ============================================================================

create table if not exists organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kvk text,
  -- Where invoices are sent. Deliberately separate from any user's login
  -- email: facilities route invoices to a shared crediteuren@ mailbox, not to
  -- the coordinator who happened to post the shift.
  billing_email text,
  address_line text,
  postcode text,
  city text,
  -- Set by an admin after checking the KvK extract. Until then the facility
  -- can look around but cannot post shifts.
  --
  -- Enforced in the server action ONLY. This used to say "and again by the shifts
  -- insert policy below"; migration 005 removed every write policy in the schema,
  -- so that second line of defence has not existed since. Saying it did is the
  -- exact pattern five audits kept finding — a protection asserted in a comment.
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- PROFILES
-- ============================================================================

create table if not exists profiles (
  -- Same id as auth.users, so a profile row is the app-level extension of the
  -- Supabase auth record rather than a separate identity to keep in sync.
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('facility_admin', 'freelancer', 'staff')),
  -- Null for freelancers; required for facility_admin. Not enforced as a
  -- constraint because the org is created in the same transaction as the first
  -- admin's profile and one of the two has to be written first.
  org_id uuid references organisations(id) on delete set null,
  full_name text not null default '',
  -- No phone column, deliberately. It lives in profile_contact below, because
  -- profiles_select returns the WHOLE ROW to any facility with this person in its
  -- pool and a row policy cannot pin columns. See migrations 004 and 006.
  created_at timestamptz not null default now(),
  /*
   * Set by anonymise_account(). The row is KEPT because invoices, assignments
   * and the compliance dossier reference it and must be retained; everything
   * that identifies the person has been removed. See migration 025.
   */
  anonymised_at timestamptz
);

create index if not exists profiles_org_idx on profiles(org_id);

/*
 * Phone lives in its own table, NOT on profiles — see migration 004.
 *
 * profiles_select grants the whole row to any facility with the person in its
 * pool, and a row policy cannot pin columns, so a phone number on profiles was
 * one PostgREST call away for anyone who had merely typed an email address into
 * a form. The UI rule "only once they have worked here" lived in JSX, which is
 * not access control.
 */
create table if not exists profile_contact (
  profile_id uuid primary key references profiles(id) on delete cascade,
  phone text,
  updated_at timestamptz not null default now()
);

/*
 * 'staff' is us — MyQare's own back office. It exists so document approval and
 * complaint handling have an actual account type instead of being done with the
 * service role key in a SQL console. Section 7.3 of the spec commits to strike
 * decisions being made by a human with a written reason; that needs a signed-in
 * human to attribute the decision to.
 */

create or replace function current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'staff' from profiles where id = auth.uid()), false);
$$;







-- ============================================================================
-- FREELANCERS
-- ============================================================================

create table if not exists freelancers (
  profile_id uuid primary key references profiles(id) on delete cascade,
  kvk text,
  -- BIG is the Dutch register of healthcare professionals. Storing the number
  -- is not the same as verifying it: big_verified_at is only set once someone
  -- has actually looked the number up in the register.
  big_number text,
  big_verified_at timestamptz,
  /*
   * When a human last LOOKED, whatever the answer.
   *
   * big_verified_at records only a successful check, so a number looked up and
   * not found had nowhere to be recorded: the review queue filters on
   * big_verified_at being null, the row never moved, and the same number came
   * back to be looked up again the next day. The one outcome the check exists to
   * detect was the one the product could not store. See migration 021.
   */
  big_checked_at timestamptz,
  -- Why a check failed, shown to the freelancer. Almost always a typo — eleven
  -- digits from memory — which nobody could tell them before this existed.
  big_check_note text,
  profession text not null default '',
  specialisations text[] not null default '{}',
  /*
    * The old free-text answer. Kept, no longer matched on.
    *
    * The comment here used to say a controlled list was "premature before we
    * know how facilities describe their catchment". What we learned instead is
    * that free text on both sides plus substring matching makes a short value a
    * wildcard: "a" matched almost every place name in the country and pulled in
    * every region-wide shift, each one a shift_offers row granting that facility
    * a standing read of this row.
    *
    * Retained rather than dropped because "omgeving Utrecht, liefst niet 's
    * nachts" is a real thing somebody typed, and it is the only record of what
    * they meant. Shown back to them on their profile so they can pick properly.
    */
   region text,
  /*
   * WHERE they will work, as codes from a fixed list (lib/regions.ts).
   *
   * An array because one commuting area rarely describes somebody: a nurse in
   * Schiedam works in both Groot-Rijnmond and Delft en Westland, and picking one
   * would be wrong either way. Empty means "no region-wide offers", which is the
   * safe default for a row that predates the list.
   */
  region_codes text[] not null default '{}',
  -- The floor they advertise. The *agreed* rate for a given assignment is
  -- stored on the assignment, because it is negotiated per shift and must
  -- remain whatever both parties actually agreed at the time, even if the
  -- freelancer later changes their asking rate.
  hourly_rate_min_cents integer check (hourly_rate_min_cents is null or hourly_rate_min_cents >= 0),
  bio text,
  /*
   * Whether this freelancer's work is exempt from VAT under the Dutch medical
   * exemption. Nullable on purpose: "not yet determined" is a real and common
   * state, and is different from "determined to be taxable". Never defaulted to
   * exempt — getting this wrong in the optimistic direction means under-charging
   * VAT on real invoices, which is the facility's problem and then ours.
   */
  vat_exempt boolean,
  vat_exempt_reason text,
  created_at timestamptz not null default now()
);

/*
 * A verification refers to one specific BIG number, so changing the number must
 * withdraw the verification.
 *
 * This was documented in a comment above the profile write and not implemented:
 * the stamp was cleared only when the field was EMPTIED, so editing it to a
 * different number kept the old timestamp. /beheer's queue lists freelancers with
 * a number and no stamp, so the altered number was filtered out of the only
 * screen that would have caught it, while every facility in that person's pool
 * kept showing a green "Geverifieerd" badge beside it.
 *
 * Enforced here as well as in the server action, because an invariant that
 * depends on every future writer remembering it is how the original defect
 * happened. See migration 008.
 */
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

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  -- No 'id': an opdrachtgever has no basis to retain a copy of a zelfstandige's
  -- passport, and the BSN on it may only be processed where a law prescribes it
  -- (art. 46 UAVG). See migration 007.
  kind text not null check (kind in ('vog', 'diploma', 'certificate', 'insurance', 'kvk_extract')),
  -- Path inside the private Storage bucket, not a public URL. Files are served
  -- through signed URLs generated per request so a leaked path expires.
  file_path text not null,
  original_filename text,
  issued_on date,
  -- Drives the expiry reminder job. A VOG that lapsed mid-assignment is the
  -- exact thing a Wkkgz audit asks about.
  expires_on date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists documents_freelancer_idx on documents(freelancer_id);
create index if not exists documents_expiry_idx on documents(expires_on) where expires_on is not null;

-- ============================================================================
-- POOLS — the facility's own list of people
-- ============================================================================

/*
 * This table is how the platform bootstraps without a marketplace (spec §7.1):
 * a facility arrives already working with a handful of freelancers, adds them
 * here, and gets scheduling/invoicing/compliance value on day one with no
 * network effects required.
 *
 * 'hidden' is the replacement for the shared blacklist the 2021 plan wanted
 * (spec §7.3). It is scoped to one organisation and invisible to everyone else,
 * including the freelancer's other clients. A facility choosing not to work
 * with someone is their prerogative; publishing that judgement to the market is
 * what needs a permit from the Autoriteit Persoonsgegevens, so we don't.
 */
create table if not exists pools (
  org_id uuid not null references organisations(id) on delete cascade,
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  status text not null default 'member' check (status in ('member', 'star', 'hidden')),
  note text,
  created_at timestamptz not null default now(),
  primary key (org_id, freelancer_id)
);

create index if not exists pools_freelancer_idx on pools(freelancer_id);

-- ============================================================================
-- SHIFTS AND OFFERS
-- ============================================================================

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  profession text not null,
  department text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- What the facility offers. The freelancer can accept it or not; there is no
  -- platform-set rate anywhere in this schema, by design (spec §7.2).
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  -- Unpaid break, subtracted when computing billable hours.
  break_minutes integer not null default 0 check (break_minutes >= 0),
  description text,
  visibility text not null default 'pool' check (visibility in ('pool', 'stars', 'region')),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled', 'expired')),
  -- After this moment the offer is stale and the UI stops accepting it. Kept
  -- explicit rather than derived from starts_at so an urgent same-day request
  -- can have a much shorter window than a shift three weeks out.
  respond_by timestamptz,
  created_at timestamptz not null default now(),
  constraint shifts_end_after_start check (ends_at > starts_at)
);

create index if not exists shifts_org_idx on shifts(org_id, starts_at desc);
create index if not exists shifts_open_idx on shifts(status, starts_at) where status = 'open';

create table if not exists shift_offers (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  notified_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  /*
   * accept and decline are the freelancer's OWN answers. expired is written by
   * accept_shift when somebody else took the shift first.
   *
   * That third state exists because the second was being used for it: everyone
   * else's outstanding offer was closed as 'decline', so the platform recorded a
   * refusal against people who had not answered — most of whom never opened the
   * offer, because it was gone within minutes. The whole Wet DBA position rests
   * on refusal being real and visible, and a refusal record the person did not
   * create is the opposite of the evidence the dossier exists to give. See
   * migration 023.
   */
  response text check (response in ('accept', 'decline', 'expired')),
  decline_reason text,
  created_at timestamptz not null default now(),
  unique (shift_id, freelancer_id)
);

create index if not exists shift_offers_freelancer_idx on shift_offers(freelancer_id, created_at desc);

-- ============================================================================
-- ASSIGNMENTS
-- ============================================================================

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  -- restrict, not cascade: deleting a shift must not erase an assignment, and
  -- through it an issued invoice and the compliance record. See migration 006.
  --
  -- Uniqueness is enforced by assignments_shift_id_active_idx below, not here.
  -- A plain UNIQUE meant a cancelled assignment kept reserving its shift forever,
  -- so the replacement freelancer's accept raised 23505 — which the UI could only
  -- report as "Er ging iets mis". See migration 008.
  shift_id uuid not null references shifts(id) on delete restrict,
  -- RESTRICT: an assignment is what an invoice and a compliance record hang off,
  -- so it is evidence in its own right. See migration 025.
  freelancer_id uuid not null references freelancers(profile_id) on delete restrict,
  -- RESTRICT for the same reason as freelancer_id above. Migration 025.
  org_id uuid not null references organisations(id) on delete restrict,
  -- Snapshotted from the shift at acceptance. If the facility later edits the
  -- shift, what was agreed does not move.
  agreed_rate_cents integer not null check (agreed_rate_cents > 0),
  agreed_break_minutes integer not null default 0,
  accepted_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('facility', 'freelancer', 'staff')),
  cancel_reason text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'completed', 'cancelled', 'disputed')),
  created_at timestamptz not null default now()
);

-- Exactly one LIVE assignment per shift. Cancelled rows drop out so the shift can
-- be filled again; see migration 008 and cancel_assignment in functions.sql.
create unique index if not exists assignments_shift_id_active_idx
  on assignments (shift_id)
  where status <> 'cancelled';

create index if not exists assignments_freelancer_idx on assignments(freelancer_id, accepted_at desc);
create index if not exists assignments_org_idx on assignments(org_id, accepted_at desc);

create table if not exists timesheets (
  assignment_id uuid primary key references assignments(id) on delete cascade,
  -- Minutes, not hours: a shift that ran 7h45 is exact in minutes and a
  -- recurring decimal in hours.
  minutes_claimed integer not null check (minutes_claimed >= 0),
  break_minutes integer not null default 0 check (break_minutes >= 0),
  note text,
  claimed_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references profiles(id) on delete set null,
  disputed_at timestamptz,
  dispute_reason text
);

-- ============================================================================
-- INVOICES
-- ============================================================================

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  -- restrict: an issued invoice is a financial record and outlives its assignment.
  assignment_id uuid not null unique references assignments(id) on delete restrict,
  -- Human-facing sequential number, unique per freelancer per year. The Dutch
  -- tax authority expects an unbroken series per invoicing party, and the
  -- invoicing party here is the freelancer, not MyQare — we generate the
  -- document on their behalf.
  number text not null,
  /*
   * RESTRICT, not cascade.
   *
   * This was cascade, so deleting the auth user removed seven years of invoices
   * with it — art. 52 AWR requires them retained, and three comments in this
   * codebase claimed this constraint already said restrict when it did not. See
   * migration 025. Removing somebody now goes through anonymise_account().
   */
  freelancer_id uuid not null references freelancers(profile_id) on delete restrict,
  -- RESTRICT for the same reason as freelancer_id above. Migration 025.
  org_id uuid not null references organisations(id) on delete restrict,
  issued_on date not null default current_date,
  due_on date not null,
  minutes_billed integer not null,
  rate_cents integer not null,
  amount_ex_vat_cents integer not null,
  vat_rate_bp integer not null default 0, -- basis points: 2100 = 21%
  vat_amount_cents integer not null default 0,
  total_cents integer not null,
  -- Why VAT was or wasn't charged, captured at issue time. An invoice must be
  -- able to explain itself years later without depending on the freelancer's
  -- current profile settings.
  vat_treatment text not null check (vat_treatment in ('exempt_medical', 'standard_21', 'undetermined')),
  vat_note text,
  pdf_path text,
  sent_at timestamptz,
  paid_at timestamptz,
  reminders_sent integer not null default 0,
  created_at timestamptz not null default now(),
  unique (freelancer_id, number)
);

create index if not exists invoices_org_idx on invoices(org_id, issued_on desc);
create index if not exists invoices_unpaid_idx on invoices(due_on) where paid_at is null;

-- ============================================================================
-- CREDITS — append-only ledger
-- ============================================================================

/*
 * There is no credits_balance column anywhere. A balance is the sum of this
 * table, always.
 *
 * The reason is that this is the only place customer money exists in the
 * product, and a mutable balance column has no history: if a fee is charged
 * twice, or a refund is applied to the wrong account, a single integer tells
 * you nothing about how it got that way. An append-only ledger makes every
 * movement attributable and every dispute answerable, and makes double-charge
 * bugs visible as two rows rather than invisible as one wrong number.
 *
 * Consequences, enforced below: no update policy, no delete policy, and no
 * insert policy for ordinary users. Rows are written only with the service role
 * key from server code (lib/credits.ts), which bypasses RLS. A user can read
 * their own ledger and nothing else.
 */
/*
 * The freelancer's own invoicing setup.
 *
 * MyQare writes the invoice, but the invoicing party is the freelancer — art. 35a
 * Wet OB puts the supplier's name, address and (where VAT is charged) btw-id on
 * the document, and the supplier is them. Without these fields we were issuing
 * something that is not a valid invoice.
 *
 * Also theirs to control: somebody who already runs a numbering series in their
 * own bookkeeping cannot have a second, conflicting one appearing under their
 * name, and plenty of people want to see an invoice before it reaches a client
 * they have to keep working with. See migration 010.
 */
create table if not exists invoice_settings (
  profile_id uuid primary key references freelancers(profile_id) on delete cascade,

  -- Off means the invoice is still created and numbered — allocation happens in
  -- approval order regardless, because a series with gaps is worse than one sent
  -- a day late — but waits for the freelancer to release it.
  auto_send boolean not null default true,

  number_prefix text check (number_prefix is null or number_prefix ~ '^[A-Za-z0-9-]{1,8}$'),
  -- Where a series begins in a year with nothing issued yet. Never lowers an
  -- existing sequence; see lib/invoiceNumber.ts.
  number_start integer not null default 1 check (number_start >= 1),

  -- 30, matching lib/invoiceNumber.ts. A column default of 14 here was a second
  -- number for one rule, and it silently halved every invoice's term. See
  -- migration 013.
  payment_term_days integer not null default 30
    check (payment_term_days between 0 and 120),

  iban text,
  account_holder text,

  business_name text,
  address_line text,
  postcode text,
  city text,
  -- Nullable: somebody invoicing under the medical exemption of art. 11-1-g has
  -- no VAT to identify. Required at issue time only when VAT is actually charged.
  vat_number text,

  payment_note text check (payment_note is null or length(payment_note) <= 500),
  copy_to_self boolean not null default true,

  updated_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: the ledger is append-only precisely so the money trail cannot be
  -- rewritten, and deleting it with the profile is rewriting it. Migration 025.
  profile_id uuid not null references profiles(id) on delete restrict,
  -- Positive for top-ups and refunds, negative for fees.
  delta_cents integer not null,
  -- 'chargeback' is a reversal: a refund or a disputed payment pulled back by the
  -- bank. Its own reason rather than a negative 'topup', because it has to be
  -- visible as what it is and countable separately. See migration 011.
  reason text not null check (reason in ('topup', 'fee', 'fee_refund', 'fee_adjustment', 'manual', 'chargeback')),
  assignment_id uuid references assignments(id) on delete set null,
  -- Stripe's id for the payment that created a topup. Unique so a webhook
  -- delivered twice — which Stripe explicitly warns will happen — cannot credit
  -- the same payment twice.
  stripe_payment_intent text unique,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_profile_idx on credit_ledger(profile_id, created_at desc);
create index if not exists credit_ledger_assignment_idx on credit_ledger(assignment_id);

/*
 * Balance as a function rather than a view so it can be called per profile from
 * a policy or a server action without scanning the whole table.
 */
create or replace function credit_balance_cents(p_profile_id uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta_cents), 0)::integer
  from credit_ledger
  where profile_id = p_profile_id;
$$;

-- ============================================================================
-- RATINGS
-- ============================================================================

/*
 * Two things the 2021 plan got wrong, both flagged by its reviewer and fixed
 * here (spec §7.4):
 *
 * 1. An average over fewer than ~20 ratings is noise. The shrinkage toward the
 *    6.0 baseline lives in lib/ratings.ts, and `score` here is always the raw
 *    number — never pre-averaged, so the display rule can change later without
 *    the stored data being wrong.
 *
 * 2. A coordinator annoyed about cost is not qualified to score clinical
 *    performance. So `dimensions` covers collegiality, communication and
 *    punctuality only. There is deliberately no clinical-quality field: that
 *    needs a qualified assessor, and inventing one is out of scope for v1.
 */
create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  direction text not null check (direction in ('facility_to_freelancer', 'freelancer_to_facility')),
  /*
   * NULLABLE, and set null on delete.
   *
   * This was "not null ... on delete cascade", so a freelancer leaving silently
   * deleted every rating they had written and changed the score shown for
   * facilities they worked with, months later, for a reason nobody could see.
   * The rating is about the OTHER party; the author is metadata. See 025.
   */
  author_id uuid references profiles(id) on delete set null,
  score integer not null check (score between 0 and 10),
  dimensions jsonb not null default '{}'::jsonb,
  comment text,
  created_at timestamptz not null default now(),
  unique (assignment_id, direction)
);

create index if not exists ratings_assignment_idx on ratings(assignment_id);

-- ============================================================================
-- COMPLIANCE RECORDS — the actual product
-- ============================================================================

/*
 * One row per assignment, written at acceptance and never edited. This is what
 * a facility exports and hands to the Belastingdienst.
 *
 * Since January 2025 the tax authority enforces schijnzelfstandigheid rules
 * again, and for 2026 it has said it is specifically examining three-way
 * relationships between freelancer, client and intermediary — which is exactly
 * this platform's shape. The defence is evidence that the freelancer was free:
 * free to decline, free to negotiate the rate, not exclusive, not directed.
 *
 * `snapshot` holds the full state of both parties and the shift at the moment
 * of acceptance, as JSON. Denormalised on purpose: a dossier that reassembles
 * itself from live tables would silently change its own history when a
 * freelancer edits their profile two years later.
 */
create table if not exists compliance_records (
  -- restrict: this is the evidence the product exists to produce, and it must
  -- survive precisely when somebody would rather it did not.
  assignment_id uuid primary key references assignments(id) on delete restrict,
  model_agreement_version text not null,
  offered_at timestamptz not null,
  accepted_at timestamptz not null,
  -- Always true in v1, and recorded rather than assumed: auto-accept was cut
  -- precisely because a freelancer who cannot refuse looks like an employee.
  -- If a future version ever adds it back, these rows will show which
  -- assignments were affected.
  could_decline boolean not null default true,
  substitution_allowed boolean not null default false,
  rate_set_by text not null check (rate_set_by in ('facility_offer_accepted', 'negotiated', 'freelancer_quote')),
  declined_other_offers integer not null default 0,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- RATE LIMITING
-- ============================================================================

create table if not exists rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  created_at timestamptz not null default now()
);

-- Read only by the region fan-out. GIN because the question is "does this
-- freelancer's array contain the shift's code".
create index if not exists freelancers_region_codes_idx on freelancers using gin (region_codes);

create index if not exists rate_limit_hits_bucket_idx on rate_limit_hits(bucket, created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table organisations enable row level security;
alter table profiles enable row level security;
alter table freelancers enable row level security;
alter table documents enable row level security;
alter table pools enable row level security;
alter table shifts enable row level security;
alter table shift_offers enable row level security;
alter table assignments enable row level security;
alter table timesheets enable row level security;
alter table invoices enable row level security;
alter table invoice_settings enable row level security;
alter table credit_ledger enable row level security;
alter table ratings enable row level security;
alter table compliance_records enable row level security;
alter table rate_limit_hits enable row level security;

-- ---------- organisations ----------

/*
 * DEFINED HERE, AFTER THE TABLES THEY READ.
 *
 * `create function ... language sql` validates its body at creation time
 * (check_function_bodies is on by default), so a helper that reads shift_offers
 * cannot be declared before shift_offers exists. These three sat with the other
 * definer helpers near the top of the file, where profiles happens to already
 * exist — and a fresh install died on the first of them with 42P01, taking the
 * whole script with it because the SQL editor runs a paste as one transaction.
 *
 * npm run check:sql did not catch it: that parses grammar, and this is an
 * ordering fault. supabase/sql.test.ts now checks it directly.
 */

/*
 * Does the current user hold an offer for this shift?
 *
 * Replaces the subquery inside shifts_select. Runs as owner, so reading
 * shift_offers here does not re-enter shift_offers_select.
 */
create or replace function has_offer_for_shift(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from shift_offers
    where shift_id = p_shift_id and freelancer_id = auth.uid()
  );
$$;

/*
 * Which organisation owns this shift?
 *
 * Replaces the subquery inside shift_offers_select. Returns an organisation id
 * for a shift id and nothing else — the caller already has to know the shift id,
 * and shift ids are uuids.
 */
create or replace function shift_org(p_shift_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from shifts where id = p_shift_id;
$$;

/*
 * Is the caller's organisation verified?
 *
 * Definer, parameterless and about the caller only, like is_staff(). Declared
 * here, after organisations exists — a `language sql` body is validated at
 * creation time, which is how a fresh install broke twice.
 */
create or replace function current_org_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.verified_at is not null
     from organisations o
     where o.id = (select p.org_id from profiles p where p.id = auth.uid())),
    false
  );
$$;

drop policy if exists organisations_select on organisations;
create policy organisations_select on organisations for select
  using (
    id = current_org_id()
    or is_staff()
    -- A freelancer must be able to see the name of a facility that is offering
    -- them work, and of one they have worked for. Limited to those two
    -- relationships rather than the whole directory.
    or exists (
      select 1 from shifts s
      join shift_offers o on o.shift_id = s.id
      where s.org_id = organisations.id and o.freelancer_id = auth.uid()
    )
    or exists (
      select 1 from assignments a
      where a.org_id = organisations.id and a.freelancer_id = auth.uid()
    )
  );

drop policy if exists organisations_update on organisations;

-- ---------- profiles ----------

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or is_staff()
    -- Colleagues at the same facility.
    or (org_id is not null and org_id = current_org_id())
    -- A facility may read the profile of a freelancer in its pool or working
    -- for it. Not the reverse-engineered whole user table.
    or exists (
      select 1 from pools p
      where p.freelancer_id = profiles.id and p.org_id = current_org_id()
    )
    or exists (
      select 1 from assignments a
      where a.freelancer_id = profiles.id and a.org_id = current_org_id()
    )
  );

alter table profile_contact enable row level security;

drop policy if exists profile_contact_select on profile_contact;
create policy profile_contact_select on profile_contact for select
  using (
    profile_id = auth.uid()
    or is_staff()
    -- An actual working relationship, not merely a pool entry.
    or exists (
      select 1 from assignments a
      where a.freelancer_id = profile_contact.profile_id
        and a.org_id = current_org_id()
        and a.status <> 'cancelled'
    )
    or exists (
      select 1 from profiles p
      where p.id = profile_contact.profile_id
        and p.org_id is not null
        and p.org_id = current_org_id()
    )
  );

drop policy if exists profile_contact_write on profile_contact;

drop policy if exists profiles_insert on profiles;

drop policy if exists profiles_update on profiles;

-- ---------- freelancers ----------

drop policy if exists freelancers_select on freelancers;
create policy freelancers_select on freelancers for select
  using (
    profile_id = auth.uid()
    or is_staff()
    or (
      current_org_verified()
      and exists (
        select 1 from pools p
        where p.freelancer_id = freelancers.profile_id and p.org_id = current_org_id()
      )
    )
    -- An assignment can only exist if the organisation was verified when the
    -- shift was posted, so this needs no extra gate — and withdrawing a
    -- verification afterwards must not erase the record of who worked there.
    or exists (
      select 1 from assignments a
      where a.freelancer_id = freelancers.profile_id and a.org_id = current_org_id()
    )
  );

drop policy if exists freelancers_write on freelancers;

-- ---------- documents ----------

/*
 * Diplomas, VOGs and ID documents. The facility genuinely needs to confirm
 * someone is qualified — Wkkgz obliges them to check — but only for people they
 * actually engage, and only for approved documents. A pending or rejected
 * upload is between the freelancer and our back office.
 */
drop policy if exists documents_select on documents;
create policy documents_select on documents for select
  using (
    freelancer_id = auth.uid()
    or is_staff()
    or (
      status = 'approved'
      and (
        exists (
          select 1 from assignments a
          where a.freelancer_id = documents.freelancer_id
            and a.org_id = current_org_id()
            -- Cancelled work creates no duty to have checked anything.
            and a.status <> 'cancelled'
        )
        or (
          current_org_verified()
          and exists (
            select 1 from pools p
            where p.freelancer_id = documents.freelancer_id
              and p.org_id = current_org_id()
              and p.status <> 'hidden'
          )
        )
      )
    )
  );

drop policy if exists documents_write on documents;

-- ---------- pools ----------

drop policy if exists pools_select on pools;
create policy pools_select on pools for select
  using (
    org_id = current_org_id()
    or is_staff()
    -- A freelancer may see that they are in a facility's pool, but the 'hidden'
    -- status is not theirs to read: telling someone they have been quietly
    -- deprioritised turns a private staffing preference into a confrontation,
    -- and there is no obligation to publish it.
    or (freelancer_id = auth.uid() and status <> 'hidden')
  );

drop policy if exists pools_write on pools;

-- ---------- shifts ----------

drop policy if exists shifts_select on shifts;
create policy shifts_select on shifts for select
  using (
    org_id = current_org_id()
    or is_staff()
    -- A definer helper, NOT a subquery: shift_offers_select reads shifts, so an
    -- inline exists() here made the two policies expand each other and Postgres
    -- raise 42P17 on every authenticated read of either table. See migration 016.
    or has_offer_for_shift(shifts.id)
  );

drop policy if exists shifts_insert on shifts;

drop policy if exists shifts_update on shifts;

drop policy if exists shifts_delete on shifts;

-- ---------- shift_offers ----------

drop policy if exists shift_offers_select on shift_offers;
create policy shift_offers_select on shift_offers for select
  using (
    freelancer_id = auth.uid()
    or is_staff()
    -- The other half of the same cycle. See migration 016.
    or shift_org(shift_offers.shift_id) = current_org_id()
  );

/*
 * A freelancer responds to their own offer and nothing else. Accepting is not
 * an insert here — it goes through a server action that has to create the
 * assignment, charge the fee and write the compliance record atomically, so the
 * update policy exists for the decline path and for marking an offer viewed.
 */
drop policy if exists shift_offers_update on shift_offers;

drop policy if exists shift_offers_insert on shift_offers;

-- ---------- assignments ----------

drop policy if exists assignments_select on assignments;
create policy assignments_select on assignments for select
  using (freelancer_id = auth.uid() or org_id = current_org_id() or is_staff());

/*
 * No update policy, deliberately — see migration 003.
 *
 * agreed_rate_cents is an immutable snapshot and the column invoices bill from,
 * but a row policy cannot pin columns: granting UPDATE for "my own assignment"
 * also granted "rewrite the agreed rate after the work". Either party could
 * inflate or deflate the invoice from an ordinary session, and a direct PATCH to
 * status='cancelled' bypassed cancel_assignment so the fee was never refunded.
 *
 * Every write goes through the service role or a definer function instead.
 */
drop policy if exists assignments_update on assignments;

-- Inserts happen only via the service role in the accept action, which also
-- writes the fee and the compliance record. No user-facing insert policy.

-- ---------- timesheets ----------

drop policy if exists timesheets_select on timesheets;
create policy timesheets_select on timesheets for select
  using (
    is_staff()
    or exists (
      select 1 from assignments a
      where a.id = timesheets.assignment_id
        and (a.freelancer_id = auth.uid() or a.org_id = current_org_id())
    )
  );

drop policy if exists timesheets_write on timesheets;

-- ---------- invoices ----------

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select
  using (freelancer_id = auth.uid() or org_id = current_org_id() or is_staff());

/*
 * No update policy either. It existed so a facility could mark an invoice paid,
 * but row-wide UPDATE also let the debtor rewrite total_cents and the number on a
 * document issued in the FREELANCER's name — the one party unable to see it had
 * been altered. markInvoicePaidAction uses the service role and checks ownership
 * itself.
 */
drop policy if exists invoices_update on invoices;

-- Issued by server code only: the number has to be allocated without a gap.

-- ---------- credit_ledger ----------

/*
 * Read your own rows. That is the entire user-facing surface.
 *
 * Deliberately absent: insert, update and delete policies. Postgres denies any
 * operation with no matching policy, so this table is append-only from the
 * client's point of view and writable only with the service role key. See the
 * comment on the table above for why that matters.
 */
drop policy if exists credit_ledger_select on credit_ledger;
create policy credit_ledger_select on credit_ledger for select
  using (profile_id = auth.uid() or is_staff());

-- ---------- ratings ----------

/*
 * The score shown on a profile, already shrunk toward the mean.
 *
 * Definer, so it can read rows the caller may not. It returns two numbers and no
 * identity: never a row, never an author, never which assignment produced which
 * mark. Below the threshold it returns the count and a null average rather than
 * a figure computed from two opinions.
 *
 * The shrinkage matches lib/ratings.ts. Two implementations of one rule is what
 * this codebase keeps getting wrong, so if either changes the other must — the
 * constants are named here for exactly that reason.
 */
create or replace function rating_summary(
  p_freelancer_id uuid,
  p_direction text default 'facility_to_freelancer'
)
returns table (rating_count integer, shrunk_score numeric)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    -- Newest RATING_WINDOW only, matching lib/ratings.ts. An average over
    -- everything somebody ever did buries a change in how they work.
    select r.score
    from ratings r
    join assignments a on a.id = r.assignment_id
    where a.freelancer_id = p_freelancer_id
      and r.direction = p_direction
    order by r.created_at desc
    limit 20
  ),
  agg as (select count(*)::integer as n, coalesce(sum(score), 0)::numeric as total from recent)
  select
    n,
    case
      -- PROVISIONAL_BELOW. Fewer than five opinions is noise, and one irritated
      -- coordinator must not brand a newcomer. Null rather than a number nobody
      -- should act on — and, here, than a number the freelancer could invert.
      when n < 5 then null
      -- BASELINE_SCORE 6.0, PRIOR_WEIGHT 5. Mirrors summariseRatings exactly;
      -- lib/ratings.test.ts runs this function and compares the two.
      else round((total + (6.0 * 5)) / (n + 5), 1)
    end
  from agg;
$$;

-- Callable by any signed-in user: it answers a question about somebody's public
-- standing and returns no identifying detail. Not granted to anon — an unsigned
-- visitor has no business enumerating scores.
revoke all on function rating_summary(uuid, text) from public, anon;
grant execute on function rating_summary(uuid, text) to authenticated;

drop policy if exists ratings_select on ratings;
create policy ratings_select on ratings for select
  using (author_id = auth.uid() or is_staff());

drop policy if exists ratings_insert on ratings;

/*
 * No update or delete policy. A rating is a statement someone made about
 * another person's work; being able to quietly rewrite it later would make the
 * whole history untrustworthy, and it is the basis on which work gets offered.
 * Corrections go through staff.
 */

-- ---------- compliance_records ----------

drop policy if exists compliance_records_select on compliance_records;
create policy compliance_records_select on compliance_records for select
  using (
    is_staff()
    or exists (
      select 1 from assignments a
      where a.id = compliance_records.assignment_id
        and (a.freelancer_id = auth.uid() or a.org_id = current_org_id())
    )
  );

-- Written once by the accept action via the service role. No user-facing
-- insert/update/delete: a dossier nobody can edit after the fact is the only
-- kind worth showing an inspector.

-- ---------- rate_limit_hits ----------

-- Service role only. No policies at all, so RLS denies every client operation.

-- ============================================================================
-- STORAGE
-- ============================================================================
--
-- Create a PRIVATE bucket named `documents` in the Supabase dashboard
-- (Storage > New bucket > uncheck "Public bucket"). Files are read through
-- short-lived signed URLs minted server-side after the RLS check above has
-- already decided the caller is entitled to the row.
--
-- Do not make this bucket public. It holds VOGs, diplomas and identity
-- documents; a public bucket means a guessable path is a full disclosure.

-- ============================================================================
-- AVAILABILITY (added after the first cut)
-- ============================================================================
--
-- Opt-OUT, not opt-in. A freelancer blocks the days they cannot work; everything
-- else is treated as "might be available".
--
-- The reverse — requiring people to mark themselves available — looks tidier and
-- fails badly: anyone who forgets to maintain a calendar silently vanishes from
-- every offer, and the first they know about it is that work stopped arriving.
-- Under-offering is invisible to both sides, which makes it the worse error.

create table if not exists availability_blocks (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  -- Inclusive on both ends: a single blocked day has starts_on = ends_on, which
  -- is what someone entering "24 December" means.
  starts_on date not null,
  ends_on date not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint availability_ends_after_start check (ends_on >= starts_on)
);

create index if not exists availability_freelancer_idx
  on availability_blocks(freelancer_id, starts_on);

alter table availability_blocks enable row level security;

drop policy if exists availability_select on availability_blocks;
create policy availability_select on availability_blocks for select
  using (freelancer_id = auth.uid() or is_staff());

drop policy if exists availability_write on availability_blocks;

/*
 * Deliberately NOT readable by facilities. A facility does not need to know why
 * someone is unavailable, or that they are unavailable at all — it only needs the
 * shift to reach people who can take it, which the fan-out handles server-side.
 * Exposing the calendar would turn "I am away that week" into something an
 * employer can see and draw conclusions from.
 */

-- Region a shift is being offered into. Defaults from the organisation's city at
-- posting time, but editable, because a facility on a boundary recruits from both
-- sides of it.
alter table shifts add column if not exists region text;

-- The same shift region as a code from the fixed list. Only consulted for
-- visibility 'region' — the one setting that reaches freelancers this facility
-- has never worked with. See migration 022 and lib/regions.ts.
alter table shifts add column if not exists region_code text;

-- Indexed HERE rather than beside the other shift indexes further up: the column
-- is added by this statement, and an index declared above it would be created
-- before the column exists. Same ordering trap as migration 016's helpers.
create index if not exists shifts_region_code_idx on shifts(region_code);

drop policy if exists invoice_settings_select on invoice_settings;
create policy invoice_settings_select on invoice_settings for select
  using (profile_id = auth.uid() or is_staff());

/*
 * The rating written ABOUT you is not yours to read.
 *
 * ratings_select grants either party the rows for their assignment, and every
 * query in the app selects only `score`. But RLS grants ROWS, not columns, and
 * PostgREST returns whatever is asked for — so select=comment,author_id handed a
 * freelancer exactly what a coordinator wrote about them and who wrote it, while
 * the rating form promised the opposite.
 *
 * Same shape as the five defects migration 005 dealt with. The instrument for a
 * column is a column grant, which composes with RLS rather than replacing it.
 *
 * Note the ORDER. A bare `revoke select (comment, author_id)` — which is what
 * migration 010 shipped — does nothing: Supabase grants SELECT on the whole table
 * to anon and authenticated, that covers every column, and a column-level revoke
 * only removes a column-level grant. The table-wide privilege has to go first.
 * See migration 012.
 *
 * Scores stay readable because both dashboards average them, and an average over
 * a run of assignments identifies nobody.
 */
revoke select on ratings from authenticated, anon;
grant select (id, assignment_id, direction, score, dimensions, created_at)
  on ratings to authenticated, anon;

/*
 * What an admin may do. profiles.role = 'staff' answers "is this an admin at
 * all" and gates seventeen RLS read policies through is_staff(); this answers
 * which admin may do which thing. See migration 014, which also carries the SQL
 * for creating the first admin — that one cannot be made through the panel.
 */
create table if not exists staff_permissions (
  profile_id uuid not null references profiles(id) on delete cascade,

  /*
   * Deliberately a small, closed set that maps one-to-one onto actions that
   * exist. A capability gating nothing is the "protection asserted in a comment"
   * pattern this codebase has been bitten by five times — it reads as a control
   * and enforces nothing.
   *
   *   verify_organisations  approve or withdraw a facility's ability to post work
   *   verify_big            record that a BIG number was checked against the register
   *   review_documents      read and approve/reject VOG, diplomas, insurance, KvK
   *   manage_admins         appoint admins and set what they may do
   */
  capability text not null check (capability in (
    'verify_organisations',
    'verify_big',
    'review_documents',
    -- cancel_assignments  unwind a booked assignment on either party's behalf,
    --                     which refunds the platform fee and reopens the shift.
    --                     Its own capability because approving a diploma implies
    --                     nothing about undoing somebody's booked work. See 020.
    'cancel_assignments',
    -- anonymise_accounts  irreversibly remove a person on request: documents and
    --                     contact details deleted, invoices and dossier kept as
    --                     the law requires. Its own capability because approving
    --                     a diploma implies nothing about this. See 025.
    'anonymise_accounts',
    'manage_admins'
  )),

  -- Who granted it. Kept even if that person is later removed, which is why it
  -- is `set null` rather than cascade: losing the grantee should not quietly
  -- rewrite the history of who handed out the rights.
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),

  primary key (profile_id, capability)
);

create index if not exists staff_permissions_profile_idx on staff_permissions(profile_id);

/*
 * Can the current user appoint admins?
 *
 * Parameterless, like is_staff(), and for the same reason: it answers a question
 * about the caller and cannot be pointed at anybody else.
 */
create or replace function can_manage_admins()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_permissions
    where profile_id = auth.uid() and capability = 'manage_admins'
  );
$$;

alter table staff_permissions enable row level security;

/*
 * An admin sees their own capabilities — the panel needs to know what to render —
 * and anyone holding manage_admins sees everybody's, because that is the screen
 * they work from.
 */
drop policy if exists staff_permissions_select on staff_permissions;
create policy staff_permissions_select on staff_permissions for select
  -- Reading staff_permissions inside staff_permissions' own policy is the exact
  -- case this file's header warns about. See migration 016.
  using (profile_id = auth.uid() or can_manage_admins());

revoke insert, update, delete on staff_permissions from authenticated, anon;

-- ============================================================================
-- Every change to who can do what, recorded
-- ============================================================================
-- This product's whole argument is that a decision is worth more when you can
-- show what was true at the moment it was made. Admin rights are the one thing
-- that lets somebody change every other record, so a grant that leaves no trace
-- is the gap that makes the rest arguable.
--
-- Append-only in the same sense as credit_ledger: no update, no delete, and the
-- rows outlive the accounts they refer to.

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),

  -- `set null` on both: an entry saying "somebody, since deleted, granted
  -- manage_admins to somebody else, since deleted" is still worth having.
  actor_id uuid references profiles(id) on delete set null,
  subject_id uuid references profiles(id) on delete set null,

  -- Names captured at the time, so the log stays readable after an account is
  -- anonymised or removed. Same reason the compliance dossier snapshots.
  actor_name text,
  subject_name text,

  action text not null check (action in (
    'admin_appointed',
    'admin_removed',
    'capability_granted',
    'capability_revoked',
    -- Not a permission change. It is here because it is the one act an admin can
    -- take that moves money between accounts, and it has to be attributable to a
    -- person afterwards. See migration 020.
    'assignment_cancelled',
    -- The second irreversible act an admin can take against somebody else's
    -- account. Who ran it has to be answerable afterwards. See migration 025.
    'account_anonymised'
  )),
  capability text,
  note text,

  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log(created_at desc);

alter table admin_audit_log enable row level security;

-- Readable only by someone who can manage admins. It names people and what they
-- were trusted with.
drop policy if exists admin_audit_log_select on admin_audit_log;
create policy admin_audit_log_select on admin_audit_log for select
  -- Inherited the recursion above through staff_permissions. See migration 016.
  using (can_manage_admins());

revoke insert, update, delete on admin_audit_log from authenticated, anon;


-- ============================================================================
-- ORGANISATION INVITES
-- ============================================================================
-- A facility is ONE organisation, and a second coordinator joins it rather than
-- founding a duplicate. Onboarding used to insert a fresh organisations row for
-- every facility_admin, so the colleague who takes the roster on Thursdays ended
-- up running a separate product: separate pool, separate shifts, two invoice
-- series against one supplier, and a compliance dossier split in half. See
-- migration 024.
--
-- Joining by KvK alone would be the wrong control — KvK numbers are public, so
-- anyone typing a hospital's number would land inside its pool and its
-- freelancers' documents. Somebody already inside has to invite you.

create table if not exists organisation_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,

  -- Lower-cased on write. Whoever signs in with this address claims the invite,
  -- so it is the whole of the identity check.
  email text not null,

  -- Kept even if that person later leaves: "who let them in" is the question
  -- asked afterwards, and a null answer is not an answer.
  invited_by uuid references profiles(id) on delete set null,
  invited_by_name text,

  created_at timestamptz not null default now(),
  accepted_at timestamptz,

  -- One open invite per address per organisation, so a second send updates
  -- rather than leaving a forgotten duplicate behind a revoke.
  unique (org_id, email)
);

create index if not exists organisation_invites_email_idx on organisation_invites(lower(email));

alter table organisation_invites enable row level security;

/*
 * Readable by the organisation it belongs to, so a coordinator can see who has
 * been invited and not yet joined. NOT readable by the invitee before they join:
 * they have no profile scoped to this org, and "this address was invited
 * somewhere" is itself worth not publishing. They learn about it from the email
 * and from onboarding, both of which run with the service role.
 */
drop policy if exists organisation_invites_select on organisation_invites;
create policy organisation_invites_select on organisation_invites for select
  using (org_id = current_org_id() or is_staff());

revoke insert, update, delete on organisation_invites from authenticated, anon;

-- ============================================================================
-- NO CLIENT WRITES AT ALL (migration 005)
-- ============================================================================
-- Every write policy that used to live in this file has been removed, and the
-- write grants are revoked below.
--
-- The reason is that a Postgres ROW policy cannot restrict COLUMNS. "You may
-- update your own row" therefore also means "you may rewrite any column in it",
-- and that single fact produced five separate defects across two audits:
--
--   assignments.agreed_rate_cents  either party could change the billed rate
--                                    after the work
--   invoices.total_cents           the debtor could rewrite the creditor's bill
--   profiles.phone                 handed to any facility with a pool entry
--   timesheets.approved_at         blanking it re-armed double settlement AND
--                                    re-opened a full fee refund on invoiced work
--   profiles.role                  PATCH yourself to 'staff' and read every
--                                    document, phone number, invoice and ledger
--                                    row on the platform
--
-- In each case the written defence was a comment saying the UI never posts that
-- column. The anon key ships to the browser and PostgREST accepts whatever it is
-- sent, so that was never a control.
--
-- Removing them all costs nothing, because the application contains no
-- client-side writes: all 21 files that write to Postgres use the service role,
-- which these policies never governed.
--
-- WHAT THIS MEANS FOR THE SECURITY MODEL
-- --------------------------------------
-- RLS is a READ backstop here, not a write one. Write authorization lives
-- entirely in lib/auth.ts and the server actions; if one of those forgets its
-- ownership check, nothing else catches it. Comments in this codebase have
-- described RLS as "the backstop that holds even when app code is wrong" — true
-- for reads, false for writes, and overstating it is how several of the defects
-- above survived review.
--
-- If a client-side write is ever genuinely needed: supabase-js reports SUCCESS
-- with zero rows when RLS blocks an update, so it will fail silently. Add the
-- policy AND a BEFORE UPDATE trigger pinning the immutable columns.

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
revoke insert, update, delete on invoice_settings from authenticated, anon;
revoke insert, update, delete on credit_ledger from authenticated, anon;
revoke insert, update, delete on ratings from authenticated, anon;
revoke insert, update, delete on compliance_records from authenticated, anon;
revoke insert, update, delete on availability_blocks from authenticated, anon;
revoke insert, update, delete on rate_limit_hits from authenticated, anon;
