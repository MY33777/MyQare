"use server";

import { redirect } from "next/navigation";
import { sendAssignmentCancelledEmail } from "@/lib/email";
import { facilityCoordinatorEmails, freelancerEmail } from "@/lib/notify";
import { qualificationLabel } from "@/lib/qualifications";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cancelAssignment } from "@/lib/assignments";
import { capabilitiesFor, recordAdminAudit } from "@/lib/permissions";

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
    .select(
      "id, freelancer_id, org_id, status, timesheets(claimed_at, approved_at), " +
        // Everything the notification below needs, in the read that already runs.
        "shifts(profession, starts_at, ends_at), organisations(name), freelancers(profiles(full_name))",
    )
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      freelancer_id: string;
      org_id: string;
      status: string;
      timesheets: { claimed_at: string | null; approved_at: string | null } | null;
      shifts: { profession: string; starts_at: string; ends_at: string } | null;
      organisations: { name: string } | null;
      freelancers: { profiles: { full_name: string } | null } | null;
    }>();

  if (!assignment) redirect("/");

  const { data: profile } = await admin
    .from("profiles")
    .select("role, org_id, full_name")
    .eq("id", user.id)
    .maybeSingle<{ role: string; org_id: string | null; full_name: string | null }>();

  const isFreelancer = assignment.freelancer_id === user.id;
  const isFacility =
    profile?.role === "facility_admin" && profile.org_id === assignment.org_id;

  /*
   * Staff need the capability, not merely the role — and the admin client
   * bypasses RLS, so what follows is the only thing standing between a signed-in
   * stranger and cancelling somebody else's shift.
   *
   * This action refunds the platform fee to the freelancer's ledger, reopens the
   * shift and resets its offers — it is the only place in the product where an
   * admin moves money between two other people's accounts. It was also the only
   * privileged action that never asked WHICH admin was asking: role === "staff"
   * and through, while approving a diploma next door required a capability.
   *
   * Read for staff only, so an ordinary cancellation by either party does not pay
   * for a permissions lookup it will never consult.
   */
  const isStaff =
    profile?.role === "staff" &&
    (await capabilitiesFor(user.id)).includes("cancel_assignments");

  if (!isFreelancer && !isFacility && !isStaff) {
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

  /*
   * Written after the cancellation succeeded, and only for staff.
   *
   * A party cancelling their own booking is ordinary product use and is already
   * recorded on the assignment itself. An admin cancelling somebody else's is an
   * intervention, and the two people it affects are entitled to an answer about
   * who made it. recordAdminAudit never throws — a missing log line must not turn
   * a completed cancellation into a reported failure. See lib/permissions.ts.
   */
  if (isStaff) {
    const { data: subject } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", assignment.freelancer_id)
      .maybeSingle<{ full_name: string | null }>();

    await recordAdminAudit({
      actorId: user.id,
      actorName: profile?.full_name ?? null,
      subjectId: assignment.freelancer_id,
      subjectName: subject?.full_name ?? null,
      action: "assignment_cancelled",
      note: reason ? assignmentId + " — " + reason : assignmentId,
    });
  }

  /*
   * BOTH SIDES ARE TOLD. Neither was.
   *
   * This ended with seven revalidatePath calls and a redirect. cancel_assignment
   * sets the shift back to 'open' and reopens every offer that was closed when it
   * filled — so the ward's night cover has silently evaporated, and the
   * coordinator finds out the next morning or when nobody turns up. That is the
   * moment she phones an agency instead, and the product gave her no chance to
   * react while there was still time to fill it.
   *
   * The other direction is as bad: a freelancer who kept the evening free is told
   * nothing. Both cancel screens already promise otherwise in their own copy —
   * "Laat het ze zo vroeg mogelijk weten, ze hebben die dag vrijgehouden" — and
   * /professional says "verschijnt die hier en krijg je een e-mail".
   *
   * Whoever did the cancelling is not mailed: they were just looking at the
   * confirmation. Best effort, after the cancellation has already succeeded.
   */
  try {
    const shift = assignment.shifts;

    if (shift) {
      const reopened = new Date(shift.starts_at).getTime() > Date.now();
      const facilityName = assignment.organisations?.name ?? "De zorginstelling";
      const freelancerName = assignment.freelancers?.profiles?.full_name ?? "De zorgprofessional";

      const common = {
        facilityName,
        freelancerName,
        qualification: qualificationLabel(shift.profession),
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        reason,
        reopened,
      };

      if (!isFacility) {
        const coordinators = await facilityCoordinatorEmails(assignment.org_id);
        await Promise.all(
          coordinators.map((to) =>
            sendAssignmentCancelledEmail({ ...common, to, audience: "facility" }),
          ),
        );
      }

      if (!isFreelancer) {
        const to = await freelancerEmail(assignment.freelancer_id);
        if (to) await sendAssignmentCancelledEmail({ ...common, to, audience: "freelancer" });
      }
    }
  } catch (cause) {
    console.error(`[cancel] notification not sent for ${assignmentId}: ${String(cause)}`);
  }

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
