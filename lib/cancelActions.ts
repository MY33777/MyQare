"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cancelAssignment } from "@/lib/assignments";

/**
 * Cancels an assignment from either side.
 *
 * Shared, because the checks are the same shape: the caller must be a party to
 * the assignment, and the work must not already have happened.
 *
 * "Already happened" means hours SUBMITTED, not hours approved. That distinction
 * cost a freelancer their pay: the gate used to be `approved_at`, so a shift that
 * had actually been worked, with hours waiting in the approval queue, was
 * cancellable by either side — and once cancelled it left that queue forever
 * (/zorginstelling/uren filters cancelled rows) while invoicing refused without
 * an approval that could no longer be given. Work delivered, unbillable, no route
 * back, and the loser was the party who did it.
 *
 * After the hours are in, the question is not whether the assignment exists but
 * whether the hours are right. That is what disputing them is for.
 */
export async function cancelAssignmentAction(formData: FormData) {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!assignmentId) redirect("/");

  const admin = getSupabaseAdmin();

  const { data: assignment } = await admin
    .from("assignments")
    // claimed_at, not just approved_at: the existence of a timesheet row is the
    // system's own record that the shift was worked.
    .select("id, freelancer_id, org_id, status, timesheets(claimed_at, approved_at)")
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      freelancer_id: string;
      org_id: string;
      status: string;
      timesheets: { claimed_at: string | null; approved_at: string | null } | null;
    }>();

  if (!assignment) redirect("/");

  const { data: profile } = await admin
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .maybeSingle<{ role: string; org_id: string | null }>();

  const isFreelancer = assignment.freelancer_id === user.id;
  const isFacility =
    profile?.role === "facility_admin" && profile.org_id === assignment.org_id;

  /*
   * The admin client bypasses RLS, so this is the only thing standing between a
   * signed-in stranger and cancelling somebody else's shift.
   */
  if (!isFreelancer && !isFacility && profile?.role !== "staff") {
    redirect("/geen-toegang");
  }

  const backTo = isFreelancer
    ? `/professional/diensten/${assignmentId}`
    : "/zorginstelling/diensten";

  if (assignment.status === "cancelled") redirect(backTo);
  if (assignment.timesheets?.approved_at) redirect(`${backTo}?error=already_approved`);
  // cancel_assignment refuses this too; the check here exists to give a message
  // rather than a raised exception the UI can only render as "Er ging iets mis".
  if (assignment.timesheets) redirect(`${backTo}?error=hours_submitted`);

  const cancelledBy = isFreelancer ? "freelancer" : isFacility ? "facility" : "staff";
  const result = await cancelAssignment(assignmentId, cancelledBy, reason);

  if (!result.ok) redirect(`${backTo}?error=unknown`);

  revalidatePath(backTo);
  revalidatePath("/professional");
  revalidatePath("/zorginstelling");
  // The approval queue was left stale, so it kept offering Goedkeuren on an
  // assignment that had just been cancelled — the click that used to charge the
  // whole fee a second time.
  revalidatePath("/zorginstelling/uren");
  // The shift is open again and its offers were reset, so both listings changed.
  revalidatePath("/zorginstelling/diensten");
  revalidatePath("/professional/aanbod");
  redirect(`${backTo}?cancelled=1`);
}
