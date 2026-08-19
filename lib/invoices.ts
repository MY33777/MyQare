import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { assertInvoiceable, invoiceAmounts } from "@/lib/vat";
import { nextInvoiceNumber } from "@/lib/invoiceNumber";
import {
  getInvoiceSettings,
  missingInvoiceFields,
  formatIban,
  type MissingField,
} from "@/lib/invoiceSettings";
import { addDaysToDateKey, amsterdamDateKey, amsterdamYear } from "@/lib/timezone";
import { assignmentValueCents } from "@/lib/fees";
import { renderInvoicePdf } from "@/lib/invoicePdf";
import { qualificationLabel } from "@/lib/qualifications";
import { sendInvoiceEmail } from "@/lib/email";

export const INVOICE_BUCKET = "documents";

export type InvoiceOutcome =
  /** `held` means created and numbered but deliberately not sent — see auto_send. */
  | { ok: true; invoiceId: string; number: string; held?: boolean }
  | {
      ok: false;
      reason:
        | "vat_undetermined"
        | "already_invoiced"
        | "not_approved"
        | "number_race"
        | "invoice_details_missing"
        | "unknown";
      detail?: string;
      /** Which legally required fields are blank, for a message that names them. */
      missing?: MissingField[];
    };

/**
 * Creates the invoice for an approved assignment.
 *
 * Called after the facility approves the hours. Deliberately separate from
 * approval itself: approval settles the platform fee, which must always succeed,
 * while invoicing can legitimately refuse — an undetermined VAT status blocks it
 * (see lib/vat.ts). Bundling the two would mean a VAT question no one has
 * answered yet also blocks the fee settlement.
 */
