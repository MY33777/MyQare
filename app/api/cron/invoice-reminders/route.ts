import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cronAuthorised } from "@/lib/cron";
import { amsterdamDateKey } from "@/lib/timezone";
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

/** How many overdue invoices one run will handle. Reported when it bites. */
const REMINDER_BATCH = 200;

export async function GET(request: NextRequest) {
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const today = new Date();
  /*
   * Amsterdam, not UTC. toISOString() is the UTC day, which for two hours every
   * summer evening is yesterday — long enough to leave an invoice that fell due
   * today out of the run, or to chase one a day early.
   */
  const todayKey = amsterdamDateKey(today);

  const { data: overdue, error } = await admin
    .from("invoices")
    .select(
      "id, number, due_on, total_cents, reminders_sent, organisations(name, billing_email), freelancers(profiles(full_name))",
    )
    .is("paid_at", null)
    /*
     * Only invoices the facility actually has.
     *
     * A freelancer with auto_send off gets an invoice created and numbered but
     * deliberately not delivered. This query had no sent_at filter, so the cron
     * chased facilities for documents they had never received — a dunning letter
     * about an invoice number they cannot find, three times, escalating. The
     * embarrassment lands on the freelancer, who did nothing but choose to review
     * their own invoices first.
     */
    .not("sent_at", "is", null)
    .lt("due_on", todayKey)
    .lt("reminders_sent", MAX_REMINDERS)
    /*
     * Oldest first, and say so when the cap bites.
     *
     * .limit(200) with no ordering meant Postgres returned whatever 200 it liked,
     * so past that many overdue invoices some were chased and others were not,
     * arbitrarily and differently each day — while the endpoint reported a clean
     * run. Ordering makes the cut deterministic; the report below makes it visible.
     */
    .order("due_on", { ascending: true })
    .limit(REMINDER_BATCH)
    .returns<
      {
        id: string;
        number: string;
        due_on: string;
        total_cents: number;
        reminders_sent: number;
        organisations: { name: string; billing_email: string | null } | null;
        freelancers: { profiles: { full_name: string } | null } | null;
      }[]
    >();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let failed = 0;
  const problems: string[] = [];

  // The cap was reached, so some overdue invoices were not looked at today. Said
  // out loud rather than left to be inferred from a number that looks fine.
  if ((overdue?.length ?? 0) >= REMINDER_BATCH) {
    problems.push(
      `batch cap of ${REMINDER_BATCH} reached — older invoices processed first, the rest wait for the next run`,
    );
  }

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
    /*
     * WHICH reminder this invoice is due, not the next one in the counter.
     *
     * It read REMINDER_DAYS[reminders_sent] and sent whenever daysOverdue had
     * passed it. For an invoice that goes out on time that is right — day 1, day
     * 14, day 30, one each. For an invoice already well overdue when it is first
     * seen it is not: at 35 days the counter is 0, so morning one clears the
     * day-1 threshold, morning two clears day 14, morning three clears day 30.
     * Three escalating dunning letters to one facility on three consecutive
     * mornings, ending with the final notice, for an invoice they may only just
     * have received. That happens to every invoice released late from the hold
     * queue, which is a normal thing for a freelancer to do.
     *
     * Counting how many thresholds have passed instead sends ONE reminder — the
     * one that fits how overdue it actually is — and moves the counter straight
     * to it.
     */
    const stage = REMINDER_DAYS.filter((day) => daysOverdue >= day).length;

    if (stage <= invoice.reminders_sent) {
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
      freelancerName: invoice.freelancers?.profiles?.full_name ?? "Een zorgprofessional",
      invoiceNumber: invoice.number,
      totalCents: invoice.total_cents,
      daysOverdue,
    });

    // Counter only advances on a successful send, so a mail outage delays the
    // reminder rather than silently consuming one of the three.
    if (ok) {
      const { error: counterError } = await admin
        .from("invoices")
        // To the stage that was actually sent, not one more than before: an
        // invoice first seen at 35 days has had its final notice and is done.
        .update({ reminders_sent: stage })
        .eq("id", invoice.id);

      /*
       * If the counter does not advance, tomorrow's run sends the identical
       * reminder to the same facility — and the day after, and forever, because
       * nothing else moves it. `sent++` ran regardless, so the endpoint reported
       * a clean run while setting up a mail loop aimed at a customer.
       */
      if (counterError) {
        failed++;
        problems.push(`${invoice.number}: reminder sent but counter not advanced`);
      } else {
        sent++;
      }
    } else {
      skipped++;
      failed++;
      problems.push(`${invoice.number}: reminder could not be sent`);
    }
  }

  /*
   * ok reflects whether the run did its job. Reporting true while counting only
   * successes is the pattern every audit round has caught here: the monitoring
   * goes green and nobody learns that a month of reminders went nowhere.
   */
  return NextResponse.json(
    {
      ok: failed === 0,
      considered: overdue?.length ?? 0,
      sent,
      skipped,
      failed,
      problems: problems.slice(0, 20),
      truncatedProblems: Math.max(0, problems.length - 20),
    },
    { status: failed === 0 ? 200 : 500 },
  );
}
