"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getFacilityAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { approveTimesheet } from "@/lib/assignments";
import { createInvoiceForAssignment } from "@/lib/invoices";
import { sendInvoiceBlockedEmail, sendTimesheetDisputedEmail } from "@/lib/email";
import { freelancerEmail } from "@/lib/notify";
import { MISSING_FIELD_LABELS, type MissingField } from "@/lib/invoiceSettings";

const UREN_PATH = "/zorginstelling/uren";

/**
 * Facility approves the hours.
 *
 * This is the moment the fee difference settles: the fee was charged at
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
  /*
   * Made but not delivered — a mail failure, or no billing address on file. Not
   * "held": nobody is reviewing it and nobody is going to release it, because the
   * release button on the freelancer's list only appears for invoices she chose
   * to hold. Saying "je ontvangt hem binnenkort" here was a promise the product
   * could not keep.
   */
  if (invoice.undelivered) {
    redirect(`${UREN_PATH}?approved=1&undelivered=1`);
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
    .select("id, org_id, status, freelancer_id, timesheets(approved_at)")
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      org_id: string;
      freelancer_id: string;
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

  /*
   * SHE IS TOLD, because she is the only one who can move it.
   *
   * A disputed timesheet leaves the approval queue and sits still: no fee
   * settled, no invoice, no payment. Submitting hours mails the facility for
   * exactly this reason — unapproved hours delay the freelancer being paid — and
   * the identical argument pointed the other way produced nothing at all. The
   * only trace was a badge on a screen she has to think to open.
   */
  try {
    const to = await freelancerEmail(assignment.freelancer_id);
    if (to) {
      await sendTimesheetDisputedEmail({
        to,
        facilityName: admin.org.name,
        reason,
        assignmentId,
      });
    }
  } catch (cause) {
    console.error(`[uren] dispute mail not sent for ${assignmentId}: ${String(cause)}`);
  }

  revalidatePath(UREN_PATH);
  revalidatePath("/professional/diensten");
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
    .select("freelancer_id, organisations(name), freelancers(profiles(full_name))")
    .eq("id", assignmentId)
    .maybeSingle<{
      freelancer_id: string;
      organisations: { name: string } | null;
      freelancers: { profiles: { full_name: string } | null } | null;
    }>();

  if (!assignment) return;

  const { data: user } = await service.auth.admin.getUserById(assignment.freelancer_id);
  const to = user?.user?.email;
  if (!to) return;

  await sendInvoiceBlockedEmail({
    to,
    freelancerName: assignment.freelancers?.profiles?.full_name ?? "",
    facilityName: assignment.organisations?.name ?? "De zorginstelling",
    reason,
    missing: missing.map((field) => MISSING_FIELD_LABELS[field]),
  });
}

/**
 * Approves several timesheets in one go.
 *
 * A normal week is five to fifteen shifts running exactly as scheduled, and the
 * queue made a coordinator confirm each one separately — read, click, wait for
 * the page, find your place again, repeat. That is not just slow: it is how
 * approving stops being a check and becomes a rhythm, and the one row that
 * differs from its schedule gets waved through with the rest.
 *
 * So bulk approval is deliberately limited to the rows the screen has marked as
 * matching their schedule. Anything where the claimed hours differ keeps its own
 * button and its own decision, which is the only place the coordinator's
 * attention is actually worth spending.
 */