export async function createInvoiceForAssignment(assignmentId: string): Promise<InvoiceOutcome> {
  const admin = getSupabaseAdmin();

  const { data: assignment } = await admin
    .from("assignments")
    .select(
      "id, freelancer_id, org_id, agreed_rate_cents, shifts(profession, starts_at, ends_at), timesheets(minutes_claimed, break_minutes, approved_at)",
    )
    .eq("id", assignmentId)
    .maybeSingle<{
      id: string;
      freelancer_id: string;
      org_id: string;
      agreed_rate_cents: number;
      shifts: { profession: string; starts_at: string; ends_at: string } | null;
      timesheets: { minutes_claimed: number; break_minutes: number; approved_at: string | null } | null;
    }>();

  if (!assignment || !assignment.shifts) return { ok: false, reason: "unknown" };
  if (!assignment.timesheets?.approved_at) return { ok: false, reason: "not_approved" };

  const { data: existing } = await admin
    .from("invoices")
    .select("id, number")
    .eq("assignment_id", assignmentId)
    .maybeSingle<{ id: string; number: string }>();

  // Idempotent: approving twice, or a retry after a transient failure, must not
  // issue a second invoice for the same work.
  if (existing) return { ok: true, invoiceId: existing.id, number: existing.number };

  const [{ data: freelancer }, { data: profile }, { data: org }] = await Promise.all([
    admin
      .from("freelancers")
      .select("kvk, big_number, vat_exempt, vat_exempt_reason")
      .eq("profile_id", assignment.freelancer_id)
      .maybeSingle<{
        kvk: string | null;
        big_number: string | null;
        vat_exempt: boolean | null;
        vat_exempt_reason: string | null;
      }>(),
    admin
      .from("profiles")
      .select("full_name")
      .eq("id", assignment.freelancer_id)
      .maybeSingle<{ full_name: string }>(),
    admin
      .from("organisations")
      .select("name, kvk, billing_email, address_line, postcode, city")
      .eq("id", assignment.org_id)
      .maybeSingle<{
        name: string;
        kvk: string | null;
        billing_email: string | null;
        address_line: string | null;
        postcode: string | null;
        city: string | null;
      }>(),
  ]);

  if (!freelancer || !org) return { ok: false, reason: "unknown" };

  /*
   * Refuses rather than guesses. Sending a facility an invoice with the wrong VAT
   * is worse than making someone answer the question first — they deduct what we
   * print, and correcting it later means a credit note and an awkward call.
   */
  try {
    assertInvoiceable(freelancer.vat_exempt);
  } catch {
    return { ok: false, reason: "vat_undetermined" };
  }

  const minutes = Math.max(
    0,
    assignment.timesheets.minutes_claimed - assignment.timesheets.break_minutes,
  );
  const netCents = assignmentValueCents(minutes, assignment.agreed_rate_cents);
  const amounts = invoiceAmounts(netCents, freelancer.vat_exempt, freelancer.vat_exempt_reason);

  /*
   * The freelancer's own invoicing setup: numbering series, payment term, their
   * business identity and whether this goes out automatically.
   *
   * Loaded before anything is written, because a missing legal field has to stop
   * the invoice rather than produce an incomplete one. Article 35a Wet OB requires
   * the supplier's name and address on the document, and the supplier is the
   * freelancer — we only hold the pen.
   */
  const settings = await getInvoiceSettings(assignment.freelancer_id);
  const missing = missingInvoiceFields(settings, freelancer.vat_exempt);

  if (missing.length > 0) {
    /*
     * Refusing is the whole point. Issuing a document that is missing an address
     * or a btw-id creates a real problem for both parties — the facility cannot
     * deduct it, the freelancer has issued an invalid invoice under their own
     * name — and unlike an unsent invoice, that cannot be undone by filling in a
     * form later. The approval and the fee settlement already stand; only the
     * document waits.
     */
    return { ok: false, reason: "invoice_details_missing", missing };
  }

  /*
   * Calendar dates in Amsterdam, not UTC. An invoice approved at 00:30 local was
   * previously dated the day before, while the PDF beside it printed the Amsterdam
   * date — the document contradicted its own record. On New Year's Eve the number
   * also took the wrong year and broke the per-year sequence.
   */
  const issuedOn = new Date();
  const issuedOnKey = amsterdamDateKey(issuedOn);
  const dueOnKey = addDaysToDateKey(issuedOnKey, settings.paymentTermDays);

  /*
   * Allocate a number and insert, retrying on a collision.
   *
   * nextInvoiceNumber is a read-then-write against the unique
   * (freelancer_id, number) index, so two approvals of the same freelancer's work
   * within a few milliseconds both compute the same next number and one loses.
   * That is the index doing its job.
   *
   * The retry used to be "the caller's problem" and no caller did it: the single
   * call site branched only on vat_undetermined and otherwise reported success. So
   * the loser was left approved, fee settled, assignment completed — and
   * permanently uninvoiced, with the facility told it had worked and the Goedkeuren
   * button gone from the queue. Nobody would notice until the freelancer chased a
   * payment for work that had never been billed.
   */
  let invoice: { id: string; number: string } | null = null;
  let lastError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < 5 && !invoice; attempt++) {
    // Re-read inside the loop: on a retry the winning number is now committed, so
    // this picks up the one after it.
    const { data: previous } = await admin
      .from("invoices")
      .select("number")
      .eq("freelancer_id", assignment.freelancer_id)
      .returns<{ number: string }[]>();

    const number = nextInvoiceNumber(
      (previous ?? []).map((row) => row.number),
      amsterdamYear(issuedOn),
      { prefix: settings.numberPrefix, start: settings.numberStart },
    );

    const { data, error } = await admin
      .from("invoices")
      .insert({
        assignment_id: assignmentId,
        number,
        freelancer_id: assignment.freelancer_id,
        org_id: assignment.org_id,
        issued_on: issuedOnKey,
        due_on: dueOnKey,
        minutes_billed: minutes,
        rate_cents: assignment.agreed_rate_cents,
        amount_ex_vat_cents: amounts.amountExVatCents,
        vat_rate_bp: amounts.vatRateBp,
        vat_amount_cents: amounts.vatAmountCents,
        total_cents: amounts.totalCents,
        vat_treatment: amounts.treatment,
        vat_note: amounts.vatNote,
      })
      .select("id, number")
      .single<{ id: string; number: string }>();

    if (data) {
      invoice = data;
      break;
    }

    lastError = error ?? null;

    /*
     * 23505 is a unique violation, but on WHICH index matters. On
     * (assignment_id) it means a concurrent call already invoiced this assignment
     * — success, not a retry. On (freelancer_id, number) it is the number race and
     * another attempt will pick up the next one. Anything else is not retryable.
     */
    if (error?.code !== "23505") break;

    const { data: raced } = await admin
      .from("invoices")
      .select("id, number")
      .eq("assignment_id", assignmentId)
      .maybeSingle<{ id: string; number: string }>();

    if (raced) return { ok: true, invoiceId: raced.id, number: raced.number };
  }

  if (!invoice) {
    return { ok: false, reason: "number_race", detail: lastError?.message ?? "number_race" };
  }

  // The PDF is a rendering of the row, not the record itself. If this fails the
  // invoice still legally exists and can be re-rendered; losing the row would be
  // the real problem, which is why it is written first.
  try {
    const pdf = await renderInvoicePdf({
      number: invoice.number,
      issuedOn: new Date(`${issuedOnKey}T12:00:00Z`),
      dueOn: new Date(`${dueOnKey}T12:00:00Z`),
      freelancer: {
        // The trading name if they gave one — a zzp'er often invoices under a
        // business name that is not their own — otherwise the person's name.
        name: settings.businessName?.trim() || profile?.full_name || "Zorgprofessional",
        kvk: freelancer.kvk,
        bigNumber: freelancer.big_number,
        email: null,
        address: settings.addressLine,
        postcode: settings.postcode,
        city: settings.city,
        vatNumber: settings.vatNumber,
        iban: formatIban(settings.iban),
        accountHolder: settings.accountHolder,
      },
      paymentNote: settings.paymentNote,
      facility: {
        name: org.name,
        kvk: org.kvk,
        address: org.address_line,
        postcode: org.postcode,
        city: org.city,
      },
      line: {
        description: qualificationLabel(assignment.shifts.profession),
        shiftDate: new Date(assignment.shifts.starts_at),
        minutes,
        rateCents: assignment.agreed_rate_cents,
      },
      amountExVatCents: amounts.amountExVatCents,
      vatRateBp: amounts.vatRateBp,
      vatAmountCents: amounts.vatAmountCents,
      totalCents: amounts.totalCents,
      vatNote: amounts.vatNote,
    });

    const path = `invoices/${assignment.freelancer_id}/${invoice.number}.pdf`;
    await admin.storage.from(INVOICE_BUCKET).upload(path, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });

    const { error: pathError } = await admin
      .from("invoices")
      .update({ pdf_path: path })
      .eq("id", invoice.id);

    // The PDF is in the bucket but nothing points at it — which is exactly the
    // state that made pdf_path unreadable for months without anyone noticing.
    if (pathError) console.error(`[invoice] pdf uploaded but path not stored: ${invoice.number}`);
  } catch {
    // Left with pdf_path null; the invoice list offers a re-render.
  }

  /*
   * Emailed to the facility's billing address, not to whoever approved the hours.
   * Facilities route invoices to a shared accounts-payable mailbox, and a document
   * that lands in a coordinator's personal inbox is a document that gets paid late.
   *
   * Best-effort: the invoice legally exists whether or not the mail went out, and
   * both parties can see it in the app.
   */
  if (!settings.autoSend) {
    /*
     * Held for review. The invoice exists and holds its number — allocation
     * happens in approval order whatever this setting says, because a series with
     * gaps in it is a worse problem than one that goes out a day late.
     *
     * The freelancer releases it from /professional/facturen.
     */
    return { ok: true, invoiceId: invoice.id, number: invoice.number, held: true };
  }

  await deliverInvoice(invoice.id);

  return { ok: true, invoiceId: invoice.id, number: invoice.number };
}

