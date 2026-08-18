"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { approveTimesheet } from "@/lib/assignments";
import { createInvoiceForAssignment } from "@/lib/invoices";

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
    .select("id, org_id")
    .eq("id", assignmentId)
    .maybeSingle<{ id: string; org_id: string }>();

  // The admin client bypasses RLS, so ownership is checked here or nowhere.
  if (!assignment || assignment.org_id !== admin.org.id) {
    redirect(`${UREN_PATH}?error=unknown`);
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

  if (!invoice.ok && invoice.reason === "vat_undetermined") {
    redirect(`${UREN_PATH}?approved=1&invoice=vat_undetermined`);
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
    .select("id, org_id")
    .eq("id", assignmentId)
    .maybeSingle<{ id: string; org_id: string }>();

  if (!assignment || assignment.org_id !== admin.org.id) {
    redirect(`${UREN_PATH}?error=unknown`);
  }

  await service
    .from("timesheets")
    .update({ disputed_at: new Date().toISOString(), dispute_reason: reason })
    .eq("assignment_id", assignmentId);

  await service.from("assignments").update({ status: "disputed" }).eq("id", assignmentId);

  revalidatePath(UREN_PATH);
  redirect(`${UREN_PATH}?disputed=1`);
}
