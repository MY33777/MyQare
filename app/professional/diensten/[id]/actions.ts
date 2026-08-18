"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFreelancer } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendTimesheetSubmittedEmail } from "@/lib/email";

/**
 * The freelancer states the hours they actually worked.
 *
 * Submitted as hours+minutes from the form and stored as total minutes, because
 * a shift that ran 7h45 is exact in minutes and a recurring decimal in hours.
 * The facility then approves or disputes; the fee difference settles on approval
 * (see settle_timesheet in supabase/functions.sql).
 */
export async function submitTimesheetAction(formData: FormData) {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const path = `/professional/diensten/${assignmentId}`;

  const freelancer = await getFreelancer();
  if (!freelancer) redirect(`/login?next=${encodeURIComponent(path)}`);

  const hours = Number(formData.get("hours") ?? 0);
  const minutes = Number(formData.get("minutes") ?? 0);
  const breakMinutes = Number(formData.get("break_minutes") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) {
    redirect(`${path}?error=invalid_minutes`);
  }
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    redirect(`${path}?error=invalid_minutes`);
  }

  const totalMinutes = Math.round(hours) * 60 + Math.round(minutes);
  if (totalMinutes <= 0) redirect(`${path}?error=invalid_minutes`);

  const service = getSupabaseAdmin();

  // Confirm the assignment is actually theirs before writing. RLS would also
  // catch this, but the admin client bypasses RLS, so the check has to be here.
  const { data: assignment } = await service
    .from("assignments")
    .select("id, freelancer_id, status")
    .eq("id", assignmentId)
    .maybeSingle<{ id: string; freelancer_id: string; status: string }>();

  if (!assignment || assignment.freelancer_id !== freelancer.userId) {
    redirect("/professional/diensten?error=unknown");
  }
  if (assignment.status === "cancelled") redirect(`${path}?error=unknown`);

  // upsert: resubmitting before approval replaces the claim rather than failing
  // on the primary key. A disputed timesheet is exactly the case where someone
  // needs to correct and resend.
  await service.from("timesheets").upsert(
    {
      assignment_id: assignmentId,
      minutes_claimed: totalMinutes,
      break_minutes: Math.round(breakMinutes),
      note,
      claimed_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
      disputed_at: null,
      dispute_reason: null,
    },
    { onConflict: "assignment_id" },
  );

  /*
   * Nudge the facility. Without this the hours sit unapproved until someone
   * happens to look, which delays the invoice and therefore the freelancer being
   * paid. Best-effort: the timesheet is submitted either way.
   */
  try {
    const { data: full } = await service
      .from("assignments")
      .select("org_id, profiles!assignments_freelancer_id_fkey(full_name), organisations(name, billing_email)")
      .eq("id", assignmentId)
      .maybeSingle();
    const billingEmail = (full as { organisations?: { billing_email?: string | null } } | null)?.organisations?.billing_email;
    if (billingEmail) {
      await sendTimesheetSubmittedEmail({
        to: billingEmail,
        facilityName: (full as { organisations?: { name?: string } } | null)?.organisations?.name ?? "",
        freelancerName: (full as { profiles?: { full_name?: string } } | null)?.profiles?.full_name ?? "Een zorgprofessional",
        minutes: totalMinutes - Math.round(breakMinutes),
        assignmentId,
      });
    }
  } catch {
    // Notification only.
  }

  revalidatePath(path);
  revalidatePath("/professional/diensten");
  revalidatePath("/zorginstelling/uren");
  redirect(`${path}?submitted=1`);
}
