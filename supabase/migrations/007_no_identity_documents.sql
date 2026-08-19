-- 007 — stop storing copies of identity documents
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH (AVG): the platform asked zzp'ers to upload their passport
-- ============================================================================
-- documents.kind allowed 'id', labelled "Identiteitsbewijs" in the upload form.
-- Combined with migration 001 — which lets any facility read the APPROVED
-- documents of its own pool members, so the Wkkgz check can happen before
-- hiring — that meant every facility could download a scan showing the BSN,
-- photo, signature and document number of every freelancer in its pool.
--
-- There is no basis for it:
--
--   * A WERKGEVER must keep an ID copy, because the loonheffing requires it.
--     An OPDRACHTGEVER contracting a zelfstandige has no such obligation, and
--     the Autoriteit Persoonsgegevens is explicit that they may not keep one.
--   * The BSN printed on it may only be processed where a law prescribes it
--     (art. 46 UAVG). Nothing here prescribes it.
--   * Verifying somebody's identity by LOOKING at their document is fine.
--     Retaining the copy is a separate act needing its own basis.
--
-- The KvK extract already answers the question this platform needs answered —
-- who is the contracting party — and carries no BSN.
--
-- This is data minimisation, not caution: the safest way to hold a passport scan
-- is not to have one.

-- Storage objects go first: dropping the rows would strip the only pointer to
-- the files, leaving them in the bucket with nothing referencing them.
delete from storage.objects
where bucket_id = 'documents'
  and name in (select file_path from documents where kind = 'id');

delete from documents where kind = 'id';

alter table documents drop constraint if exists documents_kind_check;
alter table documents
  add constraint documents_kind_check
  check (kind in ('vog', 'diploma', 'certificate', 'insurance', 'kvk_extract'));

comment on column documents.kind is
  'Identity documents are deliberately absent. An opdrachtgever has no basis to '
  'retain a copy of a zelfstandige''s passport, and the BSN on it may only be '
  'processed where a law prescribes it (art. 46 UAVG). See migration 007.';

-- ----------------------------------------------------------------------------
-- Correction, 19 August 2026
-- ----------------------------------------------------------------------------
-- The storage delete above originally read `select storage_path from documents`.
-- There is no such column — it is `file_path` (schema.sql), and every reader in
-- the app uses that name. Postgres raises 42703, and because the SQL editor runs
-- a pasted script as one transaction, the ENTIRE migration rolled back: no ID
-- document was deleted, no storage object was removed, and the kind constraint
-- was never narrowed.
--
-- So the remediation this file announces did not happen, while three public pages
-- began stating as fact that MyQare cannot store copies of identity documents.
-- Worse than the original defect, because it was now also a false claim in a
-- privacy statement.
--
-- Written and committed without ever being executed, which is the whole lesson: a
-- migration nobody has run is a plan, not a fix. There is still no Supabase
-- project, so every migration in this directory is in that state. They must all
-- be run against a real database before any of them is trusted.