export async function approveTimesheetsAction(formData: FormData) {
  const admin = await getFacilityAdmin();
  if (!admin) redirect("/login?next=%2Fzorginstelling%2Furen");

  const ids = formData.getAll("assignment_id").map(String).filter(Boolean);
  if (ids.length === 0) redirect(`${UREN_PATH}?error=nothing_selected`);

  const service = getSupabaseAdmin();

  /*
   * Ownership for all of them at once, then one approval at a time.
   *
   * The ids come from checkboxes in a form, so they are caller-supplied — the
   * admin client bypasses RLS and this is the only thing establishing that these
   * assignments belong to this facility.
   */
  const { data: owned } = await service
    .from("assignments")
    .select("id, org_id, status")
    .in("id", ids)
    .eq("org_id", admin.org.id)
    .neq("status", "cancelled")
    .returns<{ id: string; org_id: string; status: string }[]>();

  const approvable = (owned ?? []).map((row) => row.id);
  if (approvable.length === 0) redirect(`${UREN_PATH}?error=unknown`);

  /*
   * Sequentially, not in parallel.
   *
   * Each approval settles a fee, writes a ledger row and allocates an invoice
   * number from a per-freelancer series. Running them at once would race the
   * number allocator against itself — it retries on the unique index, so the
   * result would still be correct, but it would burn attempts for no reason and
   * the failure mode is an uninvoiced completed assignment.
   *
   * That was true of the single-row action and false of this loop until the
   * ninth audit: this justified sequential ordering by an invoice number it
   * never allocated, and produced the exact failure it names. The invoicing is
   * in the loop now.
   */
  let approved = 0;
  let invoiced = 0;
  const failed: string[] = [];
  const uninvoiced: string[] = [];
  /*
   * Made but not delivered. Counted apart from `invoiced` because it is apart:
   * the invoice exists and is numbered, and the facility does not have it. That
   * used to arrive here as `ok` and was counted as invoiced, which is how a mail
   * outage produced a run reporting "12 goedgekeurd en gefactureerd" for twelve
   * documents nobody received.
   */
  const undelivered: string[] = [];

  /*
   * Made, numbered, and deliberately not sent: the freelancer releases it herself.
   * Its own counter, because "gefactureerd" is a claim the facility can check and
   * find false.
   */
  let held = 0;

  for (const id of approvable) {
    /*
     * One row cannot take the batch down.
     *
     * approveTimesheet and createInvoiceForAssignment both return outcomes rather
     * than throwing, and this belt exists because that is a property of two
     * functions rather than of the language: anything either of them calls can
     * still throw, and every row processed before it has already moved money.
     * Losing one row's outcome is recoverable; losing eleven rows' outcomes while
     * their fees are settled and their invoices are sent is not.
     */
    let result: Awaited<ReturnType<typeof approveTimesheet>>;

    try {
      result = await approveTimesheet(id, admin.userId);
    } catch (cause) {
      console.error(`[uren] approval threw for ${id}: ${String(cause)}`);
      failed.push("unknown");
      continue;
    }

    if (!result.ok) {
      failed.push(result.reason);
      continue;
    }

    approved++;

    /*
     * AND THE INVOICE. This loop did not have this, and that was the defect.
     *
     * approveTimesheet settles the fee and sets the assignment to 'completed'
     * (settle_timesheet in functions.sql), so the work was finished and paid for
     * by the freelancer — and no invoice existed. The single-row action a few
     * lines up has always invoiced immediately; the bulk path stopped at the
     * approval. Nothing else in the codebase retries: there is no cron and no
     * trigger, and the only route back was the freelancer noticing the
     * "nog niet gefactureerd" list on her own page.
     *
     * The comment that used to sit above this loop justified running the
     * approvals sequentially because "each approval allocates an invoice number
     * from a per-freelancer series", and named "an uninvoiced completed
     * assignment" as the failure it was avoiding. It allocated none, and produced
     * exactly that.
     */
    const invoice = await createInvoiceForAssignment(id);

    if (invoice.ok) {
      /*
       * THREE outcomes, not two.
       *
       * `held` — the freelancer has auto_send off and releases it herself — fell
       * into `invoiced++`, so a run of twelve reported "12 urenbriefjes
       * goedgekeurd en gefactureerd" for twelve invoices the facility does not
       * have and cannot find: /zorginstelling/facturen filters on sent_at, and so
       * does the reminder cron. The single-row path and the freelancer's own
       * button both distinguish this; the bulk path was the one consumer that
       * never learned it, under a comment claiming both approval paths had.
       */
      if (invoice.undelivered) undelivered.push(invoice.undelivered);
      else if (invoice.held) held++;
      else invoiced++;
      continue;
    }

    uninvoiced.push(invoice.reason);

    /*
     * Same as the single-row path: the freelancer is the only person who can
     * unblock a missing VAT status or missing invoice details, so she is told.
     * Best effort — the approval and the fee stand either way.
     */
    if (invoice.reason === "invoice_details_missing" || invoice.reason === "vat_undetermined") {
      await notifyFreelancerInvoiceBlocked(id, invoice.reason, invoice.missing ?? []);
    }
  }

  revalidatePath(UREN_PATH);
  revalidatePath("/zorginstelling");
  revalidatePath("/zorginstelling/facturen");

  /*
   * Both numbers reported. A partial success that reports only the successes is
   * the shape three audits have caught in this codebase: the screen goes quiet
   * and the rows that failed sit in the queue looking untouched.
   */
  if (failed.length > 0) {
    redirect(`${UREN_PATH}?approved=${approved}&failed=${failed.length}&error=${failed[0]}`);
  }

  /*
   * Approved but not invoiced is its own outcome, and it must not be reported as
   * success. The banner used to say "N urenbriefjes goedgekeurd en gefactureerd"
   * for every bulk run, which was false for all of them.
   */
  if (uninvoiced.length > 0) {
    redirect(
      `${UREN_PATH}?approved=${approved}&uninvoiced=${uninvoiced.length}&invoice=${uninvoiced[0]}`,
    );
  }

  // Made, numbered, not sent. Reported before the plain success, because a
  // facility that is told to expect an invoice and never receives one chases us.
  if (undelivered.length > 0) {
    redirect(
      `${UREN_PATH}?approved=${approved}&invoiced=${invoiced}&undelivered=${undelivered.length}&held=${held}`,
    );
  }

  /*
   * Held is carried on the success path too. It is not a failure — the freelancer
   * asked to release her own invoices — but "N goedgekeurd en gefactureerd" is a
   * claim the facility can check against its own payables list and find false.
   */
  if (held > 0) {
    redirect(`${UREN_PATH}?approved=${approved}&invoiced=${invoiced}&held=${held}`);
  }

  redirect(`${UREN_PATH}?approved=${approved}&invoiced=${invoiced}`);
}
