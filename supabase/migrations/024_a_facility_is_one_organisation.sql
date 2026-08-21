-- 024 — a second coordinator joins the facility instead of founding a new one
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- Onboarding created an organisation every single time
-- ============================================================================
-- Every facility_admin who completed onboarding got a fresh `organisations` row.
-- So the second coordinator at the same care home — the colleague who takes over
-- the roster on Thursdays — founded a duplicate facility with the same name and
-- the same KvK number, and from that moment the two of them were running
-- separate products:
--
--   * separate pools, so a freelancer vetted by one was a stranger to the other
--   * separate shifts, so neither could see what the other had posted
--   * separate invoices, with two numbering series against one supplier
--   * a compliance dossier split in half, which is the one artefact that must
--     be complete to be worth anything
--   * a second verification queue entry for an organisation already verified
--
-- Nothing detected it and nothing could merge it afterwards: assignments,
-- invoices and compliance records all hang off org_id, and invoices deliberately
-- carry ON DELETE RESTRICT. (They did not when this was written — see
-- migration 025, which is what made that sentence true.)
--
-- ============================================================================
-- Why an invite and not "join by KvK"
-- ============================================================================
-- The obvious fix is to look the KvK number up and join the organisation that
-- already has it. A KvK number IS the legal identity of an organisation, so that
-- is the right key — and it is exactly the wrong control, because KvK numbers
-- are public. Anyone who types a hospital's number would land inside its pool,
-- its freelancers' document metadata, its rates and its invoices.
--
-- So a matching KvK stops the duplicate from being created, and joining requires
-- somebody already inside to invite you.

create table if not exists organisation_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,

  -- Lower-cased on write. The invite is claimed by whoever signs in with this
  -- address, so it is the whole of the identity check and must match exactly.
  email text not null,

  -- Kept even if that person later leaves: "who let them in" is the question
  -- somebody asks after the fact, and a null answer is not an answer.
  invited_by uuid references profiles(id) on delete set null,
  invited_by_name text,

  created_at timestamptz not null default now(),
  accepted_at timestamptz,

  -- One open invite per address per organisation. A second send is an update,
  -- not a second row, so revoking cannot leave a forgotten duplicate behind.
  unique (org_id, email)
);

create index if not exists organisation_invites_email_idx on organisation_invites(lower(email));

alter table organisation_invites enable row level security;

/*
 * Readable by the organisation it belongs to, so a coordinator can see who has
 * been invited and has not yet joined.
 *
 * NOT readable by the invitee before they join — they have no profile row scoped
 * to this org yet, and the fact that a given address was invited somewhere is
 * itself worth not publishing. They learn about it from the email and from
 * onboarding, both of which run with the service role.
 */
drop policy if exists organisation_invites_select on organisation_invites;
create policy organisation_invites_select on organisation_invites for select
  using (org_id = current_org_id() or is_staff());

revoke insert, update, delete on organisation_invites from authenticated, anon;

-- ============================================================================
-- Duplicates that already exist
-- ============================================================================
-- Deliberately NOT merged here. Merging means rewriting org_id on assignments,
-- shifts, pools, invoices and compliance_records, and an invoice is a financial
-- record whose org_id is part of what it attests. That is a decision for a human
-- with the two facilities in front of them, not a migration.
--
-- This stops new ones. SETUP.md gains a note about checking for duplicate KvK
-- numbers before going live, which is the moment it is cheapest to fix.
