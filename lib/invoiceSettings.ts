import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PAYMENT_TERM_DAYS } from "@/lib/invoiceNumber";

/*
 * The freelancer's own invoicing setup.
 *
 * MyQare writes the invoice, but the invoicing party is the freelancer — so the
 * document carries their name, their address, their btw-id and their numbering
 * series, not ours. Article 35a Wet OB lists what has to be on it; the fields
 * below are the ones we cannot supply for them.
 *
 * Every setting has a working default, so an account that never opens the page
 * still behaves the way the public site promises. The one thing defaults cannot
 * cover is the legally required identity, which is why isReadyToInvoice exists
 * and why invoicing refuses rather than issuing something incomplete.
 */

export type InvoiceSettings = {
  profileId: string;
  autoSend: boolean;
  numberPrefix: string | null;
  numberStart: number;
  paymentTermDays: number;
  iban: string | null;
  accountHolder: string | null;
  businessName: string | null;
  addressLine: string | null;
  postcode: string | null;
  city: string | null;
  vatNumber: string | null;
  paymentNote: string | null;
  copyToSelf: boolean;
};

export const DEFAULT_SETTINGS: Omit<InvoiceSettings, "profileId"> = {
  autoSend: true,
  numberPrefix: null,
  numberStart: 1,
  /*
   * 30, from lib/invoiceNumber.ts, not a second number written here.
   *
   * This said 14. Nobody decided that: the old path used PAYMENT_TERM_DAYS = 30,
   * the settings default was invented alongside the table, and moving invoicing
   * onto settings silently halved the term on every invoice — while the test
   * pinning 30 stayed green, because it exercises dueDate() and the invoice path
   * no longer calls it. Two constants for one rule is how that happens.
   */
  paymentTermDays: PAYMENT_TERM_DAYS,
  iban: null,
  accountHolder: null,
  businessName: null,
  addressLine: null,
  postcode: null,
  city: null,
  vatNumber: null,
  paymentNote: null,
  copyToSelf: true,
};

type Row = {
  profile_id: string;
  auto_send: boolean;
  number_prefix: string | null;
  number_start: number;
  payment_term_days: number;
  iban: string | null;
  account_holder: string | null;
  business_name: string | null;
  address_line: string | null;
  postcode: string | null;
  city: string | null;
  vat_number: string | null;
  payment_note: string | null;
  copy_to_self: boolean;
};

function fromRow(row: Row): InvoiceSettings {
  return {
    profileId: row.profile_id,
    autoSend: row.auto_send,
    numberPrefix: row.number_prefix,
    numberStart: row.number_start,
    paymentTermDays: row.payment_term_days,
    iban: row.iban,
    accountHolder: row.account_holder,
    businessName: row.business_name,
    addressLine: row.address_line,
    postcode: row.postcode,
    city: row.city,
    vatNumber: row.vat_number,
    paymentNote: row.payment_note,
    copyToSelf: row.copy_to_self,
  };
}

/**
 * Reads a freelancer's settings, falling back to the defaults.
 *
 * Never returns null. A missing row means "has not customised anything", which is
 * a legitimate state and not an error — the backfill in migration 010 covers
 * existing accounts and this covers everyone created after it.
 */
export async function getInvoiceSettings(profileId: string): Promise<InvoiceSettings> {
  const { data } = await getSupabaseAdmin()
    .from("invoice_settings")
    .select(
      "profile_id, auto_send, number_prefix, number_start, payment_term_days, iban, account_holder, business_name, address_line, postcode, city, vat_number, payment_note, copy_to_self",
    )
    .eq("profile_id", profileId)
    .maybeSingle<Row>();

  return data ? fromRow(data) : { profileId, ...DEFAULT_SETTINGS };
}

export type MissingField =
  | "business_name"
  | "address_line"
  | "postcode"
  | "city"
  | "vat_number"
  | "iban";

export const MISSING_FIELD_LABELS: Record<MissingField, string> = {
  business_name: "Bedrijfsnaam",
  address_line: "Adres",
  postcode: "Postcode",
  city: "Plaats",
  vat_number: "Btw-identificatienummer",
  iban: "IBAN",
};

/**
 * What is still missing before a legally valid invoice can be issued.
 *
 * Returns the empty array when everything needed is present.
 *
 * The btw-id is required only when VAT is actually charged. Somebody invoicing
 * under the medical exemption of art. 11-1-g has no VAT to identify, and demanding
 * a number they may not have would block exactly the group this platform is
 * mostly for.
 *
 * The IBAN is not a legal requirement — it is a practical one. An invoice with no
 * account number gets paid late or not at all, and chasing it is work the
 * freelancer came here to avoid.
 */
export function missingInvoiceFields(
  settings: InvoiceSettings,
  vatExempt: boolean | null,
): MissingField[] {
  const missing: MissingField[] = [];

  if (!settings.businessName?.trim()) missing.push("business_name");
  if (!settings.addressLine?.trim()) missing.push("address_line");
  if (!settings.postcode?.trim()) missing.push("postcode");
  if (!settings.city?.trim()) missing.push("city");
  if (vatExempt === false && !settings.vatNumber?.trim()) missing.push("vat_number");
  if (!settings.iban?.trim()) missing.push("iban");

  return missing;
}

/**
 * Normalises an IBAN for display: uppercase, grouped in fours.
 *
 * Presentation only. No checksum validation here — a mod-97 check would reject
 * valid IBANs from countries whose length rules change, and a freelancer whose
 * correct IBAN is refused has no way around it.
 */
export function formatIban(value: string | null | undefined): string {
  if (!value) return "";
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return compact.replace(/(.{4})/g, "$1 ").trim();
}
