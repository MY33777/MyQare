import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cronAuthorised } from "@/lib/cron";
import { sendInvoiceReminderEmail } from "@/lib/email";

/*
 * Chases overdue invoices.
 *
 * MyQare never touches this money — the facility pays the freelancer directly —
 * so the only leverage the platform has is a polite, automatic reminder. Without
 * it, chasing falls to the freelancer, who is the party least comfortable doing it
 * and most affected by not.
 */

/** Days after the due date on which a reminder goes out. */
const REMINDER_DAYS = [1, 14, 30];

const MAX_REMINDERS = REMINDER_DAYS.length;

export async function GET(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  const { data: overdue, error } = await admin
    .from("invoices")
    .select(
      "id, number, due_on, total_cents, reminders_sent, organisations(name, billing_email), profiles!invoices_freelancer_id_fkey(full_name)",
    )
    .is("paid_at", null)
    .lt("due_on", todayKey)
    .lt("reminders_sent", MAX_REMINDERS)
    .limit(200)
    .returns<
      {
        id: string;
        number: string;
        due_on: string;
        total_cents: number;
        reminders_sent: number;
        organisations: { name: string; billing_email: string | null } | null;
        profiles: { full_name: string } | null;
      }[]
    >();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let skipped = 0;

  for (const invoice of overdue ?? []) {
    const daysOverdue = Math.floor(
      (today.getTime() - new Date(`${invoice.due_on}T00:00:00Z`).getTime()) / 86_400_000,
    );

    /*
     * Only on the scheduled days, so a daily cron does not mail the same facility
     * every morning. Three reminders total: the day after, two weeks, a month.
     * Beyond that it is a conversation between the two parties, not a robot's job.
     */
    const due = REMINDER_DAYS[invoice.reminders_sent];
    if (due === undefined || daysOverdue < due) {
      skipped++;
      continue;
    }

    const to = invoice.organisations?.billing_email;
    if (!to) {
      skipped++;
      continue;
    }

    const ok = await sendInvoiceReminderEmail({
      to,
      facilityName: invoice.organisations?.name ?? "",
      freelancerName: invoice.profiles?.full_name ?? "Een zorgprofessional",
      invoiceNumber: invoice.number,
      totalCents: invoice.total_cents,
      daysOverdue,
    });

    // Counter only advances on a successful send, so a mail outage delays the
    // reminder rather than silently consuming one of the three.
    if (ok) {
      await admin
        .from("invoices")
        .update({ reminders_sent: invoice.reminders_sent + 1 })
        .eq("id", invoice.id);
      sent++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, considered: overdue?.length ?? 0, sent, skipped });
}
