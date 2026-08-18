-- 001 — let a facility verify a pool member before hiring them
--
-- Run in the Supabase SQL editor. Safe to re-run. Also folded into schema.sql, so
-- a fresh project needs only that file; this exists for a project already created.
--
-- ============================================================================
-- WHY
-- ============================================================================
-- The original policy let a facility read a freelancer's approved documents only
-- once an assignment existed between them. That is backwards for the duty it is
-- meant to support: Wkkgz obliges the facility to check qualifications BEFORE
-- engaging someone, and the first assignment is exactly the moment that check
-- comes too late.
--
-- Pool membership now also grants read access to APPROVED documents. Still not to
-- pending or rejected ones — an upload that has not passed review is between the
-- freelancer and our back office, and a rejected VOG is nobody else's business.
--
-- ============================================================================
-- WHAT THIS DOES NOT GRANT
-- ============================================================================
-- Reading the row is not reading the file. The storage bucket is private, so
-- file_path on its own is inert — the bytes need a signed URL, which is minted by
-- server code that applies its own rule (see app/zorginstelling/pool/[id]).
-- Pool-only facilities see WHICH documents are approved and when they expire;
-- the file itself still requires an actual working relationship.
--
-- That split matters because a facility adds someone to its pool unilaterally, by
-- email address. Pool membership is therefore not the freelancer's consent to
-- hand over a scan of their passport — but "is this person's VOG valid" is a fair
-- question to answer before offering them a shift.

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
          where a.freelancer_id = documents.freelancer_id and a.org_id = current_org_id()
        )
        or exists (
          select 1 from pools p
          where p.freelancer_id = documents.freelancer_id
            and p.org_id = current_org_id()
            -- A hidden member is one this facility has stopped working with;
            -- it should not keep a window into their paperwork.
            and p.status <> 'hidden'
        )
      )
    )
  );
