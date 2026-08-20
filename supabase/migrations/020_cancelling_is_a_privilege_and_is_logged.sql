-- 020 — a staff cancellation is a privileged act, and it leaves a record
--
-- Run in the Supabase SQL editor. Safe to re-run. Folded into schema.sql too.
--
-- ============================================================================
-- HIGH: every admin could cancel every assignment, and move money doing it
-- ============================================================================
-- cancelAssignmentAction let anyone through on `profile.role = 'staff'` alone.
-- Migration 014 exists precisely because "staff means staff can do everything"
-- is not an authorisation model — yet this action, which is the only one in the
-- product where an admin moves money between accounts, was the one that never
-- asked. cancel_assignment() refunds the platform fee to the freelancer's
-- ledger, reopens the shift and resets its offers.
--
-- So it gets a capability of its own. Not folded into an existing one: nothing
-- about approving a diploma implies the authority to unwind somebody's booked
-- work the night before it starts.

alter table staff_permissions drop constraint if exists staff_permissions_capability_check;
alter table staff_permissions add constraint staff_permissions_capability_check
  check (capability in (
    'verify_organisations',
    'verify_big',
    'review_documents',
    'cancel_assignments',
    'manage_admins'
  ));

-- ============================================================================
-- And it is written down
-- ============================================================================
-- The audit log covered who was made an admin and what they were given, and
-- recorded nothing about what any of them then DID. An admin cancelling a shift
-- on someone's behalf is exactly the act that has to be attributable afterwards
-- — to the facility that lost the cover, to the freelancer who lost the work,
-- and to us when one of them asks who decided that.

alter table admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table admin_audit_log add constraint admin_audit_log_action_check
  check (action in (
    'admin_appointed',
    'admin_removed',
    'capability_granted',
    'capability_revoked',
    'assignment_cancelled'
  ));

-- ============================================================================
-- Consequence for existing installations
-- ============================================================================
-- Nobody holds cancel_assignments after this runs, including the first admin.
-- That is deliberate — a capability that grants itself on migration is not a
-- capability. Grant it from /beheer/beheerders, or, for the first admin on a
-- fresh install, with the statement in SETUP.md §8.
--
-- Until it is granted, staff cannot cancel. Both parties to an assignment still
-- can, which is the route almost every real cancellation takes anyway.
