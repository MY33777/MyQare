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
 * the assignment, and the work must not already have happened. Once hours are
 * approved there is nothing left to cancel — the shift was worked, and the way to
 * undo an approval is a credit note, not a cancellation.
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
    .select("id, freelancer_id, org_id, status, timesheets(approved_at)")
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      freelancer_id: string;
      org_id: string;
      status: string;
      timesheets: { approved_at: string | null } | null;
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

  const cancelledBy = isFreelancer ? "freelancer" : isFacility ? "facility" : "staff";
  const result = await cancelAssignment(assignmentId, cancelledBy, reason);

  if (!result.ok) redirect(`${backTo}?error=unknown`);

  revalidatePath(backTo);
  revalidatePath("/professional");
  revalidatePath("/zorginstelling");
  redirect(`${backTo}?cancelled=1`);
}
