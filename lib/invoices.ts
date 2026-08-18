import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { assertInvoiceable, invoiceAmounts } from "@/lib/vat";
import { nextInvoiceNumber, PAYMENT_TERM_DAYS } from "@/lib/invoiceNumber";
import { addDaysToDateKey, amsterdamDateKey, amsterdamYear } from "@/lib/timezone";
import { assignmentValueCents } from "@/lib/fees";
import { renderInvoicePdf } from "@/lib/invoicePdf";
import { qualificationLabel } from "@/lib/qualifications";
import { sendInvoiceEmail } from "@/lib/email";

export const INVOICE_BUCKET = "documents";

export type InvoiceOutcome =
  | { ok: true; invoiceId: string; number: string }
  | { ok: false; reason: "vat_undetermined" | "already_invoiced" | "not_approved" | "unknown"; detail?: string };

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
   * Calendar dates in Amsterdam, not UTC. An invoice approved at 00:30 local was
   * previously dated the day before, while the PDF beside it printed the Amsterdam
   * date — the document contradicted its own record. On New Year's Eve the number
   * also took the wrong year and broke the per-year sequence.
   */
  const issuedOn = new Date();
  const issuedOnKey = amsterdamDateKey(issuedOn);
  const dueOnKey = addDaysToDateKey(issuedOnKey, PAYMENT_TERM_DAYS);

  const { data: previous } = await admin
    .from("invoices")
    .select("number")
    .eq("freelancer_id", assignment.freelancer_id)
    .returns<{ number: string }[]>();

  const number = nextInvoiceNumber(
    (previous ?? []).map((row) => row.number),
    amsterdamYear(issuedOn),
  );

  const { data: invoice, error } = await admin
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

  if (error || !invoice) {
    /*
     * 23505 on (freelancer_id, number) means two approvals raced for the same
     * sequence. The unique index is the real guard against a duplicate number —
     * the read-then-write above cannot be atomic — so this is the constraint
     * working, and the caller should simply retry to pick up the next number.
     */
    if (error?.code === "23505") return { ok: false, reason: "unknown", detail: "number_race" };
    return { ok: false, reason: "unknown", detail: error?.message };
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
        name: profile?.full_name ?? "Zorgprofessional",
        kvk: freelancer.kvk,
        bigNumber: freelancer.big_number,
        email: null,
      },
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

    await admin.from("invoices").update({ pdf_path: path }).eq("id", invoice.id);
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
  if (org.billing_email) {
    await sendInvoiceEmail({
      to: org.billing_email,
      facilityName: org.name,
      freelancerName: profile?.full_name ?? "Zorgprofessional",
      invoiceNumber: invoice.number,
      totalCents: amounts.totalCents,
      dueOn: dueOnKey,
    });
  }

  return { ok: true, invoiceId: invoice.id, number: invoice.number };
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
