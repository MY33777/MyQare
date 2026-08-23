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
    .select("id, freelancer_id, status, shifts(ends_at), timesheets(approved_at)")
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      freelancer_id: string;
      status: string;
      shifts: { ends_at: string } | null;
      timesheets: { approved_at: string | null } | null;
    }>();

  if (!assignment || assignment.freelancer_id !== freelancer.userId) {
    redirect("/professional/diensten?error=unknown");
  }
  if (assignment.status === "cancelled") redirect(`${path}?error=unknown`);

  /*
   * Hours cannot be submitted before the shift has ended.
   *
   * Obvious on its own — you cannot report time you have not worked — and it
   * became load-bearing with migration 008, which made the existence of a
   * timesheet row the thing that blocks cancellation. Without this check a
   * freelancer could accept a shift three weeks out, immediately submit hours,
   * and neither side could ever cancel it again: the facility is locked into a
   * booking it cannot release, and the freelancer's own fee is locked in with it.
   *
   * Not merely a UI omission — the form was rendered for any confirmed
   * assignment regardless of date.
   */
  if (assignment.shifts && new Date(assignment.shifts.ends_at).getTime() > Date.now()) {
    redirect(`${path}?error=shift_not_finished`);
  }

  /*
   * Refuse once the hours are approved.
   *
   * The upsert below writes approved_at: null, and checking only for 'cancelled'
   * let it through: after approval the status is 'completed', not 'cancelled'.
   * That made this the one path that could un-approve an approved timesheet, with
   * two consequences.
   *
   * It defeated the idempotency guard in settle_timesheet — which returns early
   * precisely when approved_at is set — so the row reappeared in the facility's
   * queue and a second approval wrote a second fee adjustment, because
   * feeAdjustmentCents always measures against the SCHEDULED baseline and never
   * against what already settled. The freelancer paid the overtime fee twice.
   *
   * And the invoice was already issued, emailed and numbered.
   * createInvoiceForAssignment is idempotent, so it would not reissue: change the
   * minutes on resubmission and the emailed PDF says 510 minutes forever while
   * every screen says 480, with no credit note and no ledger row explaining the
   * gap.
   *
   * A correction after approval has to be a credit note plus a compensating ledger
   * entry. It can never be a blanked column.
   */
  if (assignment.timesheets?.approved_at) redirect(`${path}?error=hours_locked`);

  // upsert: resubmitting before approval replaces the claim rather than failing
  // on the primary key. A disputed timesheet is exactly the case where someone
  // needs to correct and resend.
  const { error: timesheetError } = await service.from("timesheets").upsert(
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
   * Checked before anything is reported or emailed.
   *
   * The result was discarded, and the code below then redirected with ?submitted=1
   * AND mailed the facility "de uren zijn ingediend". So a failed write told both
   * parties the opposite of what happened: the freelancer believes they are done,
   * the coordinator goes looking for hours that are not there, and the assignment
   * sits unbilled with nobody expecting to act.
   */
  if (timesheetError) redirect(`${path}?error=unknown`);

  /*
   * Nudge the facility. Without this the hours sit unapproved until someone
   * happens to look, which delays the invoice and therefore the freelancer being
   * paid. Best-effort: the timesheet is submitted either way.
   */
  try {
    const { data: full } = await service
      .from("assignments")
      .select("org_id, freelancers(profiles(full_name)), organisations(name, billing_email)")
      .eq("id", assignmentId)
      .maybeSingle();
    const billingEmail = (full as { organisations?: { billing_email?: string | null } } | null)?.organisations?.billing_email;
    if (billingEmail) {
      await sendTimesheetSubmittedEmail({
        to: billingEmail,
        facilityName: (full as { organisations?: { name?: string } } | null)?.organisations?.name ?? "",
        freelancerName: (full as { freelancers?: { profiles?: { full_name?: string } | null } } | null)?.freelancers
            ?.profiles?.full_name ?? "Een zorgprofessional",
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
