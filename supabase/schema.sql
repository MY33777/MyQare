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
  -- can look around but cannot post shifts (enforced in the server action, and
  -- again by the shifts insert policy below).
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
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists profiles_org_idx on profiles(org_id);

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
  profession text not null default '',
  specialisations text[] not null default '{}',
  -- Province or region they will travel to. Free text in v1 — a controlled
  -- list is premature before we know how facilities actually describe their
  -- catchment.
  region text,
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

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  kind text not null check (kind in ('vog', 'diploma', 'certificate', 'insurance', 'id', 'kvk_extract')),
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
  response text check (response in ('accept', 'decline')),
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
  shift_id uuid not null unique references shifts(id) on delete cascade,
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  org_id uuid not null references organisations(id) on delete cascade,
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
  assignment_id uuid not null unique references assignments(id) on delete cascade,
  -- Human-facing sequential number, unique per freelancer per year. The Dutch
  -- tax authority expects an unbroken series per invoicing party, and the
  -- invoicing party here is the freelancer, not MyQare — we generate the
  -- document on their behalf.
  number text not null,
  freelancer_id uuid not null references freelancers(profile_id) on delete cascade,
  org_id uuid not null references organisations(id) on delete cascade,
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
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  -- Positive for top-ups and refunds, negative for fees.
  delta_cents integer not null,
  reason text not null check (reason in ('topup', 'fee', 'fee_refund', 'fee_adjustment', 'manual')),
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
  author_id uuid not null references profiles(id) on delete cascade,
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
  assignment_id uuid primary key references assignments(id) on delete cascade,
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
alter table credit_ledger enable row level security;
alter table ratings enable row level security;
alter table compliance_records enable row level security;
alter table rate_limit_hits enable row level security;

-- ---------- organisations ----------

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
create policy organisations_update on organisations for update
  using (id = current_org_id() or is_staff())
  with check (id = current_org_id() or is_staff());

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

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert
  with check (id = auth.uid());

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_staff())
  -- Note: this does NOT stop a user rewriting their own `role` or `org_id`.
  -- Postgres row policies cannot pin individual columns. Role changes are made
  -- only through server actions using the service role key, and the client is
  -- never given a form that posts those columns. If self-service org switching
  -- is ever added, this needs a column-level grant or a trigger.
  with check (id = auth.uid() or is_staff());

-- ---------- freelancers ----------

drop policy if exists freelancers_select on freelancers;
create policy freelancers_select on freelancers for select
  using (
    profile_id = auth.uid()
    or is_staff()
    or exists (
      select 1 from pools p
      where p.freelancer_id = freelancers.profile_id and p.org_id = current_org_id()
    )
    or exists (
      select 1 from assignments a
      where a.freelancer_id = freelancers.profile_id and a.org_id = current_org_id()
    )
    -- Region-wide open shifts: a facility that has offered a shift to the
    -- region needs to see who responded.
    or exists (
      select 1 from shifts s
      join shift_offers o on o.shift_id = s.id
      where o.freelancer_id = freelancers.profile_id and s.org_id = current_org_id()
    )
  );

drop policy if exists freelancers_write on freelancers;
create policy freelancers_write on freelancers for all
  using (profile_id = auth.uid() or is_staff())
  with check (profile_id = auth.uid() or is_staff());

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
      and exists (
        select 1 from assignments a
        where a.freelancer_id = documents.freelancer_id and a.org_id = current_org_id()
      )
    )
  );

drop policy if exists documents_write on documents;
create policy documents_write on documents for all
  using (freelancer_id = auth.uid() or is_staff())
  with check (freelancer_id = auth.uid() or is_staff());

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
create policy pools_write on pools for all
  using (org_id = current_org_id() or is_staff())
  with check (org_id = current_org_id() or is_staff());

-- ---------- shifts ----------

drop policy if exists shifts_select on shifts;
create policy shifts_select on shifts for select
  using (
    org_id = current_org_id()
    or is_staff()
    or exists (
      select 1 from shift_offers o
      where o.shift_id = shifts.id and o.freelancer_id = auth.uid()
    )
  );

drop policy if exists shifts_insert on shifts;
create policy shifts_insert on shifts for insert
  with check (
    org_id = current_org_id()
    and current_role_name() = 'facility_admin'
    -- Unverified facilities cannot post work. Checked here as well as in the
    -- server action so a direct API call with a stolen anon token can't skip it.
    and exists (select 1 from organisations o where o.id = org_id and o.verified_at is not null)
  );

drop policy if exists shifts_update on shifts;
create policy shifts_update on shifts for update
  using (org_id = current_org_id() or is_staff())
  with check (org_id = current_org_id() or is_staff());

drop policy if exists shifts_delete on shifts;
create policy shifts_delete on shifts for delete
  using (org_id = current_org_id() or is_staff());

-- ---------- shift_offers ----------

drop policy if exists shift_offers_select on shift_offers;
create policy shift_offers_select on shift_offers for select
  using (
    freelancer_id = auth.uid()
    or is_staff()
    or exists (select 1 from shifts s where s.id = shift_offers.shift_id and s.org_id = current_org_id())
  );

/*
 * A freelancer responds to their own offer and nothing else. Accepting is not
 * an insert here — it goes through a server action that has to create the
 * assignment, charge the fee and write the compliance record atomically, so the
 * update policy exists for the decline path and for marking an offer viewed.
 */
drop policy if exists shift_offers_update on shift_offers;
create policy shift_offers_update on shift_offers for update
  using (freelancer_id = auth.uid() or is_staff())
  with check (freelancer_id = auth.uid() or is_staff());

drop policy if exists shift_offers_insert on shift_offers;
create policy shift_offers_insert on shift_offers for insert
  with check (
    exists (select 1 from shifts s where s.id = shift_id and s.org_id = current_org_id())
    or is_staff()
  );

-- ---------- assignments ----------

drop policy if exists assignments_select on assignments;
create policy assignments_select on assignments for select
  using (freelancer_id = auth.uid() or org_id = current_org_id() or is_staff());

drop policy if exists assignments_update on assignments;
create policy assignments_update on assignments for update
  using (freelancer_id = auth.uid() or org_id = current_org_id() or is_staff())
  with check (freelancer_id = auth.uid() or org_id = current_org_id() or is_staff());

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
create policy timesheets_write on timesheets for all
  using (
    is_staff()
    or exists (
      select 1 from assignments a
      where a.id = timesheets.assignment_id
        and (a.freelancer_id = auth.uid() or a.org_id = current_org_id())
    )
  )
  with check (
    is_staff()
    or exists (
      select 1 from assignments a
      where a.id = timesheets.assignment_id
        and (a.freelancer_id = auth.uid() or a.org_id = current_org_id())
    )
  );

-- ---------- invoices ----------

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select
  using (freelancer_id = auth.uid() or org_id = current_org_id() or is_staff());

-- Only the facility marks an invoice paid, and only staff correct one.
drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices for update
  using (org_id = current_org_id() or is_staff())
  with check (org_id = current_org_id() or is_staff());

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

drop policy if exists ratings_select on ratings;
create policy ratings_select on ratings for select
  using (
    is_staff()
    or exists (
      select 1 from assignments a
      where a.id = ratings.assignment_id
        and (a.freelancer_id = auth.uid() or a.org_id = current_org_id())
    )
  );

drop policy if exists ratings_insert on ratings;
create policy ratings_insert on ratings for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from assignments a
      where a.id = assignment_id
        and (
          (direction = 'facility_to_freelancer' and a.org_id = current_org_id())
          or (direction = 'freelancer_to_facility' and a.freelancer_id = auth.uid())
        )
    )
  );

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
