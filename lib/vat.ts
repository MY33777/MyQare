import { applyRate, type BasisPoints } from "@/lib/money";

/*
 * VAT on the freelancer's invoice to the facility.
 *
 * IMPORTANT — this is the part of the product with the most legal exposure, and
 * it must be confirmed by WEA before a real invoice is issued.
 *
 * The 2021 business plan claimed that invoicing directly "avoids 21% VAT
 * because most self-employed professionals in healthcare are exempt". That is
 * roughly right but narrower than stated. The Dutch medical exemption applies to
 * BIG-registered professionals delivering care within their own competence.
 * Supplying *staff* is generally a taxed service, which is precisely why the
 * agency route triggers 21% — so direct contracting can preserve an exemption
 * that secondment destroys. Whether it does depends on the profession and on
 * what the person actually did on the shift.
 *
 * Because of that, this module never guesses. An undetermined freelancer cannot
 * be invoiced at all; see assertInvoiceable below. The alternative — defaulting
 * to exempt — means under-charging VAT on real invoices and discovering it in an
 * audit.
 */

export const VAT_STANDARD_BP: BasisPoints = 2100; // 21%

export type VatTreatment = "exempt_medical" | "standard_21" | "undetermined";

export type VatDecision = {
  treatment: VatTreatment;
  rateBp: BasisPoints;
  /** Printed on the invoice, so it can explain itself years later. */
  note: string;
};

/**
 * Decides the VAT treatment from the freelancer's recorded status.
 *
 * `vatExempt` is deliberately nullable in the database: "nobody has decided yet"
 * is a real state and a different one from "decided to be taxable".
 */
export function decideVat(vatExempt: boolean | null, reason?: string | null): VatDecision {
  if (vatExempt === true) {
    return {
      treatment: "exempt_medical",
      rateBp: 0,
      note:
        reason?.trim() ||
        "Vrijgesteld van btw op grond van de medische vrijstelling (art. 11 lid 1 onderdeel g Wet OB).",
    };
  }
  if (vatExempt === false) {
    return {
      treatment: "standard_21",
      rateBp: VAT_STANDARD_BP,
      note: reason?.trim() || "Btw 21% van toepassing.",
    };
  }
  return {
    treatment: "undetermined",
    rateBp: 0,
    note: "Btw-behandeling nog niet vastgesteld.",
  };
}

export type InvoiceAmounts = {
  amountExVatCents: number;
  vatRateBp: BasisPoints;
  vatAmountCents: number;
  totalCents: number;
  treatment: VatTreatment;
  vatNote: string;
};

export function invoiceAmounts(
  amountExVatCents: number,
  vatExempt: boolean | null,
  reason?: string | null,
): InvoiceAmounts {
  const decision = decideVat(vatExempt, reason);
  const vatAmount = applyRate(amountExVatCents, decision.rateBp);
  return {
    amountExVatCents,
    vatRateBp: decision.rateBp,
    vatAmountCents: vatAmount,
    totalCents: amountExVatCents + vatAmount,
    treatment: decision.treatment,
    vatNote: decision.note,
  };
}

/**
 * Throws unless we know how to tax this invoice.
 *
 * Called before an invoice is written, on purpose: it is far better to block
 * issuing and make someone answer the question than to send a facility a
 * document with the wrong VAT on it. The facility deducts what we print.
 */
export function assertInvoiceable(vatExempt: boolean | null): void {
  if (vatExempt === null) {
    throw new Error(
      "Btw-behandeling van deze zorgprofessional is nog niet vastgesteld — factuur kan niet worden opgemaakt.",
    );
  }
}
