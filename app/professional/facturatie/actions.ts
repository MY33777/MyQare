"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireFreelancer } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEFAULT_SETTINGS } from "@/lib/invoiceSettings";

const PATH = "/professional/facturatie";

/**
 * Saves the freelancer's invoicing setup.
 *
 * Everything here ends up printed on a document that goes to a client and into
 * two sets of books, so the validation is strict about shape and quiet about
 * judgement: a malformed prefix is refused, an unusual-looking address is not.
 */
export async function saveInvoiceSettingsAction(formData: FormData) {
  const freelancer = await requireFreelancer(PATH);

  const text = (key: string, max: number): string | null => {
    const value = String(formData.get(key) ?? "").trim();
    if (!value) return null;
    return value.slice(0, max);
  };

  const prefix = text("number_prefix", 8);
  if (prefix && !/^[A-Za-z0-9-]{1,8}$/.test(prefix)) {
    redirect(`${PATH}?error=bad_prefix`);
  }

  const startInput = String(formData.get("number_start") ?? "").trim();
  const numberStart = startInput ? Number(startInput) : 1;
  if (!Number.isInteger(numberStart) || numberStart < 1 || numberStart > 999_999) {
    redirect(`${PATH}?error=bad_start`);
  }

  const termInput = String(formData.get("payment_term_days") ?? "").trim();
  const paymentTerm = termInput ? Number(termInput) : DEFAULT_SETTINGS.paymentTermDays;
  if (!Number.isInteger(paymentTerm) || paymentTerm < 0 || paymentTerm > 120) {
    redirect(`${PATH}?error=bad_term`);
  }

  /*
   * IBAN stored without spaces, checked only for plausible shape.
   *
   * No mod-97 checksum: length rules differ per country and change, and a
   * freelancer whose genuinely correct IBAN is refused has no way around it. A
   * wrong-but-well-formed number surfaces the first time a payment bounces, which
   * is recoverable; a form that will not accept the truth is not.
   */
  const ibanRaw = String(formData.get("iban") ?? "").replace(/\s+/g, "").toUpperCase();
  if (ibanRaw && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$/.test(ibanRaw)) {
    redirect(`${PATH}?error=bad_iban`);
  }

  /*
   * Dutch btw-id: NL + 9 digits + B + 2 digits. Checked only when it looks Dutch,
   * because a freelancer established elsewhere in the EU has a different format
   * and refusing theirs would be wrong.
   */
  const vatNumber = text("vat_number", 20)?.replace(/\s+/g, "").toUpperCase() ?? null;
  if (vatNumber && vatNumber.startsWith("NL") && !/^NL\d{9}B\d{2}$/.test(vatNumber)) {
    redirect(`${PATH}?error=bad_vat_number`);
  }

  const { error } = await getSupabaseAdmin().from("invoice_settings").upsert(
    {
      profile_id: freelancer.userId,
      auto_send: formData.get("auto_send") === "on",
      number_prefix: prefix,
      number_start: numberStart,
      payment_term_days: paymentTerm,
      iban: ibanRaw || null,
      account_holder: text("account_holder", 120),
      business_name: text("business_name", 160),
      address_line: text("address_line", 160),
      postcode: text("postcode", 12),
      city: text("city", 80),
      vat_number: vatNumber,
      payment_note: text("payment_note", 500),
      copy_to_self: formData.get("copy_to_self") === "on",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id" },
  );

  // Checked, not discarded. A settings page that says "opgeslagen" over a failed
  // write is how somebody finds out months later that every invoice went out
  // without their btw-id.
  if (error) redirect(`${PATH}?error=unknown`);

  revalidatePath(PATH);
  revalidatePath("/professional/facturen");
  redirect(`${PATH}?saved=1`);
}

/**
 * Releases an invoice the freelancer chose to review before sending.
 *
 * Only reachable when auto_send is off. The invoice already exists and already
 * holds its number — allocation happens in approval order regardless, because a
 * series with gaps is worse than one sent late.
 */
export async function sendInvoiceAction(formData: FormData) {
  const freelancer = await requireFreelancer("/professional/facturen");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!invoiceId) redirect("/professional/facturen?error=unknown");

  const admin = getSupabaseAdmin();

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, freelancer_id, sent_at")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; freelancer_id: string; sent_at: string | null }>();

  // The admin client bypasses RLS, so ownership is established here or nowhere.
  if (!invoice || invoice.freelancer_id !== freelancer.userId) {
    redirect("/professional/facturen?error=unknown");
  }
  if (invoice.sent_at) redirect("/professional/facturen?error=already_sent");

  const { sendExistingInvoice } = await import("@/lib/invoices");
  const result = await sendExistingInvoice(invoiceId);

  if (!result.ok) redirect(`/professional/facturen?error=${result.reason}`);

  revalidatePath("/professional/facturen");
  redirect("/professional/facturen?sent=1");
}

/**
 * Issues an invoice for approved work that could not be invoiced at the time.
 *
 * The way out of what was a dead end. createInvoiceForAssignment refuses while
 * the legally required fields are blank, and the approval and the fee settlement
 * stand regardless — so the work left the facility's queue, no code path retried
 * it, and the person who could fix it was never told. Now they are told on
 * /professional/facturen, and this is the button.
 *
 * Idempotent through createInvoiceForAssignment, which returns the existing
 * invoice if one was issued in the meantime.
 */
export async function issueInvoiceAction(formData: FormData) {
  const freelancer = await requireFreelancer("/professional/facturen");
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!assignmentId) redirect("/professional/facturen?error=unknown");

  const admin = getSupabaseAdmin();

  const { data: assignment } = await admin
    .from("assignments")
    .select("id, freelancer_id")
    .eq("id", assignmentId)
    .maybeSingle<{ id: string; freelancer_id: string }>();

  // The admin client bypasses RLS, so ownership is established here or nowhere.
  if (!assignment || assignment.freelancer_id !== freelancer.userId) {
    redirect("/professional/facturen?error=unknown");
  }

  const { createInvoiceForAssignment } = await import("@/lib/invoices");
  const result = await createInvoiceForAssignment(assignmentId);

  if (!result.ok) redirect(`/professional/facturen?error=${result.reason}`);

  revalidatePath("/professional/facturen");
  revalidatePath("/zorginstelling/facturen");

  /*
   * "Opgemaakt" and "opgemaakt en verstuurd" are different outcomes, and this
   * reported the second for both. Somebody with auto_send off would be told their
   * invoice had gone to the facility when it was sitting on this very page
   * waiting for them to release it.
   */
  redirect(`/professional/facturen?issued=${result.held ? "held" : "sent"}`);
}