/**
 * Emails an invoice and records that it went out.
 *
 * Split from creation so the "hold for review" path and the send button share one
 * implementation. sent_at is written here and nowhere else — it used to be written
 * nowhere at all, so every invoice read as never sent and the reminder cron had no
 * way to tell a held invoice from a delivered one.
 */
async function deliverInvoice(
  invoiceId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const admin = getSupabaseAdmin();

  const { data: invoice } = await admin
    .from("invoices")
    .select(
      "id, number, total_cents, due_on, sent_at, freelancer_id, organisations(name, billing_email), profiles:freelancer_id(full_name)",
    )
    .eq("id", invoiceId)
    .maybeSingle<{
      id: string;
      number: string;
      total_cents: number;
      due_on: string;
      sent_at: string | null;
      freelancer_id: string;
      organisations: { name: string; billing_email: string | null } | null;
      profiles: { full_name: string } | null;
    }>();

  if (!invoice) return { ok: false, reason: "unknown" };
  if (invoice.sent_at) return { ok: true }; // Idempotent: never mail the same invoice twice.

  const to = invoice.organisations?.billing_email;
  if (!to) return { ok: false, reason: "no_billing_email" };

  const freelancerName = invoice.profiles?.full_name ?? "Zorgprofessional";

  /*
   * To the facility's billing address, not to whoever approved the hours.
   * Facilities route invoices to a shared accounts-payable mailbox, and a document
   * that lands in a coordinator's personal inbox gets paid late.
   */
  const ok = await sendInvoiceEmail({
    to,
    facilityName: invoice.organisations?.name ?? "",
    freelancerName,
    invoiceNumber: invoice.number,
    totalCents: invoice.total_cents,
    dueOn: invoice.due_on,
  });

  if (!ok) return { ok: false, reason: "send_failed" };

  const { error: sentError } = await admin
    .from("invoices")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", invoiceId);

  /*
   * The mail has gone. If this fails the invoice reads as unsent, so the reminder
   * cron will chase a facility that already has it and the freelancer is offered a
   * "Versturen" button that would send it twice. Reported as a failure of the
   * send, because from the product's point of view that is what it is.
   */
  if (sentError) return { ok: false, reason: "unknown" };

  // The freelancer's own copy, if they asked for one. Failure here is not failure
  // of the invoice: the document reached the party that has to pay it.
  const settings = await getInvoiceSettings(invoice.freelancer_id);
  if (settings.copyToSelf) {
    const { data: user } = await admin.auth.admin.getUserById(invoice.freelancer_id);
    const own = user?.user?.email;
    if (own) {
      await sendInvoiceEmail({
        to: own,
        facilityName: invoice.organisations?.name ?? "",
        freelancerName,
        invoiceNumber: invoice.number,
        totalCents: invoice.total_cents,
        dueOn: invoice.due_on,
      });
    }
  }

  return { ok: true };
}

/** Releases a held invoice. Called from the freelancer's invoice list. */
export async function sendExistingInvoice(
  invoiceId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return deliverInvoice(invoiceId);
}

/**
 * Short-lived signed URL for an invoice PDF.
 *
 * The bucket is private, so a path is not a URL. Signed for 5 minutes: long
 * enough to click, short enough that a link pasted into a chat stops working.
 */
export async function invoiceDownloadUrl(pdfPath: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.storage.from(INVOICE_BUCKET).createSignedUrl(pdfPath, 300);
  return data?.signedUrl ?? null;
}
