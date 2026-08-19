"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { approveTimesheet } from "@/lib/assignments";
import { createInvoiceForAssignment } from "@/lib/invoices";
import { sendInvoiceBlockedEmail } from "@/lib/email";
import { MISSING_FIELD_LABELS, type MissingField } from "@/lib/invoiceSettings";

const UREN_PATH = "/zorginstelling/uren";

/**
 * Facility approves the hours.
 *
 * This is the moment the fee difference settles: the 5% was charged at
 * acceptance on the scheduled duration, and approving the real hours writes a
 * second, smaller ledger entry for the difference. The first entry is never
 * rewritten — see the append-only note in supabase/schema.sql.
 */
export async function approveTimesheetAction(formData: FormData) {
  const assignmentId = String(formData.get("assignment_id") ?? "");

  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Furen");

  const service = getSupabaseAdmin();
  const { data: assignment } = await service
    .from("assignments")
    .select("id, org_id, status")
    .eq("id", assignmentId)
    .maybeSingle<{ id: string; org_id: string; status: string }>();

  // The admin client bypasses RLS, so ownership is checked here or nowhere.
  if (!assignment || assignment.org_id !== admin.org.id) {
    redirect(`${UREN_PATH}?error=unknown`);
  }

  /*
   * A cancelled assignment must not be approved. settle_timesheet refuses it now
   * too, but this select had no status at all — so a stale queue page, which was
   * exactly what cancelling produced, offered a Goedkeuren button that charged
   * the entire fee for work the platform had just refunded, resurrected the row
   * as 'completed', and emailed a numbered invoice for it. See migration 008.
   */
  if (assignment.status === "cancelled") {
    redirect(`${UREN_PATH}?error=assignment_cancelled`);
  }

  const result = await approveTimesheet(assignmentId, admin.userId);
  if (!result.ok) redirect(`${UREN_PATH}?error=${result.reason}`);

  /*
   * Invoicing is attempted after the fee has settled, and is allowed to fail
   * without undoing the approval. An undetermined VAT status legitimately blocks
   * an invoice (lib/vat.ts) but must not block the approval itself — otherwise a
   * question nobody has answered yet also freezes the hours and the fee.
   */
  const invoice = await createInvoiceForAssignment(assignmentId);

  revalidatePath(UREN_PATH);
  revalidatePath("/zorginstelling/facturen");

  /*
   * The hours are approved and the fee has settled either way — that cannot be
   * undone from here. But an approval that produced NO invoice has to say so.
   *
   * This previously branched only on vat_undetermined and otherwise reported a
   * bare "Uren goedgekeurd", so a failure left the work permanently unbilled with
   * the Goedkeuren button gone from the queue. Nobody would notice until the
   * freelancer chased payment for a shift that was never invoiced.
   */
  if (!invoice.ok) {
    /*
     * Tell the freelancer, because they are the only one who can unblock it and
     * the banner shown to the coordinator says they have been told.
     *
     * Best effort: the approval and the fee settlement already stand, and a mail
     * failure must not undo them. The work also now surfaces on the freelancer's
     * own invoice page with a button, so this is a nudge rather than the only
     * route back.
     */
    if (invoice.reason === "invoice_details_missing" || invoice.reason === "vat_undetermined") {
      await notifyFreelancerInvoiceBlocked(assignmentId, invoice.reason, invoice.missing ?? []);
    }
    redirect(`${UREN_PATH}?approved=1&invoice=${invoice.reason}`);
  }
  /*
   * Held on the freelancer's own instruction, not a failure. The coordinator is
   * told anyway: an invoice they are expecting and do not receive turns into a
   * chase, and "she is reviewing it first" is a two-second answer that saves one.
   */
  if (invoice.held) {
    redirect(`${UREN_PATH}?approved=1&invoice=held`);
  }
  redirect(`${UREN_PATH}?approved=1`);
}

