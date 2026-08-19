-- 010 — invoicing a freelancer controls, and ratings that stay anonymous
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.

-- ============================================================================
-- NEW: invoice_settings — the freelancer's own invoicing setup
-- ============================================================================
-- Until now every invoice was issued with hardcoded defaults: a 2026-0001 series,
-- a fourteen-day term, no IBAN, no business address and no btw-id. That is not a
-- valid Dutch invoice. Article 35a Wet OB requires the supplier's full name and
-- address and, where VAT is charged, their btw-identificatienummer — and the
-- supplier here is the freelancer, not MyQare. We generate the document on their
-- behalf, so their details have to be on it.
--
-- It also has to be theirs to control. A zzp'er who already runs a numbering
-- series in their own bookkeeping cannot have a second, conflicting series
-- appearing under their name; and plenty of people want to look at an invoice
-- before it goes to a client they have to keep working with.
--
-- One row per freelancer, created on demand. Every column has a working default
-- so an untouched account still behaves exactly as before — except that invoicing
-- refuses when the legally required fields are blank, which is the point.

create table if not exists invoice_settings (
  profile_id uuid primary key references freelancers(profile_id) on delete cascade,

  /*
   * Whether an approved timesheet turns straight into a sent invoice.
   *
   * Default on, because the promise on the public site is that facturatie happens
   * without work. Off means the invoice is still created and numbered — the
   * number must be allocated in approval order or the series has gaps — but it
   * sits unsent until the freelancer releases it.
   */
  auto_send boolean not null default true,

  -- Prefix in front of the year: 'F' gives F2026-0001. Null gives 2026-0001.
  number_prefix text check (number_prefix is null or number_prefix ~ '^[A-Za-z0-9-]{1,8}$'),
  -- First sequence number to use. For somebody continuing an existing series
  -- rather than starting at 1. Never lowered below what has already been issued.
  number_start integer not null default 1 check (number_start >= 1),

  -- Payment term in days from the issue date. 14 is the Dutch default; 30 is
  -- common for larger institutions and is theirs to agree, not ours to impose.
  payment_term_days integer not null default 14
    check (payment_term_days between 0 and 120),

  iban text,
  account_holder text,

  -- Identity as it must appear on the invoice (art. 35a Wet OB).
  business_name text,
  address_line text,
  postcode text,
  city text,
  -- btw-identificatienummer. Required when VAT is charged; not when the medical
  -- exemption applies, which is why this is nullable and checked at issue time
  -- against the freelancer's vat_exempt rather than by a NOT NULL here.
  vat_number text,

  -- Free text under the totals: payment instructions, a reference, a thank-you.
  payment_note text check (payment_note is null or length(payment_note) <= 500),

  -- Send the freelancer their own copy. On by default: it is their invoice, and
  -- the first time most people see one of these they will want it in their inbox.
  copy_to_self boolean not null default true,

  updated_at timestamptz not null default now()
);

alter table invoice_settings enable row level security;

drop policy if exists invoice_settings_select on invoice_settings;
create policy invoice_settings_select on invoice_settings for select
  using (profile_id = auth.uid() or is_staff());

-- No write policy, like every other table: writes go through the service role in
-- a server action. See migration 005.
revoke insert, update, delete on invoice_settings from authenticated, anon;

-- ============================================================================
-- HIGH: the rated party could read the rating written about them
-- ============================================================================
-- ratings_select lets either party to an assignment read its rating rows. Every
-- query in the app selects only `score`, so nothing on screen exposed anything —
-- but RLS grants rows, not columns, and PostgREST will return whatever is asked
-- for:
--
--     GET /rest/v1/ratings?assignment_id=eq.<id>&select=comment,author_id
--
-- so a freelancer could read exactly what a coordinator wrote about them, and who
-- wrote it. The rating form tells people their feedback is not shown to the other
-- side; that promise lived only in the copy.
--
-- This is the same shape as the five defects migration 005 dealt with: a row
-- policy cannot pin which COLUMNS may be read. The instrument for that is a
-- column grant, which composes with RLS rather than replacing it.
--
-- Scores stay readable because both dashboards compute an average from them, and
-- an aggregate over a run of assignments does not identify an author. The comment
-- and the author do.

revoke select (comment, author_id) on ratings from authenticated, anon;

-- Consequence worth stating: `select=*` on ratings now fails for a signed-in
-- user rather than returning a partial row. Nothing in the app does that, and a
-- loud failure is the right outcome for a query that was asking for more than it
-- was entitled to.

-- ============================================================================
-- Backfill: settings rows for freelancers who already exist
-- ============================================================================
-- Defaults only, so behaviour is unchanged for anyone who never opens the page.
insert into invoice_settings (profile_id)
select profile_id from freelancers
on conflict (profile_id) do nothing;