/**
 * Facility disputes the hours.
 *
 * No money moves and no fee settles: the assignment stays open until the two
 * parties agree. Deliberately not a rejection — the freelancer can correct and
 * resubmit, which is the common case (a shift that ran over, entered from
 * memory a day later).
 */
export async function disputeTimesheetAction(formData: FormData) {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Furen");

  if (!reason) redirect(`${UREN_PATH}?error=missing_fields`);

  const service = getSupabaseAdmin();
  const { data: assignment } = await service
    .from("assignments")
    .select("id, org_id, status, timesheets(approved_at)")
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      org_id: string;
      status: string;
      timesheets: { approved_at: string | null } | null;
    }>();

  if (!assignment || assignment.org_id !== admin.org.id) {
    redirect(`${UREN_PATH}?error=unknown`);
  }

  /*
   * Same omission as approving had: no status in the select, and the write is
   * unconditional. No money moves here, but it would flip a cancelled or already
   * invoiced assignment to 'disputed' — a state its own history contradicts.
   */
  if (assignment.status === "cancelled") {
    redirect(`${UREN_PATH}?error=assignment_cancelled`);
  }

  /*
   * And refuse once the hours are approved, which guarding on 'cancelled' alone
   * did not cover: after approval the status is 'completed'.
   *
   * Disputing then left the assignment stranded with no exit for either party.
   * The freelancer's resubmit path refuses on approved_at (hours_locked), and
   * approving again settles to a zero delta but the invoice was already issued,
   * numbered and emailed — so the row sits in 'disputed' forever, out of the
   * queue's normal flow, contradicting a document already in the facility's
   * bookkeeping.
   *
   * Correcting an approved timesheet is a credit note, not a state flip. That
   * process does not exist yet, so the honest answer is to refuse and say why.
   */
  if (assignment.timesheets?.approved_at) {
    redirect(`${UREN_PATH}?error=already_settled`);
  }

  const { error: sheetError } = await service
    .from("timesheets")
    .update({ disputed_at: new Date().toISOString(), dispute_reason: reason })
    .eq("assignment_id", assignmentId);

  /*
   * Both writes checked, and the timesheet one first.
   *
   * If the timesheet update fails and the assignment flip succeeds, the row reads
   * 'disputed' with no reason attached — the freelancer is told to correct
   * something and not told what. Failing before the second write leaves the
   * assignment in the state it was already in, which is recoverable by clicking
   * again.
   */
  if (sheetError) redirect(`${UREN_PATH}?error=unknown`);

  const { error: statusError } = await service
    .from("assignments")
    .update({ status: "disputed" })
    .eq("id", assignmentId);
  if (statusError) redirect(`${UREN_PATH}?error=unknown`);

  revalidatePath(UREN_PATH);
  redirect(`${UREN_PATH}?disputed=1`);
}

/**
 * Emails the freelancer that their approved work is waiting on their own details.
 *
 * Separate function because the approval path must stay readable, and because
 * everything in here is allowed to fail without affecting anything that already
 * happened.
 */
async function notifyFreelancerInvoiceBlocked(
  assignmentId: string,
  reason: "invoice_details_missing" | "vat_undetermined",
  missing: MissingField[],
): Promise<void> {
  const service = getSupabaseAdmin();

  const { data: assignment } = await service
    .from("assignments")
    .select("freelancer_id, organisations(name), profiles!assignments_freelancer_id_fkey(full_name)")
    .eq("id", assignmentId)
    .maybeSingle<{
      freelancer_id: string;
      organisations: { name: string } | null;
      profiles: { full_name: string } | null;
    }>();

  if (!assignment) return;

  const { data: user } = await service.auth.admin.getUserById(assignment.freelancer_id);
  const to = user?.user?.email;
  if (!to) return;

  await sendInvoiceBlockedEmail({
    to,
    freelancerName: assignment.profiles?.full_name ?? "",
    facilityName: assignment.organisations?.name ?? "De zorginstelling",
    reason,
    missing: missing.map((field) => MISSING_FIELD_LABELS[field]),
  });
}
